const mongoose = require('mongoose');
const crypto = require('crypto');

// ── 소스 서브스키마 ─────────────────────────────────────────

const AuthProviderSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['local', 'google', 'kakao'],
    required: true
  },
  providerId: {
    type: String,
    required: true
  },
  connectedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const DeviceSchema = new mongoose.Schema({
  deviceToken: { type: String, required: true },        // FCM / APNs 토큰
  platform: {
    type: String,
    enum: ['ios', 'android', 'web'],
    required: true
  },
  deviceId:     { type: String, required: true },       // 기기 고유 식별자 (중복 방지)
  registeredAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now }
}, { _id: false });

// 회원가입 마지막 3단계에서 받는 진로 온보딩 답변.
// ⚠️ 값은 전부 **숫자 코드**다. 선택지 문구가 여기 없으면 나중에 아무도 해석할 수 없으므로
// 원문을 그대로 적어둔다. 문구를 바꾸면 코드 의미가 달라지니 이 표도 같이 고칠 것.
// 출처: lighthouse-test `modules/onboarding/pages/SignupWizardPage.vue` 의 Q1/Q2/Q3
const OnboardingSchema = new mongoose.Schema({
  // Q1 "지금 어떤 상황이신가요?" (단일 선택)
  //   1 중·고등학생  2 대학생(휴학 포함)  3 취업 준비 중
  //   4 일하고 있지만 진로를 다시 고민 중
  status: { type: Number, min: 1, max: 4 },

  // Q2 "요즘 진로에 대해 어떤 고민이 있나요?" (복수 선택)
  //   1 무엇을 좋아하고 잘하는지 모르겠음
  //   2 선택 가능한 진로 분야를 모르겠음
  //   3 관심 분야는 있으나 진로로 정해도 될지 모르겠음
  //   4 목표는 있으나 무엇부터 준비할지 모르겠음
  //   5 노력 중이나 방법이 맞는지 확신이 없음
  //   6 아직 잘 모르겠음  ← FE 에서 **단독 선택**으로 강제된다(Q2_NONE)
  concerns: {
    type: [Number],
    default: undefined,
    validate: {
      validator: (v) => !v || v.every((n) => Number.isInteger(n) && n >= 1 && n <= 6),
      message: 'concerns 는 1~6 사이 정수만 허용됩니다'
    }
  },

  // Q3 "나 자신에 대해 얼마나 알고 있다고 생각하세요?" (단일 선택)
  //   1 잘 알고 있음  2 조금 알고 있음  3 거의 모름
  selfAwareness: { type: Number, min: 1, max: 3 },

  answeredAt: { type: Date, default: Date.now }
}, { _id: false });

const SettingsSchema = new mongoose.Schema({
  notifications: {
    push:  { type: Boolean, default: true },
    email: { type: Boolean, default: true }
  },
  language: { type: String, enum: ['ko', 'en'], default: 'ko' },
  theme:    { type: String, enum: ['light', 'dark', 'auto'], default: 'light' }
}, { _id: false });

// ── 메인 유저 스키마 ────────────────────────────────────────

const UserSchema = new mongoose.Schema({

  // 식별
  uid: {
    type: String,
    unique: true,
    default: () => crypto.randomUUID()
  },

  // 인증 정보
  email: {
    type: String,
    unique: true,
    sparse: true,   // OAuth 계정 중 이메일 없는 경우 허용
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String    // local 로그인 전용. OAuth 유저는 null
  },
  authProviders: {
    type: [AuthProviderSchema],
    default: []
    // 예: [{ provider: 'google', providerId: '109234...', connectedAt }]
    //     [{ provider: 'local',  providerId: 'user@email.com', connectedAt }]
  },

  // 자기이해 검사 결과
  // survey_data DB survey_results 컬렉션의 survey_id 참조
  surveyResults: {
    type: [String],
    default: []
  },

  // 진로백과 관심 직업
  // job_data DB job_info 컬렉션의 jobCode 참조
  bookmarkedJobs: {
    type: [String],
    default: []
  },

  // 검사 결과 기반 종합 추천 직업 (jobCode 목록, 최대 30)
  recommendedJobs: {
    type: [String],
    default: []
  },

  // 목표 진로
  // refType: 'jobCode' → job_data DB job_info 컬렉션의 jobCode 참조
  // refType: 'custom'  → 추후 custom_career 컬렉션 UID 참조 (진로백과에 없는 직업)
  targetCareer: {
    refType: { type: String, enum: ['jobCode', 'custom'] },
    ref:     { type: String }
  },

  // 진로설계 (미구현 — 추후 careerDesign 컬렉션 UID로 교체)
  careerDesigns: {
    type: [String],
    default: []
  },

  // 진로달성 (미구현 — 추후 careerAchievement 컬렉션 UID로 교체)
  careerAchievements: {
    type: [String],
    default: []
  },

  // 개인 설정값
  settings: {
    type: SettingsSchema,
    default: () => ({})
  },

  // 로그인 기기 목록 (푸시 알림용)
  devices: {
    type: [DeviceSchema],
    default: []
  },

  // 진로 온보딩 답변 (회원가입 3~5단계)
  // 2026-09-09 추가. 그 전 가입자는 이 필드가 없다 — 집계 시 반드시 존재 여부를 확인할 것.
  onboarding: {
    type: OnboardingSchema,
    default: undefined   // 답 안 하고 가입한 계정에 빈 객체를 만들지 않는다
  },

  // 프로필
  name:   { type: String, trim: true },
  age:    { type: Number, min: 1, max: 120 },
  gender: { type: String, enum: ['M', 'F'] },

  // 계정 상태
  isActive:    { type: Boolean, default: true },
  lastLoginAt: { type: Date }

}, {
  timestamps: true  // createdAt, updatedAt 자동
});

// ── 인덱스 ──────────────────────────────────────────────────

UserSchema.index({ 'authProviders.provider': 1, 'authProviders.providerId': 1 });
UserSchema.index({ 'devices.deviceId': 1 });

// ── toJSON: passwordHash 제외 ───────────────────────────────

UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  }
});

// ── DB 연결 ─────────────────────────────────────────────────

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('User', UserSchema, 'users');
