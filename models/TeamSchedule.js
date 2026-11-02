const mongoose = require('mongoose');

// 어드민 '일정관리'(2026-11-02) — 팀 내부 기록·개발일정·향후 계획·할 일. 서비스 사용자 데이터가 아니라서
// 별도 DB(admin_data)에 둔다. 개발일지(devlog)는 여기 저장하지 않는다 — 어드민이 lighthouse-docs 에서 바로 읽는다.
//
// kind
//   record   프로젝트 기록(회의·결정·출시 등 있었던 일) — 날짜 하나 또는 기간
//   schedule 개발일정 — 카테고리별 작업 기간
//   plan     향후 계획 — 대략의 시작일(마일스톤)
//   todo     할 일 — 날짜 없어도 됨(endDate = 마감)
const KINDS = ['record', 'schedule', 'plan', 'todo'];
// 파트 기준 카테고리(사용자 결정 2026-11-02). 라벨·색은 어드민 화면이 갖는다
const CATEGORIES = ['api', 'app', 'admin', 'landing', 'planning', 'design', 'data', 'ops'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const adminDb = mongoose.connection.useDb(process.env.ADMIN_DATA_DB || 'admin_data');

const TeamScheduleItemSchema = new mongoose.Schema({
  kind:      { type: String, enum: { values: KINDS, message: '종류가 올바르지 않습니다' }, required: [true, '종류를 골라 주세요'] },
  title:     { type: String, required: [true, '제목을 넣어 주세요'], trim: true, maxlength: 100 },
  memo:      { type: String, default: '', maxlength: 2000 },
  category:  { type: String, enum: { values: CATEGORIES, message: '카테고리가 올바르지 않습니다' }, required: [true, '카테고리를 골라 주세요'] },
  assignee:  { type: String, default: '', trim: true, maxlength: 30 },   // 팀원 이름(team_members.name). 비면 팀 공용
  startDate: { type: String, default: '', match: [/^$|^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'] },
  endDate:   { type: String, default: '', match: [/^$|^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'] },   // 비면 startDate 하루
  done:      { type: Boolean, default: false },
  link:      { type: String, default: '', trim: true, maxlength: 300 },
}, { timestamps: true });

TeamScheduleItemSchema.index({ startDate: 1 });

const TeamMemberSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true, maxlength: 30, unique: true },
  color: { type: String, default: '', match: [/^$|^#[0-9a-fA-F]{6}$/, '#RRGGBB'] },
}, { timestamps: true });

module.exports = {
  TeamScheduleItem: adminDb.model('TeamScheduleItem', TeamScheduleItemSchema, 'team_schedule_items'),
  TeamMember: adminDb.model('TeamMember', TeamMemberSchema, 'team_members'),
  KINDS,
  CATEGORIES,
  DATE_RE,
};
