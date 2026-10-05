// 연구용 설문 수집 — 실무자/예비 사용자.
//
// 목적: **검사·추천·통계의 신뢰성 확보.** 설계는 공유 docs
// `research/survey-collection-design.md` 가 정본이다.
//
// 🚨 이 컨트롤러는 `survey_statistics` 를 **건드리지 않는다.** 사용자가 보는 "상위 N%" 에
//    연구 응답이 섞이면, 더미 92건으로 백분위를 내던 사고가 모집단만 바꿔 반복된다.
const crypto = require('crypto');
const mongoose = require('mongoose');
const ResearchSurveyResult = require('../models/ResearchSurveyResult');
const { ROLES, CAREER_YEARS, AGE_GROUPS, GENDERS } = ResearchSurveyResult;

// Phase 1 목표 (사용자 결정 2026-10-05). 어드민 현황판이 이 값을 기준으로 충족률을 보여준다.
const PHASE1_TARGET = { practitioner: 100, prospective: 200 };
// 쏠림 제약 — 한 대분류가 실무자 목표의 40% 를 넘으면 경고한다.
// 제약이 없으면 100명이 한 직업군에서 나와 가중치가 그 군에만 맞춰지고,
// 다른 직업군 사용자에게는 **더 나빠진다.**
const SKEW_LIMIT_RATIO = 0.4;
const MIN_PRIMARY_KINDS = 5;

// 불성실 응답 판정선. ⚠️ 걸러내지 않고 **플래그만** 단다.
const MIN_DURATION_MS = 3 * 60 * 1000;   // 103문항을 3분 미만이면 의심
const MAX_STRAIGHT_RUN = 20;             // 같은 선택지 20연속이면 의심

function getJobCollection() {
  return mongoose.connection
    .useDb(process.env.JOB_DATA_DB || 'job_data')
    .collection('job_info');
}

// 같은 선택지를 연속으로 고른 최대 길이.
// ⚠️ **문항 순서대로** 봐야 의미가 있다. Object.values 는 삽입 순서를 따르므로
//    클라이언트가 문항 순서대로 넣어 보내야 한다. 정렬에 기대지 말 것 —
//    T1_A10 이 T1_A2 보다 앞에 오는 사전순 함정이 있다.
function maxStraightRun(answers) {
  let best = 0;
  for (const part of ['T1', 'T21']) {
    const vals = Object.values(answers?.[part] || {});
    let run = 0, prev = null;
    for (const v of vals) {
      if (v === prev) { run += 1; } else { run = 1; prev = v; }
      if (run > best) best = run;
    }
  }
  return best;
}

// 설문 5개 파트가 모두 채워졌는지. ⚠️ 집계는 완주본만 쓴다(사용자 결정).
function isCompleted(answers) {
  const a = answers || {};
  const has = (k) => !!a[k] && Object.keys(a[k]).length > 0;
  // ⚠️ `!!` 로 감싸 **반드시 boolean 을 돌려준다.** 빼면 `undefined` 가 나와
  //    Boolean 필드에 들어가거나 `=== false` 비교가 어긋난다.
  return !!(has('T1') && has('T21')
    && (a.T22?.checked?.length > 0)
    && a.T23?.priority_1
    && has('T3'));
}

function lastPartOf(answers) {
  const a = answers || {};
  if (a.T3 && Object.keys(a.T3).length) return 'T3';
  if (a.T23?.priority_1) return 'T23';
  if (a.T22?.checked?.length) return 'T22';
  if (a.T21 && Object.keys(a.T21).length) return 'T21';
  if (a.T1 && Object.keys(a.T1).length) return 'T1';
  return null;
}

const oneOf = (v, list) => (v == null ? null : (list.includes(v) ? v : undefined));

/**
 * POST /api/survey/research/response  (공개)
 *
 * ⚠️ 공개 엔드포인트다. 레이트리밋이 라우트에 걸려 있다.
 * ⚠️ 중복 제출은 공개 URL 에서 **완전 차단이 불가능**하다. 핑거프린팅은 과하므로
 *    레이트리밋 + 소요시간 + respondent_id 로 **줄이고**, 남은 중복은 통계로 감당한다.
 */
const submitResearchResponse = async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.survey_id || !b.answers) {
      return res.status(400).json({ success: false, error: 'survey_id 와 answers 는 필수입니다.' });
    }

    const role = oneOf(b.role, ROLES);
    if (!role) {
      return res.status(400).json({ success: false, error: `role 은 ${ROLES.join(' 또는 ')} 입니다.` });
    }

    const careerYears = oneOf(b.careerYears, CAREER_YEARS);
    const ageGroup = oneOf(b.ageGroup, AGE_GROUPS);
    const gender = oneOf(b.gender, GENDERS);
    for (const [k, v] of Object.entries({ careerYears, ageGroup, gender })) {
      if (v === undefined) return res.status(400).json({ success: false, error: `${k} 값이 올바르지 않습니다.` });
    }

    const jobs = getJobCollection();

    // ── 실무자: 현재 직업이 **반드시** 있어야 한다 ──
    // 이게 없으면 그 응답은 정답지로 쓸 수 없다(Recall@K·프로파일·매핑검증 전부 불가).
    let jobCode = null, jobTitle = null, jobPrimary = null;
    if (role === 'practitioner') {
      if (!b.jobCode) {
        return res.status(400).json({ success: false, error: '실무자는 현재 직업이 필요합니다.' });
      }
      const job = await jobs.findOne({ jobCode: String(b.jobCode) },
        { projection: { jobCode: 1, title: 1, 'classification.primary': 1, _id: 0 } });
      if (!job) {
        return res.status(400).json({ success: false, error: `직업코드 '${b.jobCode}' 를 찾을 수 없습니다.` });
      }
      jobCode = job.jobCode; jobTitle = job.title ?? null;
      jobPrimary = job.classification?.primary ?? null;
    }

    // ── 예비 사용자: 희망 직업 최대 3개 ──
    let desiredJobs = [];
    if (Array.isArray(b.desiredJobCodes) && b.desiredJobCodes.length) {
      const codes = [...new Set(b.desiredJobCodes.map(String))];
      // ⚠️ **조용히 자르지 않는다.** UI 가 3개로 제한하므로 4개가 오면 클라이언트 버그다.
      //    자르면 그 버그가 묻히고, 사용자는 고른 걸 빼앗긴 줄도 모른다.
      if (codes.length > 3) {
        return res.status(400).json({ success: false, error: '희망 직업은 최대 3개입니다.' });
      }
      const found = await jobs.find({ jobCode: { $in: codes } },
        { projection: { jobCode: 1, title: 1, _id: 0 } }).toArray();
      desiredJobs = found.map((j) => ({ jobCode: j.jobCode, jobTitle: j.title ?? null }));
      // ⚠️ 없는 코드는 **조용히 버리지 않고** 알린다. 자동완성이 깨졌을 때 드러나야 한다.
      if (desiredJobs.length !== codes.length) {
        return res.status(400).json({ success: false, error: '희망 직업 중 찾을 수 없는 직업코드가 있습니다.' });
      }
    }

    const fitScore = (role === 'practitioner' && b.fitScore != null) ? Number(b.fitScore) : null;
    if (fitScore != null && !(fitScore >= 1 && fitScore <= 5)) {
      return res.status(400).json({ success: false, error: 'fitScore 는 1~5 입니다.' });
    }

    // ── 품질 판정 ──
    const startedAt = b.startedAt ? new Date(b.startedAt) : null;
    const durationMs = (startedAt && !Number.isNaN(+startedAt)) ? (Date.now() - +startedAt) : null;
    const straight = maxStraightRun(b.answers);
    const reasons = [];
    if (durationMs != null && durationMs < MIN_DURATION_MS) reasons.push('too_fast');
    if (straight >= MAX_STRAIGHT_RUN) reasons.push('straight_lining');

    const completed = isCompleted(b.answers);

    const doc = await ResearchSurveyResult.create({
      survey_id: String(b.survey_id),
      respondent_id: `res_${crypto.randomBytes(9).toString('hex')}`,
      respondent: {
        role, jobCode, jobTitle, jobPrimary,
        careerYears: careerYears ?? null,
        desiredJobs,
        ageGroup: ageGroup ?? null,
        gender: gender ?? null,
        fitScore,
      },
      answers: b.answers,
      completed,
      lastPart: lastPartOf(b.answers),
      quality: {
        startedAt, durationMs,
        maxStraightRun: straight,
        suspect: reasons.length > 0,
        suspectReasons: reasons,
      },
      meta: {
        campaign: b.campaign ? String(b.campaign).slice(0, 60) : null,
        userAgent: (req.get('user-agent') || '').slice(0, 300),
      },
    });

    // ⚠️ 응답자에게 품질 플래그를 **알리지 않는다.** 알리면 다음 응답을 꾸미게 된다.
    res.status(201).json({
      success: true,
      respondent_id: doc.respondent_id,
      completed,
      message: completed ? '설문이 제출되었습니다. 감사합니다.' : '중간까지 저장되었습니다.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/survey/research/stats  (adminAuth)
 *
 * 수집 현황. ⚠️ **완주본만 집계**한다(사용자 결정). 완주율은 따로 보여준다.
 */
const getResearchStats = async (req, res, next) => {
  try {
    const M = ResearchSurveyResult;

    const [byRole, byPrimary, quality, funnel] = await Promise.all([
      M.aggregate([
        { $group: {
          _id: { role: '$respondent.role', completed: '$completed' },
          n: { $sum: 1 },
          avgFit: { $avg: '$respondent.fitScore' },
        } },
      ]),
      M.aggregate([
        { $match: { completed: true, 'respondent.role': 'practitioner' } },
        { $group: { _id: '$respondent.jobPrimary', n: { $sum: 1 },
                    jobs: { $addToSet: '$respondent.jobCode' } } },
        { $sort: { n: -1 } },
      ]),
      M.aggregate([
        { $match: { completed: true } },
        { $group: {
          _id: null,
          n: { $sum: 1 },
          suspect: { $sum: { $cond: ['$quality.suspect', 1, 0] } },
          medianish: { $avg: '$quality.durationMs' },
        } },
      ]),
      M.aggregate([
        { $match: { completed: false } },
        { $group: { _id: '$lastPart', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
    ]);

    const valid = { practitioner: 0, prospective: 0 };
    const partial = { practitioner: 0, prospective: 0 };
    const fit = {};
    for (const r of byRole) {
      const role = r._id.role;
      if (r._id.completed) { valid[role] = r.n; fit[role] = r.avgFit; }
      else partial[role] = r.n;
    }

    // 쏠림 판정 — 설계 문서의 Phase 1 제약을 그대로 코드로 둔다.
    const primaryKinds = byPrimary.length;
    const topPrimary = byPrimary[0] || null;
    const skewLimit = Math.floor(PHASE1_TARGET.practitioner * SKEW_LIMIT_RATIO);
    const warnings = [];
    if (valid.practitioner > 0 && primaryKinds < MIN_PRIMARY_KINDS) {
      warnings.push(`대분류 ${primaryKinds}개 — 최소 ${MIN_PRIMARY_KINDS}개 필요`);
    }
    if (topPrimary && topPrimary.n > skewLimit) {
      warnings.push(`'${topPrimary._id}' 쏠림 ${topPrimary.n}명 — 한도 ${skewLimit}명 초과`);
    }

    const started = {
      practitioner: valid.practitioner + partial.practitioner,
      prospective: valid.prospective + partial.prospective,
    };
    const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

    res.json({
      success: true,
      target: PHASE1_TARGET,
      valid,
      partial,
      // ⚠️ 모집 인원 = 목표 ÷ 완주율. 이 수치로 남은 모집량을 계산한다.
      completionRate: {
        practitioner: rate(valid.practitioner, started.practitioner),
        prospective: rate(valid.prospective, started.prospective),
      },
      progress: {
        practitioner: rate(valid.practitioner, PHASE1_TARGET.practitioner),
        prospective: rate(valid.prospective, PHASE1_TARGET.prospective),
      },
      byPrimary: byPrimary.map((p) => ({
        primary: p._id, n: p.n, distinctJobs: p.jobs.filter(Boolean).length,
      })),
      avgFitScore: fit.practitioner ?? null,
      quality: quality[0]
        ? { n: quality[0].n, suspect: quality[0].suspect,
            suspectRate: rate(quality[0].suspect, quality[0].n),
            avgDurationMs: Math.round(quality[0].medianish ?? 0) }
        : { n: 0, suspect: 0, suspectRate: null, avgDurationMs: null },
      dropoffByPart: funnel.map((f) => ({ part: f._id, n: f.n })),
      constraints: { minPrimaryKinds: MIN_PRIMARY_KINDS, skewLimit },
      warnings,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitResearchResponse,
  getResearchStats,
  PHASE1_TARGET,
  __test__: { maxStraightRun, isCompleted, lastPartOf },
};
