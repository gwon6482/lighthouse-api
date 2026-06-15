const mongoose = require('mongoose');

// 진로달성 실행 기록 1건.
// 사용자가 특정 날짜(date)에 특정 프로젝트/루틴(itemType+itemId)을 완료한 상태와
// 완료 페이지에서 남긴 인증 기록(사진/난이도/메모/소요시간)을 한 도큐먼트로 통합 저장.
// - done 만 true 이고 나머지가 비어있으면: 단순 완료 토글 (Schedule/WeeklyReview 페이지)
// - 전체 필드가 채워지면: 완료 페이지(CompletePage)에서 남긴 인증 기록
const AchievementRecordSchema = new mongoose.Schema({
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
  date: {                                       // 'YYYY-MM-DD'
    type: String,
    required: true
  },
  itemType: {
    type: String,
    enum: ['project', 'routine'],
    required: true
  },
  itemId: {
    type: String,
    required: true
  },
  done: {
    type: Boolean,
    default: true
  },
  // ── 인증 기록 (CompletePage) — 단순 토글이면 비어있을 수 있음 ──
  itemName:       { type: String, default: '' },
  itemCategory:   { type: String, default: '' },   // ProjectCategory (project 일 때만)
  duration:       { type: Number, default: 0 },     // 계획된 duration(분)
  elapsedSec:     { type: Number, default: 0 },     // 실제 소요시간(초)
  doneAt:         { type: Date,   default: null },  // 인증 완료 시각
  photoUrl:       { type: String, default: '' },    // S3 업로드 URL (base64 저장 안 함)
  difficulty:     { type: Number, default: null, min: 1, max: 5 },
  note:           { type: String, default: '' },
  curriculumWeek: { type: Number, default: null }
}, {
  timestamps: true
});

// (userUid, planId, date, itemType, itemId) 는 유일 — 같은 날 같은 항목은 1건만
AchievementRecordSchema.index(
  { userUid: 1, planId: 1, date: 1, itemType: 1, itemId: 1 },
  { unique: true }
);
// 피드(최신순) 조회용
AchievementRecordSchema.index({ userUid: 1, planId: 1, doneAt: -1 });

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('AchievementRecord', AchievementRecordSchema, 'achievement_records');
