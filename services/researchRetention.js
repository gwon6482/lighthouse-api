// 연구 설문 응답 보유기간 — 배포(서버 시작) 때 expireAt 이 비어 있는 문서를 채운다(2026-11-09).
//
// 삭제 자체는 Mongo TTL 인덱스가 한다(models/ResearchSurveyResult.js, expireAt). TTL 은 값이 없는 문서를 건드리지 않으므로
// 이 기능 전에 쌓인 응답(13건)과, 배포가 넘어가는 사이 옛 컨테이너가 만든 응답을 여기서 채운다.
// 여러 번 돌아도 같다(빈 것만 채운다). 실패해도 서버는 뜬다 — 다음 배포 때 다시 채운다.
const ResearchSurveyResult = require('../models/ResearchSurveyResult');

async function ensureResearchExpireAt() {
  try {
    const docs = await ResearchSurveyResult.find(
      { $or: [{ expireAt: null }, { expireAt: { $exists: false } }] },
      { submitted_at: 1, completed: 1 },
    ).lean();
    if (!docs.length) return;
    await ResearchSurveyResult.bulkWrite(docs.map((d) => ({
      updateOne: {
        filter: { _id: d._id, $or: [{ expireAt: null }, { expireAt: { $exists: false } }] },
        update: { $set: { expireAt: ResearchSurveyResult.expireAtOf(d.submitted_at, !!d.completed) } },
      },
    })));
    console.log(`[research-retention] 보유기간 채움 ${docs.length}건`);
  } catch (e) {
    console.warn(`[research-retention] 보유기간 채우기 실패: ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

module.exports = { ensureResearchExpireAt };
