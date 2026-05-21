const mongoose = require('mongoose');
const crypto = require('crypto');

// ── 프로젝트 서브스키마 ──────────────────────────────────────

const CurriculumItemSchema = new mongoose.Schema({
  text: { type: String, required: true }
}, { _id: false });

const CurriculumWeekSchema = new mongoose.Schema({
  week:  { type: Number, required: true },
  items: { type: [CurriculumItemSchema], default: [] }
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  id:         { type: String, default: () => crypto.randomUUID() },
  name:       { type: String, required: true, trim: true },
  category:   { type: String, enum: ['qualification', 'knowledge', 'skill', 'portfolio'], required: true },
  goal:       { type: String, default: '' },
  days:       { type: [String], default: [] },
  startTime:  { type: String, default: '' },
  endTime:    { type: String, default: '' },
  curriculum: { type: [CurriculumWeekSchema], default: [] }
}, { _id: false });

// ── 타임라인 서브스키마 ──────────────────────────────────────

const TimelineSlotSchema = new mongoose.Schema({
  month:    { type: String, required: true },   // 'YYYY.MM'
  projects: { type: [ProjectSchema], default: [] }
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
