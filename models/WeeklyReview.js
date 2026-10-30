const mongoose = require('mongoose');

// 주간결산 기록(2026-10-30) — 한 계획의 한 주(시작 요일부터 7일)당 1건. planId + weekStart 로 식별.
// 주간 일정(WeeklySchedule)에 붙이지 않고 따로 둔다: 결산하는 지난 주에 일정 문서가 없을 때 새로 만들면
// 앱이 그 주의 '그날 할 일'을 빈 일정으로 읽어 버리기 때문.
// 결산하지 않고 지나간 주는 문서가 없다(사용자 결정: 건너뜀 = 기록 없음). promptedAt 만 있는 문서 = 팝업만 본 주.
const StatsSchema = new mongoose.Schema({
  planned:        { type: Number, default: 0 },
  done:           { type: Number, default: 0 },
  percent:        { type: Number, default: 0 },
  fullDays:       { type: Number, default: 0 },
  workDays:       { type: Number, default: 0 },
  minutes:        { type: Number, default: 0 },
  photos:         { type: Number, default: 0 },
  streak:         { type: Number, default: 0 },
  progressBefore: { type: Number, default: 0 },   // 전체 진행 % — 결산한 주 전
  progressAfter:  { type: Number, default: 0 },   // 결산한 주 끝
  gainItems:      { type: Number, default: 0 },   // 그 주에 끝낸 커리큘럼 항목 수
}, { _id: false });

const WeeklyReviewSchema = new mongoose.Schema({
  planId:   { type: String, required: true, index: true },
  userUid:  { type: String, required: true, index: true },
  weekStart: { type: String, required: true },   // 'YYYY-MM-DD'
  weekEnd:   { type: String, default: '' },
  weekNo:    { type: Number, default: null },     // 계획의 몇 주차였나
  promptedAt:  { type: Date, default: null },     // 결산 팝업을 띄운 때(한 주 한 번)
  completedAt: { type: Date, default: null },     // 결산을 마친 때. null 이면 미완료
  satisfaction: { type: Number, min: 1, max: 5, default: null },
  note:    { type: String, default: '', maxlength: 200 },
  pledge:  { type: String, default: '', maxlength: 200 },
  feel:    { type: String, enum: ['', 'tight', 'fit', 'loose'], default: '' },   // 이번 주 속도 느낌
  paceFrom: { type: String, default: '' },        // 바꾸기 전 속도 키
  paceTo:   { type: String, default: '' },        // 다음 주부터 속도 키(같으면 유지)
  endDateFrom: { type: String, default: '' },     // 속도를 바꿨다면 완료 예정 전·후
  endDateTo:   { type: String, default: '' },
  stats: { type: StatsSchema, default: () => ({}) },
}, { timestamps: true });

WeeklyReviewSchema.index({ planId: 1, userUid: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyReview', WeeklyReviewSchema, 'weekly_reviews');
