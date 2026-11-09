// 직무 추천 — 결과지 '나에게 맞는 직무 3가지'(2026-11-09). 계산은 services/jobGroups/recommend.js
//
// ⚠️ recommendController 에 넣지 않았다 — services/jobGroups 가 recommendController 를 불러 쓰므로 순환 require 가 된다.
const SurveyResult = require('../models/SurveyResult');
const { buildUserSurvey } = require('./recommendController');
const { buildSurveyAnalysis, ensureSurveyOwnership } = require('./surveyController');
const { recommendJobGroups } = require('../services/jobGroups/recommend');

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

module.exports = { getJobGroupRecommend };
