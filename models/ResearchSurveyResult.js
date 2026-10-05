// 연구용 설문 응답 — 실무자/예비 사용자에게서 수집하는 데이터.
//
// 🚨 **`survey_results` 와 물리적으로 분리된 컬렉션이다.** 같은 컬렉션에 플래그만 달면
//    조회에서 필터를 빼뜨리는 순간 섞인다. 2026-09-28 에 더미 88건을 실사용자 표본으로
//    오인해 추천 커버리지 「83%」를 내고 공유 docs 에까지 올렸다가 철회한 사고가
//    정확히 그 형태였다. 모집단을 나눠 그 사고를 **원리적으로 불가능**하게 만든다.
//
// ⚠️ **이 응답은 `survey_statistics` 를 갱신하지 않는다.** 사용자가 보는 "상위 N%" 는
//    예비 사용자 분포로 따로 만든다(연구 응답이 섞이면 같은 사고가 반복된다).
//
// 설계 근거는 공유 docs `research/survey-collection-design.md`.
const mongoose = require('mongoose');

const ROLES = ['practitioner', 'prospective'];           // 실무자 / 예비 사용자
const CAREER_YEARS = ['lt1', '1to3', '3to5', '5to10', 'gte10'];
const AGE_GROUPS = ['teens', '20s', '30s', '40s', '50s', '60plus'];
const GENDERS = ['M', 'F', 'none'];

const researchSurveyResultSchema = new mongoose.Schema({
  // 설문지 발급 ID. `GET /api/survey/form` 이 주는 것을 그대로 쓴다.
  survey_id: { type: String, required: true, index: true },

  // ⚠️ **서버가 만드는 난수다.** 이름·연락처는 받지 않는다(처리방침과 맞춘다).
  respondent_id: { type: String, required: true, unique: true },

  respondent: {
    role: { type: String, enum: ROLES, required: true, index: true },

    // 실무자: 현재 직업 / 예비 사용자: 비움.
    // ⚠️ 이게 **정답지의 핵심**이다. 없으면 Recall@K·프로파일·가중치·매핑검증 전부 불가.
    jobCode: { type: String, default: null, index: true },
    jobTitle: { type: String, default: null },   // 조회 편의용 사본(정본은 jobCode)
    // 집계·쏠림 판정에 쓴다. 제출 시점의 분류를 박아둔다
    // (직업 분류가 나중에 바뀌어도 당시 집계를 재현할 수 있어야 한다).
    jobPrimary: { type: String, default: null, index: true },

    careerYears: { type: String, enum: CAREER_YEARS, default: null },

    // 예비 사용자: 희망 직업 **최대 3개**.
    // 🚨 ground truth 가 아니다. 실무자 Recall 과 같은 지표로 섞지 말 것 —
    //    희망은 정보 부족·편견·유행을 포함한다. 별도 지표(Hit@K)로만 쓴다.
    // 🚨 **가중치 최적화의 목적함수에 넣지 말 것.** 넣으면 추천이 '적합한 직업' 대신
    //    '사람들이 이미 원하는 직업' 을 학습한다.
    desiredJobs: {
      type: [{ jobCode: String, jobTitle: String, _id: false }],
      default: [],
      validate: { validator: (v) => v.length <= 3, message: '희망 직업은 최대 3개입니다' },
    },

    ageGroup: { type: String, enum: AGE_GROUPS, default: null },
    gender: { type: String, enum: GENDERS, default: null },

    // 직무 적합감 1~5. 실무자만.
    // ⚠️ **필터가 아니라 가중치로 쓴다.** 낮은 적합감을 걸러내면 표본이 줄고
    //    선택 편향이 생긴다. 다만 이걸 안 받으면 "이 직업 종사자의 특성" 이 아니라
    //    "이 직업에 흘러온 사람의 특성" 을 학습해 **정답지가 오염된다.**
    fitScore: { type: Number, min: 1, max: 5, default: null },
  },

  // `survey_results.answers` 와 **동일 구조**로 둔다. 분석·채점 코드를 그대로 재사용한다.
  answers: { type: Object, required: true },

  // 완주 여부. ⚠️ **집계는 completed:true 만 쓴다**(사용자 결정 2026-10-05).
  //    부분 응답도 저장한다 — 완주율과 이탈 지점을 실측해야 모집 인원을 계산할 수 있다.
  completed: { type: Boolean, default: false, index: true },
  lastPart: { type: String, default: null },   // 이탈 지점 (T1/T21/T22/T23/T3)

  // 응답 품질. 103문항 공개 설문이면 불성실 응답이 **반드시** 섞인다.
  // ⚠️ **삭제하지 않고 플래그만 단다.** 분석 때 포함/제외를 비교해 결론이 뒤집히는지 본다.
  quality: {
    startedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    // 같은 선택지를 연속으로 고른 최대 길이. 20 이상이면 의심한다.
    maxStraightRun: { type: Number, default: null },
    suspect: { type: Boolean, default: false, index: true },
    suspectReasons: { type: [String], default: [] },
  },

  meta: {
    campaign: { type: String, default: null, index: true },  // 수집 경로 태그(QR/링크별)
    userAgent: { type: String, default: null },
  },

  submitted_at: { type: Date, default: Date.now, index: true },
}, { timestamps: { createdAt: 'submitted_at', updatedAt: 'updated_at' } });

// 수집 현황 집계용. 어드민이 "대분류별 유효 응답 수" 를 자주 본다.
researchSurveyResultSchema.index({ 'respondent.role': 1, completed: 1, 'respondent.jobPrimary': 1 });

const surveyDataDb = mongoose.connection.useDb(process.env.SURVEY_DATA_DB || 'survey_data');

module.exports = surveyDataDb.model(
  'ResearchSurveyResult',
  researchSurveyResultSchema,
  'survey_results_research',
);
module.exports.ROLES = ROLES;
module.exports.CAREER_YEARS = CAREER_YEARS;
module.exports.AGE_GROUPS = AGE_GROUPS;
module.exports.GENDERS = GENDERS;
