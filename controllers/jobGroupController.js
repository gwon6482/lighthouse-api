// 직무 추천 — 결과지 '나에게 맞는 직무 3가지'(2026-11-09). 계산은 services/jobGroups/recommend.js
//
// ⚠️ recommendController 에 넣지 않았다 — services/jobGroups 가 recommendController 를 불러 쓰므로 순환 require 가 된다.
const SurveyResult = require('../models/SurveyResult');
const { buildUserSurvey } = require('./recommendController');
const { buildSurveyAnalysis, ensureSurveyOwnership } = require('./surveyController');
const { recommendJobGroups } = require('../services/jobGroups/recommend');
const { guestKeyMatches } = require('../services/guestSurvey');

// GET /api/job/recommend-groups/:survey_id  (로그인 필요)
// 로그인·본인 확인을 거는 이유: 카드의 이유 문장에 결과지 항목 이름(성격 Top 3 · 가치관 등)이 들어간다 —
// 그 이름을 주는 분석 API(/api/survey/analysis)와 같은 보호를 건다
const getJobGroupRecommend = async (req, res, next) => {
  try {
    const { survey_id } = req.params;
    const surveyResult = await SurveyResult.findOne({ survey_id }).lean();
    if (!surveyResult) {
      return res.status(404).json({ success: false, error: `survey_id '${survey_id}'에 해당하는 검사 결과를 찾을 수 없습니다.` });
    }
    if (!(await ensureSurveyOwnership(req, res, survey_id))) return;

    // 이유 문장의 이름은 결과지와 **같은 함수**로 만든다 — 결과지에 없는 이름이 이유로 나오면 안 된다
    const analysis = await buildSurveyAnalysis({
      answers: surveyResult.answers,
      answer_type: surveyResult.raw_payload?.answer_type,
      T1_result: surveyResult.T1_result || null,
    });
    const groups = await recommendJobGroups(buildUserSurvey(surveyResult), analysis);
    res.json({ success: true, survey_id, groups });
  } catch (error) {
    next(error);
  }
};

// GET /api/survey/guest/:survey_id/job-groups  (비회원, 헤더 x-guest-key) — 결과지 잠금 화면의 '직무 맛보기'(2026-11-11)
// 1위 직무 이름과 개수만 준다. 2·3위·추천 이유·직업 목록은 가입 뒤 /api/job/recommend-groups 로 —
// 잠금이 화면에서만 걸리지 않게 응답부터 줄인다(비회원 분석 API 는 본인 응답이라 전부 주는 것과 다르다)
const getGuestJobGroupTeaser = async (req, res, next) => {
  try {
    const { survey_id } = req.params;
    const doc = await SurveyResult.findOne({ survey_id }).lean();
    if (!doc || !guestKeyMatches(doc, req.get('x-guest-key'))) {
      // 비회원 분석 API 와 같은 404 — 없는 검사와 키가 틀린 경우를 구분하지 않는다
      return res.status(404).json({ success: false, error: '결과를 찾을 수 없습니다. 이미 삭제됐을 수 있어요.' });
    }
    const analysis = await buildSurveyAnalysis({
      answers: doc.answers,
      answer_type: doc.raw_payload?.answer_type,
      T1_result: doc.T1_result || null,
    });
    const groups = await recommendJobGroups(buildUserSurvey(doc), analysis);
    res.json({
      success: true,
      survey_id,
      top: groups[0] ? { code: groups[0].code, name: groups[0].name } : null,
      groupCount: groups.length,
      jobCount: groups.reduce((n, g) => n + (g.jobCount || 0), 0),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getJobGroupRecommend, getGuestJobGroupTeaser };
