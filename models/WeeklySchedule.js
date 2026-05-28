const mongoose = require('mongoose');
const crypto = require('crypto');

// 그 주에 실제로 잡힌 일정 항목 1개.
// itemType + itemId 로 CareerPlan.projects 또는 CareerPlan.routines 의 원본을 가리킨다.
// date 는 구체적인 'YYYY-MM-DD'. 같은 itemId 라도 여러 날짜에 잡힐 수 있다.
const ScheduleItemSchema = new mongoose.Schema({
  id:             { type: String, default: () => crypto.randomUUID() },
  itemType:       { type: String, enum: ['project', 'routine'], required: true },
  itemId:         { type: String, required: true },
  date:           { type: String, required: true },   // 'YYYY-MM-DD'
  curriculumWeek: { type: Number, default: null },     // 프로젝트의 N주차 (선택)
  note:           { type: String, default: '' }
}, { _id: false });

// 한 주의 확정된 일정. planId + weekStart 로 식별.
// 진로계획 본체(러프 마스터)에서 그 주에 어떤 항목을 어느 날 할지 매주 review 단계에서 확정.
const WeeklyScheduleSchema = new mongoose.Schema({
  scheduleId: {
    type: String,
    unique: true,
    default: () => crypto.randomUUID()
  },
  planId: {
    type: String,
    required: true,
    index: true
  },
  userUid: {
    type: String,
    required: true,
    index: true
  },
  weekStart: {                                          // 'YYYY-MM-DD' 그 주의 시작일
    type: String,
    required: true
  },
  weekEnd: {                                            // 'YYYY-MM-DD' 그 주의 끝일 (= 다음 review 요일)
    type: String,
    required: true
  },
  items: {
    type: [ScheduleItemSchema],
    default: []
  },
  reviewedAt: {                                         // 회고 완료 시각. null 이면 아직 review 안 한 주
    type: Date,
    default: null
  },
  reviewNote: {                                         // 자유 회고 메모
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// planId + weekStart 는 유일 (한 plan 에서 같은 주는 1개만)
WeeklyScheduleSchema.index({ planId: 1, weekStart: 1 }, { unique: true });

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('WeeklySchedule', WeeklyScheduleSchema, 'weekly_schedules');
