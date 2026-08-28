#!/usr/bin/env node
/**
 * 타임라인 주차 전환(2026-08-28) 관련 운영 데이터 점검 — **읽기 전용**.
 *
 * 쓰기·삭제·admin 명령을 하지 않는다. countDocuments 와 소수의 projection 조회만 한다.
 *
 * 왜 필요한가:
 *   주 경계가 "startDate 부터 7일 블록" → "월~일 달력 주" 로 바뀌면서, 서버에 이미 저장된
 *   WeeklySchedule.weekStart 가 새 계산과 어긋날 수 있다. 어긋난 레코드는 조회되지 않고
 *   그 주 일정이 새로 자동 생성된다(크래시 아님, 고아 레코드가 남는 형태).
 *   → 같은 성격의 변경을 다시 하기 전에 "실사용 데이터가 있는가" 를 먼저 세야 한다.
 *
 * 사용:
 *   node scripts/inspect-timeline-week-data.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// 월요일 기준 달력 주의 시작일 — FE usePlanTimeline.mondayOf 와 같은 규칙
function mondayOf(date) {
  const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function toKey(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseKey(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI 가 없습니다 (.env 확인)');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
  const plans = db.collection('career_plans');
  const schedules = db.collection('weekly_schedules');

  const planCount = await plans.countDocuments({});
  const scheduleCount = await schedules.countDocuments({});
  // 타임라인이 실제로 채워진 계획만이 이번 변경의 영향권이다
  const withTimeline = await plans.countDocuments({ 'timeline.0': { $exists: true } });
  // week 없이 month 만 있는 구 슬롯 — read 시 _weekFromLegacyMonth 로 환산되는 대상
  const legacySlots = await plans.countDocuments({ timeline: { $elemMatch: { week: null, month: { $ne: null } } } });

  console.log('── career_plans ──');
  console.log(`  전체            : ${planCount}`);
  console.log(`  타임라인 있음   : ${withTimeline}`);
  console.log(`  레거시 month 슬롯: ${legacySlots}`);
  console.log('── weekly_schedules ──');
  console.log(`  전체            : ${scheduleCount}`);

  // weekStart 가 월요일이 아닌 레코드 = 구 주 경계로 만들어진 것
  let notMonday = 0;
  let checked = 0;
  const cursor = schedules.find({}, { projection: { weekStart: 1, planId: 1 } });
  for await (const doc of cursor) {
    const d = parseKey(doc.weekStart);
    if (!d) continue;
    checked++;
    if (toKey(mondayOf(d)) !== toKey(d)) notMonday++;
  }
  console.log(`  weekStart 검사  : ${checked}건 중 월요일 아님 ${notMonday}건`);

  // 영향 범위 — 몇 명의, 언제 만들어진 데이터인가.
  // 전부 테스트 계정이면 마이그레이션 대신 폐기해도 된다.
  const uids = await plans.distinct('userUid');
  console.log(`  계획 소유자 수  : ${uids.length}명`);

  const bad = await schedules
    .find({}, { projection: { weekStart: 1, planId: 1, createdAt: 1, items: 1 } })
    .toArray();
  const offenders = bad.filter(doc => {
    const d = parseKey(doc.weekStart);
    return d && toKey(mondayOf(d)) !== toKey(d);
  });
  if (offenders.length) {
    console.log('\n── 구 주 경계 레코드 상세 ──');
    for (const o of offenders) {
      const when = o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : '?';
      // 단순히 weekStart 를 월요일로 옮기면 끝나지 않는다.
      // 구 주는 weekStart..+6 (예: 수~화) 였으므로, 새 월~일 창 밖으로 나가는 항목이 생긴다.
      const newStart = mondayOf(parseKey(o.weekStart));
      const newEnd = new Date(newStart); newEnd.setDate(newEnd.getDate() + 6);
      const ks = toKey(newStart), ke = toKey(newEnd);
      const outside = (o.items || []).filter(it => it.date < ks || it.date > ke).length;
      console.log(
        `  weekStart ${o.weekStart} (${['일','월','화','수','목','금','토'][parseKey(o.weekStart).getDay()]})`
        + ` → ${ks} · 항목 ${(o.items || []).length}건 중 새 창 밖 ${outside}건 · 생성 ${when}`
        + ` · plan ${String(o.planId).slice(0, 8)}…`,
      );
    }

    // 월요일로 옮겼을 때 (planId, weekStart) 유니크 인덱스와 충돌하는지
    const keys = new Set(bad.map(x => `${x.planId}|${x.weekStart}`));
    let collide = 0;
    for (const o of offenders) {
      const k = `${o.planId}|${toKey(mondayOf(parseKey(o.weekStart)))}`;
      if (keys.has(k)) collide++;
    }
    console.log(`  → 월요일 이동 시 (planId, weekStart) 유니크 충돌: ${collide}건`);
  }

  console.log('');
  if (scheduleCount === 0 && withTimeline === 0) {
    console.log('✅ 실사용 데이터 없음 — 주 경계 변경에 마이그레이션 불필요');
  } else if (notMonday === 0) {
    console.log('✅ 모든 weekStart 가 월요일 — 새 주 경계와 정합');
  } else {
    console.log(`⚠️  구 주 경계 레코드 ${notMonday}건 — 마이그레이션 필요`);
  }

  await mongoose.disconnect();
})().catch(err => {
  console.error('실패:', err.message);
  process.exit(1);
});
