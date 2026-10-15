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
const JobReview = require('../models/JobReview');
const { ROLES, CAREER_YEARS, AGE_GROUPS, GENDERS } = ResearchSurveyResult;
const { buildSurveyAnalysis } = require('./surveyController');
const { runRecommend, buildUserSurvey } = require('./recommendController');

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
 *
 * 부분 저장: 첫 호출이 돌려준 `respondent_id` 를 다음 호출에 실어 보내면 **같은 문서를 갱신**한다.
 * ⚠️ 이게 없으면 파트마다 저장할 때 한 사람이 문서 N개가 되어 완주율·이탈 지점이 부풀려진다.
 *    respondent_id 는 서버가 만든 72비트 난수라 가진 사람만 갱신할 수 있다.
 */
const RESPONDENT_ID_RE = /^res_[0-9a-f]{18}$/;

const submitResearchResponse = async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.survey_id || !b.answers) {
      return res.status(400).json({ success: false, error: 'survey_id 와 answers 는 필수입니다.' });
    }

    // 이어 쓰기라면 대상 문서부터 확인한다 (검증 실패 시 아무것도 쓰지 않도록 먼저).
    let existing = null;
    if (b.respondent_id != null) {
      if (!RESPONDENT_ID_RE.test(String(b.respondent_id))) {
        return res.status(400).json({ success: false, error: 'respondent_id 형식이 올바르지 않습니다.' });
      }
      existing = await ResearchSurveyResult.findOne({ respondent_id: b.respondent_id });
      if (!existing) {
        return res.status(404).json({ success: false, error: '이어 쓸 응답을 찾을 수 없습니다.' });
      }
      // ⚠️ 완주본은 고치지 않는다. 집계에 들어간 정답지가 사후에 바뀌면 재현이 깨진다.
      if (existing.completed) {
        return res.status(409).json({ success: false, error: '이미 제출이 끝난 응답입니다.' });
      }
      if (existing.survey_id !== String(b.survey_id)) {
        return res.status(409).json({ success: false, error: '설문지가 다릅니다.' });
      }
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
    // 이어 쓰기면 **처음 저장한 시작 시각**을 쓴다. 클라이언트가 다시 보낸 값을 믿으면
    // 시작 시각을 늦춰 보내는 것만으로 소요시간이 줄어든다.
    const startedAt = existing
      ? (existing.quality?.startedAt ?? null)
      : (b.startedAt ? new Date(b.startedAt) : null);
    const durationMs = (startedAt && !Number.isNaN(+startedAt)) ? (Date.now() - +startedAt) : null;
    const straight = maxStraightRun(b.answers);
    const reasons = [];
    if (durationMs != null && durationMs < MIN_DURATION_MS) reasons.push('too_fast');
    if (straight >= MAX_STRAIGHT_RUN) reasons.push('straight_lining');

    const completed = isCompleted(b.answers);

    const fields = {
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
    };

    let doc;
    if (existing) {
      // ⚠️ 조건에 completed:false 를 다시 건다 — 위 확인과 이 갱신 사이에 다른 요청이
      //    완주 처리했으면 덮어쓰지 않는다.
      doc = await ResearchSurveyResult.findOneAndUpdate(
        { respondent_id: existing.respondent_id, completed: false },
        { $set: fields },
        { new: true },
      );
      if (!doc) {
        return res.status(409).json({ success: false, error: '이미 제출이 끝난 응답입니다.' });
      }
    } else {
      doc = await ResearchSurveyResult.create({
        survey_id: String(b.survey_id),
        respondent_id: `res_${crypto.randomBytes(9).toString('hex')}`,
        ...fields,
      });
    }

    // ⚠️ 응답자에게 품질 플래그를 **알리지 않는다.** 알리면 다음 응답을 꾸미게 된다.
    res.status(existing ? 200 : 201).json({
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
 * GET /api/survey/research/result/:respondent_id  (공개)
 *
 * 응답자 본인에게 보여주는 결과지 + 추천 직업 5개. 앱 결과와 **같은 함수**로 계산한다
 * (`buildSurveyAnalysis` · `runRecommend`). 화면도 앱과 같아야 참여 보상이 된다.
 *
 * ⚠️ 완주본만 준다(409). 부분 응답으로 결과를 내면 빈 파트가 '낮은 점수' 처럼 보인다.
 * ⚠️ respondent_id 는 서버가 만든 72비트 난수라 **링크를 가진 사람만** 볼 수 있다.
 *    이름·연락처가 없는 문서라 노출돼도 개인을 특정할 수 없다.
 * ⚠️ 읽기 전용이다. 이 경로에서 `survey_statistics` 를 갱신하지 않는다.
 */
const getResearchResult = async (req, res, next) => {
  try {
    const { respondent_id } = req.params;
    if (!RESPONDENT_ID_RE.test(String(respondent_id))) {
      return res.status(400).json({ success: false, error: 'respondent_id 형식이 올바르지 않습니다.' });
    }
    const doc = await ResearchSurveyResult.findOne({ respondent_id }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, error: '응답을 찾을 수 없습니다.' });
    }
    if (!doc.completed) {
      return res.status(409).json({ success: false, error: '아직 끝나지 않은 응답입니다.' });
    }

    // 연구 설문은 5지선다(A~E)만 쓴다. answers 구조는 survey_results 와 같다.
    const [analysis, recommend] = await Promise.all([
      buildSurveyAnalysis({ answers: doc.answers, answer_type: 'type_5' }),
      runRecommend(buildUserSurvey(doc), { limit: 5 }),
    ]);

    // 결과지(PDF)의 '검사일'. ⚠️ submitted_at 은 **첫 중간 저장** 시각이라 쓰지 않는다.
    //    완주본은 더 이상 갱신되지 않으므로(409) updated_at 이 곧 완주 시각이다.
    // 연령대·성별·직업은 싣지 않는다 — 결과 링크는 주소만 알면 누구나 연다.
    res.json({ success: true, respondent_id, completed_at: doc.updated_at, analysis, recommend: recommend.data });
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

/**
 * POST /api/survey/research/review — 연구 설문 실무자의 **직업 후기** (진로백과 후기 탭에 실린다)
 *
 * 공개 POST /api/job/:jobCode/reviews 와 달리 **응답 번호로 신원을 확인한다**:
 *   - 완주한 실무자 응답만 쓸 수 있다 → 직업(jobCode)은 설문 응답에서 가져온다(조작 불가)
 *   - 응답자당 1건(409) — 같은 사람이 여러 번 올려 한 직업의 후기를 채우지 못하게
 * 성격 태그는 **방금 한 성격 검사의 상위 3개**, 경력은 설문 답 — 응답자가 다시 입력하지 않는다.
 *
 * ⚠️ 상태는 pending. 어드민 승인 후에야 진로백과에 보인다(자유 서술이라 개인정보·부적절 표현 검수).
 * ⚠️ consent 가 true 가 아니면 받지 않는다 — 후기는 진로백과에 **공개되는** 글이다(처리방침 제2조).
 */
const REVIEW_LIMITS = { summary: 60, pros: 1000, cons: 1000, recommendation: 1000, preparation: 1000, dailyLife: 1000 };
const REVIEW_MIN = { pros: 10, cons: 10, recommendation: 10 };

const submitResearchReview = async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!RESPONDENT_ID_RE.test(String(b.respondent_id))) {
      return res.status(400).json({ success: false, error: 'respondent_id 형식이 올바르지 않습니다.' });
    }
    if (b.consent !== true) {
      return res.status(400).json({ success: false, error: '후기 공개에 동의해야 제출할 수 있습니다.' });
    }

    // 문자열 정리 — 앞뒤 공백 제거, 길이 제한
    const text = {};
    for (const [k, max] of Object.entries(REVIEW_LIMITS)) {
      const v = typeof b[k] === 'string' ? b[k].trim() : '';
      if (v.length > max) return res.status(400).json({ success: false, error: `${k} 는 ${max}자 이하여야 합니다.` });
      text[k] = v;
    }
    if (!text.summary) return res.status(400).json({ success: false, error: '한 줄 요약을 입력해주세요.' });
    for (const [k, min] of Object.entries(REVIEW_MIN)) {
      if (text[k].length < min) return res.status(400).json({ success: false, error: `${k} 는 ${min}자 이상 입력해주세요.` });
    }
    const satisfaction = Number(b.satisfaction);
    if (!Number.isInteger(satisfaction) || satisfaction < 0 || satisfaction > 100) {
      return res.status(400).json({ success: false, error: '만족도는 0~100 사이 정수여야 합니다.' });
    }

    const doc = await ResearchSurveyResult.findOne({ respondent_id: b.respondent_id }).lean();
    if (!doc) return res.status(404).json({ success: false, error: '응답을 찾을 수 없습니다.' });
    if (!doc.completed) return res.status(409).json({ success: false, error: '설문을 끝까지 마친 뒤에 후기를 쓸 수 있습니다.' });
    if (doc.respondent?.role !== 'practitioner' || !doc.respondent?.jobCode) {
      return res.status(403).json({ success: false, error: '현재 일하고 계신 분만 직업 후기를 쓸 수 있습니다.' });
    }

    // 성격 태그 = 이 응답자의 성격 검사 상위 3개(결과지와 같은 계산)
    let personalityTags = [];
    try {
      const analysis = await buildSurveyAnalysis({ answers: doc.answers, answer_type: 'type_5' });
      personalityTags = (analysis?.personality?.top3 ?? []).map((f) => f.code).filter(Boolean).slice(0, 3);
    } catch { /* 태그는 보조 정보 — 계산 실패로 후기를 막지 않는다 */ }

    try {
      const review = await JobReview.create({
        jobCode: doc.respondent.jobCode,
        ...text,
        satisfaction,
        personalityTags,
        careerYears: doc.respondent.careerYears || undefined,
        status: 'pending',
        submittedBy: 'research',
        respondentId: doc.respondent_id,
        consentAt: new Date(),
      });
      return res.status(201).json({ success: true, id: review._id, jobCode: review.jobCode, status: review.status });
    } catch (e) {
      if (e?.code === 11000) return res.status(409).json({ success: false, error: '이미 후기를 보내주셨어요.' });
      throw e;
    }
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitResearchResponse,
  getResearchResult,
  getResearchStats,
  submitResearchReview,
  PHASE1_TARGET,
  __test__: { maxStraightRun, isCompleted, lastPartOf },
};
