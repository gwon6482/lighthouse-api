const mongoose = require('mongoose');

const CurriculumWeekSchema = new mongoose.Schema({
  week:  { type: Number },
  title: { type: String, default: '' },
  items: { type: [String], default: [] }
}, { _id: false });

const PublicProjectSchema = new mongoose.Schema({
  id:               { type: String, required: true },
  category:         { type: String, enum: ['qualification', 'knowledge', 'skill', 'portfolio'], required: true },
  name:             { type: String, required: true },
  goal:             { type: String, default: '' },
  days:             { type: [String], default: [] },
  duration:         { type: Number, default: 0 },
  priority:         { type: String, default: 'normal' },
  notification:     { type: Boolean, default: false },
  missedNotification: { type: Boolean, default: false },
  notificationTime: { type: String, default: '' },
  memo:             { type: String, default: '' },
  source:           { type: String, default: '' },
  field:            { type: String, default: '' },
  level:            { type: String, default: '' },
  weeks:            { type: Number, default: 0 },
  description:      { type: String, default: '' },
  tags:             { type: [String], default: [] },
  likes:            { type: Number, default: 0 },
  views:            { type: Number, default: 0 },
  curriculum:       { type: [CurriculumWeekSchema], default: [] }
}, { _id: false });

const TimelineItemSchema = new mongoose.Schema({
  projectId:   { type: String },
  projectName: { type: String },
  category:    { type: String },
  date:        { type: String }
}, { _id: false });

const TimelineMonthSchema = new mongoose.Schema({
  label: { type: String },
  items: { type: [TimelineItemSchema], default: [] }
}, { _id: false });

const PublicCareerPlanSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  targetJob:    { type: String, required: true },
  author:       { type: String, default: '' },
  duration:     { type: String, default: '' },
  description:  { type: String, default: '' },
  tags:         { type: [String], default: [] },
  likes:        { type: Number, default: 0 },
  views:        { type: Number, default: 0 },
  routineCount: { type: Number, default: 0 },
  projects:     { type: [PublicProjectSchema], default: [] },
  timeline:     { type: [TimelineMonthSchema], default: [] },
  isActive:     { type: Boolean, default: true }
}, {
  timestamps: true
});

PublicCareerPlanSchema.index({ name: 'text', targetJob: 'text', tags: 'text' });
PublicCareerPlanSchema.index({ likes: -1 });

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('PublicCareerPlan', PublicCareerPlanSchema, 'public_career_plans');
