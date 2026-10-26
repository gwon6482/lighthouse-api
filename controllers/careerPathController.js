// 직업인 진로과정 참여(랜딩 www /career-path) — 제출(공개) + 검수(어드민)
// 모델·처리방침 연결은 models/CareerPathContribution.js 머리말.
const crypto = require('crypto');
const mongoose = require('mongoose');
const CareerPathContribution = require('../models/CareerPathContribution');
const ResearchSurveyResult = require('../models/ResearchSurveyResult');
const { KINDS, CATEGORIES, STAGES, CHANGE_TYPES, STATUSES } = CareerPathContribution;
const { CAREER_YEARS } = ResearchSurveyResult;

const TEST_CAMPAIGN = '__local_test__';
const CONTRIBUTION_ID_RE = /^cpc_[0-9a-f]{18}$/;
const RESPONDENT_ID_RE = /^res_[0-9a-f]{18}$/;
const LIMITS = { entries: 30, items: 30, changes: 100, order: 80, weeks: 30 };

const jobInfo = () => mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data').collection('job_info');

class Invalid extends Error {}
// 문자열 정리 — 앞뒤 공백 제거·길이 제한. 필수인데 비면 Invalid
function str(v, max, label, required = false) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new Invalid(`${label}을(를) 입력해주세요.`);
  if (s.length > max) throw new Invalid(`${label}은(는) ${max}자 이하여야 합니다.`);
  return s || undefined;
}
function intIn(v, min, max, label) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Invalid(`${label}은(는) ${min}~${max} 사이 정수여야 합니다.`);
  return n;
}
function list(v, max, label) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Invalid(`${label} 형식이 올바르지 않습니다.`);
  if (v.length > max) throw new Invalid(`${label}은(는) ${max}개까지입니다.`);
  return v;
}
const oneOf = (v, arr, label) => {
  if (!arr.includes(v)) throw new Invalid(`${label} 값이 올바르지 않습니다.`);
  return v;
};
const lines = (v, max, label) => list(v, max, label).map((x, i) => str(x, 100, `${label} ${i + 1}번째`)).filter(Boolean);

function parseMine(m) {
  if (!m || typeof m !== 'object') throw new Invalid('등록 내용이 없습니다.');
  const t = m.track || {};
  const track = {
    id: str(t.id, 20, '방향 id'),
    name: str(t.name, 30, '방향 이름', true),
    desc: str(t.desc, 60, '방향 설명'),
    isNew: !t.id,
  };
  const entries = list(m.entries, LIMITS.entries, '해 온 것').map((e, i) => {
    const n = `${i + 1}번 항목`;
    const kind = oneOf(e?.kind, KINDS, `${n} 종류`);
    const link = str(e.link, 300, `${n} 링크`);
    if ((kind === 'book' || kind === 'lecture') && !link) throw new Invalid(`${n}: 책·강의는 어디서 찾을 수 있는지 적어주세요.`);
    return {
      order: i + 1,
      kind,
      category: oneOf(e.category, CATEGORIES, `${n} 분류`),
      name: str(e.name, 80, `${n} 이름`, true),
      link,
      weeks: intIn(e.weeks, 1, 104, `${n} 기간(주)`),
      hoursPerWeek: intIn(e.hoursPerWeek, 1, 80, `${n} 주당 시간`),
      why: str(e.why, 500, `${n} 이유`),
      items: lines(e.items, LIMITS.items, `${n} 한 것`),
    };
  });
  if (!entries.length) throw new Invalid('해 온 것을 하나 이상 넣어주세요.');
  const r = m.retro || {};
  return {
    track,
    entries,
    retro: { must: str(r.must, 600, '꼭 할 것'), skip: str(r.skip, 600, '안 해도 된 것'), redo: str(r.redo, 600, '다시 한다면') },
  };
}

function parseReview(v) {
  if (!v || typeof v !== 'object') throw new Invalid('살펴보기 내용이 없습니다.');
  const stages = list(v.stages, STAGES.length, '단계').map((s) => ({
    stage: oneOf(s?.stage, STAGES, '단계'),
    reordered: s.reordered === true,
    order: s.reordered === true ? lines(s.order, LIMITS.order, '순서') : [],
    changes: list(s.changes, LIMITS.changes, '바뀐 것').map((c, i) => {
      const n = `${i + 1}번째 변경`;
      const type = oneOf(c?.type, CHANGE_TYPES, `${n} 종류`);
      const out = {
        type,
        id: type === 'add' ? undefined : str(c.id, 60, `${n} 항목 id`, true),
        at: type === 'add' ? intIn(c.at, 0, 200, `${n} 위치`) : undefined,
        name: str(c.name, 80, `${n} 이름`, type === 'add'),
        goal: str(c.goal, 160, `${n} 목표`),
        weeks: c.weeks === undefined ? undefined : lines(c.weeks, LIMITS.weeks, `${n} 주차`),
        comment: str(c.comment, 500, `${n} 의견`),
        reason: str(c.reason, 500, `${n} 이유`),
      };
      return Object.fromEntries(Object.entries(out).filter(([, x]) => x !== undefined));
    }),
  }));
  const overall = str(v.overall, 1000, '전체 의견');
  if (!stages.some((s) => s.changes.length || s.reordered) && !overall) throw new Invalid('고친 것이나 의견이 없습니다.');
  return { stages, overall };
}

/**
 * POST /api/career-path/contributions — 제출(공개, 레이트리밋)
 * body: { type: 'mine'|'review', consent: true, jobCode, careerYears, startStage, respondent_id?, campaign?, mine? | review? }
 * 201 { contribution_id } — 제출 확인 번호(삭제 요청용, 처리방침 제6조)
 */
const submitContribution = async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.consent !== true) return res.status(400).json({ success: false, error: '수집·이용에 동의해야 제출할 수 있습니다.' });
    const type = oneOf(b.type, ['mine', 'review'], 'type');
    const careerYears = oneOf(b.careerYears, CAREER_YEARS, '경력');
    const startStage = oneOf(b.startStage, STAGES, '시작 단계');

    const jobCode = String(b.jobCode || '');
    const job = /^[0-9A-Za-z-]{1,20}$/.test(jobCode)
      ? await jobInfo().findOne({ jobCode }, { projection: { title: 1 } })
      : null;
    if (!job) return res.status(400).json({ success: false, error: '직업을 찾을 수 없습니다.' });

    // 설문에서 이어서 왔다면 실제로 있는 응답인지 확인. 없거나 형식이 틀리면 연결만 하지 않는다(제출은 받는다)
    let respondentId;
    if (typeof b.respondent_id === 'string' && RESPONDENT_ID_RE.test(b.respondent_id)) {
      if (await ResearchSurveyResult.exists({ respondent_id: b.respondent_id })) respondentId = b.respondent_id;
    }

    const doc = {
      contribution_id: `cpc_${crypto.randomBytes(9).toString('hex')}`,
      type,
      profile: { jobCode, jobTitle: job.title, careerYears, startStage },
      respondent_id: respondentId,
      consentAt: new Date(),
      meta: { campaign: b.campaign ? String(b.campaign).slice(0, 60) : null },
    };
    if (type === 'mine') doc.mine = parseMine(b.mine);
    // 살펴보기는 프로필 직업과 다른 직업의 템플릿을 볼 수도 있다(그 직업 템플릿이 없을 때 등) → 본 템플릿을 따로 받는다
    else doc.review = { templateJobCode: str(b.review?.templateJobCode, 20, '템플릿 직업') || jobCode, ...parseReview(b.review) };

    const saved = await CareerPathContribution.create(doc);
    res.status(201).json({ success: true, contribution_id: saved.contribution_id });
  } catch (err) {
    if (err instanceof Invalid) return res.status(400).json({ success: false, error: err.message });
    next(err);
  }
};

/**
 * GET /api/admin/career-path?type=&status=&jobCode=&id=&includeTest=1&page=&limit= — 검수 목록(최신 순). id = 제출 확인 번호
 */
const listContributions = async (req, res, next) => {
  try {
    const q = {};
    if (['mine', 'review'].includes(req.query.type)) q.type = req.query.type;
    if (STATUSES.includes(req.query.status)) q.status = req.query.status;
    if (typeof req.query.jobCode === 'string' && req.query.jobCode) q['profile.jobCode'] = req.query.jobCode;
    if (req.query.includeTest !== '1') q['meta.campaign'] = { $ne: TEST_CAMPAIGN };
    // 제출 확인 번호로 찾기(삭제 요청 처리) — 번호가 맞으면 다른 필터·테스트 여부와 상관없이 그 한 건
    if (typeof req.query.id === 'string' && CONTRIBUTION_ID_RE.test(req.query.id.trim())) {
      for (const k of Object.keys(q)) delete q[k];
      q.contribution_id = req.query.id.trim();
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [items, total, counts] = await Promise.all([
      CareerPathContribution.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      CareerPathContribution.countDocuments(q),
      CareerPathContribution.aggregate([
        { $match: req.query.includeTest === '1' ? {} : { 'meta.campaign': { $ne: TEST_CAMPAIGN } } },
        { $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 } } },
      ]),
    ]);
    res.json({
      success: true, total, page, limit,
      counts: counts.map((c) => ({ type: c._id.type, status: c._id.status, n: c.n })),
      data: items,
    });
  } catch (err) { next(err); }
};

/** PATCH /api/admin/career-path/:id — 검수 { status?, reviewNote?, entryCategories?: { [order]: category } } */
const updateContribution = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!CONTRIBUTION_ID_RE.test(id)) return res.status(400).json({ success: false, error: 'id 형식이 올바르지 않습니다.' });
    const doc = await CareerPathContribution.findOne({ contribution_id: id });
    if (!doc) return res.status(404).json({ success: false, error: '제출을 찾을 수 없습니다.' });
    const b = req.body || {};
    if (b.status !== undefined) {
      doc.status = oneOf(b.status, STATUSES, 'status');
      doc.reviewedAt = new Date();
    }
    if (b.reviewNote !== undefined) doc.reviewNote = str(b.reviewNote, 1000, '검수 메모') ?? '';
    // 분류 바로잡기(종류 → 분류 기본값이 맞지 않을 때)
    if (b.entryCategories && doc.mine?.entries) {
      for (const e of doc.mine.entries) {
        const c = b.entryCategories[e.order];
        if (c !== undefined) e.category = oneOf(c, CATEGORIES, `${e.order}번 분류`);
      }
    }
    await doc.save();
    res.json({ success: true, data: doc.toObject() });
  } catch (err) {
    if (err instanceof Invalid) return res.status(400).json({ success: false, error: err.message });
    next(err);
  }
};

/** DELETE /api/admin/career-path/:id — 작성자 삭제 요청(제출 확인 번호, 처리방침 제6조) */
const deleteContribution = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!CONTRIBUTION_ID_RE.test(id)) return res.status(400).json({ success: false, error: 'id 형식이 올바르지 않습니다.' });
    const r = await CareerPathContribution.deleteOne({ contribution_id: id });
    if (!r.deletedCount) return res.status(404).json({ success: false, error: '제출을 찾을 수 없습니다.' });
    res.json({ success: true });
  } catch (err) { next(err); }
};

module.exports = { submitContribution, listContributions, updateContribution, deleteContribution };
