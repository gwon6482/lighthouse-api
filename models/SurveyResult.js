// 사용자에게서 수신된 설문 결과지의 모델입니다.
const mongoose = require('mongoose');

const surveyResultSchema = new mongoose.Schema({
  survey_id: {
    type: String,
    required: true,
    index: true
  },
  respondent_id: {
    type: String
  },
  submitted_at: {
    type: Date,
    default: Date.now
  },
  answers: {
    type: Object,
    required: true
  },
  converted_answers: {
    type: Object
  },
  T1_result: {
    type: Object
  },
  raw_payload: {
    type: Object
  },
  // 회원 가입 전(비회원) 검사(2026-11-09). 열람 키의 **해시**만 둔다 — 키는 응답자 기기에만 있다.
  // 조회·삭제·계정 연결은 키가 맞을 때만(survey_id 는 시각 형식이라 추측할 수 있다). 연결되면 null
  guest: {
    keyHash: { type: String, default: null }
  },
  // 비회원 응답의 삭제 시각 = 제출 + 24시간(처리방침 제3조). TTL 이 지운다. 계정에 연결되면 null(회원 정보와 같은 기간)
  expireAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: { createdAt: 'submitted_at', updatedAt: false }
});

surveyResultSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// 비회원 응답 보유 시간(처리방침 제3조 — 가입하지 않으면 늦어도 24시간 안에 삭제)
const GUEST_RETENTION_MS = 24 * 60 * 60 * 1000;

const surveyDataDb = mongoose.connection.useDb(process.env.SURVEY_DATA_DB || 'survey_data');
module.exports = surveyDataDb.model('SurveyResult', surveyResultSchema, 'survey_results');
module.exports.GUEST_RETENTION_MS = GUEST_RETENTION_MS; 