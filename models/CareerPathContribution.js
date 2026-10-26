const mongoose = require('mongoose');

// 직업인 진로과정 참여 — 랜딩 www /career-path (비회원, 2026-10-26~)
//
// 두 갈래:
//   mine   = 나의 진로과정 등록하기: 직업 안의 방향(트랙) + 실제로 해 온 것(12종) + 돌아보는 의견
//   review = 라이트하우스 진로과정 살펴보기: 우리 템플릿(직업 × 단계)에 대한 수정·빼기·추가·의견 (원본 대비 바뀐 것만)
// 받은 것은 검수(어드민) 뒤 진로계획 템플릿에 반영한다 — 작성자를 밝히지 않는다.
//
// 🔒 개인정보처리방침 제2조 6(2026-11-02 시행):
//   - 이름·연락처·이메일·User-Agent 는 받지 않는다. 받는 항목을 늘리려면 처리방침부터 고칠 것
//   - contribution_id = 제출 확인 번호. 삭제 요청은 이 번호로 받는다(제6조) → 완료 화면에 반드시 보여준다
//   - 보유 3년(제3조) → createdAt TTL 인덱스로 자동 삭제
// 종류·영역·방식은 config/projectMethods.js 가 정본(앱·랜딩과 동기화)
const { CONTRIBUTION_KINDS: KINDS, CATEGORIES, PROJECT_METHODS, PREP_METHODS } = require('../config/projectMethods');
const STAGES = ['nonmajor', 'major', 'career'];
const CHANGE_TYPES = ['add', 'delete', 'edit', 'comment'];
const STATUSES = ['pending', 'approved', 'rejected'];
const RETENTION_SECONDS = 3 * 365 * 24 * 60 * 60;

const entrySchema = new mongoose.Schema({
  order: Number,
  kind: { type: String, enum: KINDS, required: true },
  category: { type: String, enum: CATEGORIES, required: true },   // 기본은 종류에서 정해진 값. 검수 때 바꿀 수 있다
  method: { type: String, enum: [...PROJECT_METHODS, null], default: null },   // 앱 진행 방식(서버가 종류·prep 에서 정한다)
  prep: { type: String, enum: [...PREP_METHODS, null], default: undefined },  // 자격증·어학을 어떻게 준비했나
  amount: String,                  // 얼마나(반복 연습·콘텐츠·스터디) — 템플릿 목표량의 근거
  name: { type: String, required: true },
  link: String,                    // 책·강의는 필수(차시 구성은 우리가 조사)
  weeks: Number,
  hoursPerWeek: Number,
  why: String,
  items: [String],
}, { _id: false });

const changeSchema = new mongoose.Schema({
  type: { type: String, enum: CHANGE_TYPES, required: true },
  id: String,                      // 템플릿 프로젝트 id (add 는 없음)
  at: Number,                      // add 의 위치
  name: String,
  goal: String,
  weeks: { type: [String], default: undefined },   // 없으면 '주차 안 고침', [] 면 '전부 지움' — 기본값 [] 를 두면 둘이 구분되지 않는다
  comment: String,
  reason: String,                  // delete 이유
}, { _id: false });

const careerPathContributionSchema = new mongoose.Schema({
  contribution_id: { type: String, required: true, unique: true },   // 제출 확인 번호 cpc_<18hex>
  type: { type: String, enum: ['mine', 'review'], required: true, index: true },
  status: { type: String, enum: STATUSES, default: 'pending', index: true },
  reviewNote: { type: String, default: '' },     // 검수 메모(어드민)
  reviewedAt: Date,

  profile: {
    jobCode: { type: String, required: true, index: true },
    jobTitle: String,                            // 서버가 직업 DB 에서 채운다
    careerYears: { type: String, required: true },
    startStage: { type: String, enum: STAGES, required: true },
  },
  // 연구 설문 결과 화면에서 이어서 들어온 경우만. 직업·경력 확인용(처리방침 제2조 6)
  respondent_id: { type: String, default: undefined, index: true },

  mine: {
    track: { id: String, name: String, desc: String, isNew: Boolean },
    entries: { type: [entrySchema], default: undefined },
    retro: { must: String, skip: String, redo: String },
  },
  review: {
    templateJobCode: String,
    stages: {
      type: [{ stage: { type: String, enum: STAGES }, reordered: Boolean, order: [String], changes: [changeSchema], _id: false }],
      default: undefined,
    },
    overall: String,
  },

  consentAt: { type: Date, required: true },
  meta: {
    campaign: { type: String, default: null, index: true },   // '__local_test__' = 테스트(현황에서 제외, 일괄 삭제)
  },
}, { timestamps: true, collection: 'career_path_contributions' });

// 보유 3년 후 자동 삭제(처리방침 제3조). ⚠️ 기간을 바꾸면 기존 인덱스를 지우고 다시 만들어야 한다(Mongo 는 TTL 값 변경을 자동 반영하지 않음)
careerPathContributionSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

module.exports = mongoose.model('CareerPathContribution', careerPathContributionSchema);
module.exports.KINDS = KINDS;
module.exports.CATEGORIES = CATEGORIES;
module.exports.STAGES = STAGES;
module.exports.CHANGE_TYPES = CHANGE_TYPES;
module.exports.STATUSES = STATUSES;
