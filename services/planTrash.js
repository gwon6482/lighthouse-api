// 진로계획 휴지통(2026-11-04) — 삭제는 바로 지우지 않고 deletedAt 만 찍어 30일 보관, 그 안에는 되돌릴 수 있다.
// 30일이 지나면 예전 삭제와 같이 딸린 기록까지 영구 삭제(userPurge.purgePlan). 크론이 없어 그 사용자의 목록·휴지통을 조회할 때 정리한다.
// ⚠️ 보관 중인 계획은 목록·상세에서 숨긴다(getMyPlans·getPlan). 다른 하위 경로(프로젝트·기록 등)는 막지 않는다 — 화면에서 갈 길이 없다.
const CareerPlan = require('../models/CareerPlan');
const { purgePlan } = require('./userPurge');

const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const purgeAt = (deletedAt) => new Date(new Date(deletedAt).getTime() + TRASH_DAYS * DAY_MS);

// 보관 기간이 지난 이 사용자의 계획을 영구 삭제. 실패해도 조회는 막지 않는다
async function purgeExpiredPlans(uid) {
  const cutoff = new Date(Date.now() - TRASH_DAYS * DAY_MS);
  const expired = await CareerPlan.find({ userUid: uid, deletedAt: { $ne: null, $lt: cutoff } }, { planId: 1 }).lean();
  for (const p of expired) {
    await purgePlan(uid, p.planId).catch((e) => console.warn('[plan-trash] purge', p.planId, e?.message));
  }
  return expired.length;
}

module.exports = { TRASH_DAYS, purgeAt, purgeExpiredPlans };
