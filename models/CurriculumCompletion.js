const mongoose = require('mongoose');

// 커리큘럼 항목 단위 완료 체크 1건.
// 프로젝트(projectId)의 N주차(week) 안의 idx 번째 항목을 체크했는지.
// FE localStorage `lh_curriculum_items_v1` (key: `${projectId}:${week}:${idx}`) 와 1:1 대응.
const CurriculumCompletionSchema = new mongoose.Schema({
  userUid: {
    type: String,
    required: true,
    index: true
  },
  planId: {
    type: String,
    required: true,
    index: true
  },
  projectId: {
    type: String,
    required: true
  },
  week: {
    type: Number,
    required: true
  },
  idx: {
    type: Number,
    required: true
  },
  done: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// (userUid, planId, projectId, week, idx) 는 유일
CurriculumCompletionSchema.index(
  { userUid: 1, planId: 1, projectId: 1, week: 1, idx: 1 },
  { unique: true }
);

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('CurriculumCompletion', CurriculumCompletionSchema, 'curriculum_completions');
