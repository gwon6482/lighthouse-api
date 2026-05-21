const mongoose = require('mongoose');
const crypto = require('crypto');

// ── 프로젝트 서브스키마 ──────────────────────────────────────
// FE: curriculum = [{ week, title, items: string[] }]

const CurriculumWeekSchema = new mongoose.Schema({
  week:  { type: Number, required: true },
  title: { type: String, default: '' },
  items: { type: [String], default: [] }   // string[] (FE 포맷 그대로)
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  id:               { type: String, default: () => crypto.randomUUID() },
  name:             { type: String, required: true, trim: true },
  category:         { type: String, enum: ['qualification', 'knowledge', 'skill', 'portfolio'], required: true },
  goal:             { type: String, default: '' },
  days:             { type: [String], default: [] },
  startTime:        { type: String, default: '' },
  endTime:          { type: String, default: '' },
  // FE 추가 필드 (있으면 저장, 없어도 OK)
  duration:         { type: Number, default: 0 },
  priority:         { type: String, default: 'normal' },
  notification:     { type: Boolean, default: false },
  notificationTime: { type: String, default: '' },
  memo:             { type: String, default: '' },
  curriculum:       { type: [CurriculumWeekSchema], default: [] }
}, { _id: false });

// ── 타임라인 서브스키마 ──────────────────────────────────────
// 타임라인 슬롯에는 projectId 배열만 저장 (중복 저장 없음)

const TimelineSlotSchema = new mongoose.Schema({
  month:      { type: String, required: true },   // 'YYYY.MM'
  projectIds: { type: [String], default: [] }
}, { _id: false });

// ── 진로계획 메인 스키마 ─────────────────────────────────────

const CareerPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    unique: true,
    default: () => crypto.randomUUID()
  },
  userUid: {
    type: String,
    required: true,
    index: true
  },
  name:       { type: String, default: '' },
  targetJob:  { type: String, default: '' },
  duties:     { type: [String], default: [] },
  startDate:  { type: String, default: '' },   // 'YYYY-MM'
  endDate:    { type: String, default: '' },   // 'YYYY-MM'
  projects:   { type: [ProjectSchema], default: [] },
  timeline:   { type: [TimelineSlotSchema], default: [] },
  status: {
    type: String,
    enum: ['draft', 'active', 'completed'],
    default: 'draft'
  }
}, {
  timestamps: true
});

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('CareerPlan', CareerPlanSchema, 'career_plans');
