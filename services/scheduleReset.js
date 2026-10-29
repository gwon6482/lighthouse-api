// 계획이 바뀌면 이번 주부터의 주간 일정을 지운다(2026-10-29).
//
// 주간 일정(weekly-schedule)은 그 주를 처음 열 때 계획 배치로 만들어 저장해 두는 스냅숏이다.
// 그래서 기간·타임라인·프로젝트 요일·루틴을 바꿔도 이미 만든 주는 옛 배치 그대로 남아,
// 오늘 할 일·다가오는 일정이 예전 프로젝트로 나왔다(test5 계정에서 실제로 '쉬는 날'로 보임).
//
// 규칙: **이번 주(오늘이 든 주) 이후 + 아직 결산(reviewed) 안 한 주**만 지운다. 지난 주·결산한 주와
// 완료 기록(achievement_records)은 건드리지 않는다. 앱은 다음에 열 때 새 계획으로 다시 만든다.
// 트레이드오프: 이번 주를 '일정 조정'으로 손봤어도 계획을 바꾸면 다시 계획대로 돌아간다(계획 변경이 우선).
const WeeklySchedule = require('../models/WeeklySchedule');

// 서울 날짜 'YYYY-MM-DD' — 서버 시간대와 상관없이
function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
}

async function resetUpcomingSchedules(planId, userUid, now = new Date()) {
  const r = await WeeklySchedule.deleteMany({ planId, userUid, status: { $ne: 'reviewed' }, weekEnd: { $gte: todayKey(now) } });
  return r.deletedCount ?? 0;
}

module.exports = { resetUpcomingSchedules, todayKey };
