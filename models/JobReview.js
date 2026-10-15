const mongoose = require('mongoose');

const jobReviewSchema = new mongoose.Schema(
  {
    jobCode: { type: String, required: true, index: true },
    summary: { type: String, required: true },
    satisfaction: { type: Number, required: true, min: 0, max: 100 },
    pros: { type: String, required: true },
    cons: { type: String, required: true },
    recommendation: { type: String, required: true },
    personalityTags: {
      type: [String],
      enum: ['E', 'C', 'S', 'A', 'I', 'R', 'G', 'U', 'T'],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    // 'research' = 연구 설문(랜딩 /survey)의 실무자가 쓴 후기 (2026-10-15~)
    submittedBy: { type: String, enum: ['user', 'admin', 'research'], default: 'user' },
    submitterEmail: { type: String, default: '' },
    adminNote: { type: String, default: '' },

    // ── 연구 설문 후기에서 오는 값 (다른 경로에선 비어 있다) ──
    // 🔒 **공개 응답에 싣지 않는다.** 이 번호로 결과지(검사 응답)를 열 수 있다.
    //    한 응답자당 후기 1건 · 삭제 요청 시 대조용
    respondentId: { type: String, default: undefined },
    // 경력 연차 — 연구 설문 CAREER_YEARS 값. 앱이 "경력 3~5년" 으로 보여준다
    careerYears: { type: String, enum: ['lt1', '1to3', '3to5', '5to10', 'gte10'], default: undefined },
    // 선택 서술 항목
    preparation: { type: String, default: '' }, // 이 직업을 갖기까지 어떻게 준비했나
    dailyLife: { type: String, default: '' },   // 평소 하루는 어떻게 흘러가나
    // 진로백과 공개·이용 동의 시각 (연구 설문 후기는 동의 없이 받지 않는다)
    consentAt: { type: Date, default: undefined },
  },
  { timestamps: true }
);

// 한 응답자당 후기 1건. 다른 경로(어드민·앱) 후기에는 respondentId 가 없으므로 부분 인덱스로 건다
jobReviewSchema.index(
  { respondentId: 1 },
  { unique: true, partialFilterExpression: { respondentId: { $type: 'string' } } },
);

const jobDataDb = mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data');
module.exports = jobDataDb.model('JobReview', jobReviewSchema, 'job_reviews');
