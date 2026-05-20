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
