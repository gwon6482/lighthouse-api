// NCS 분류 트리(대·중·소·세분류 이름) → config/ncsTree.json
//   node --env-file=.env scripts/ncs-tree.js
//
// 왜: 진로설계 예시 DB 에서 직업 ↔ NCS 세분류를 연결할 때 **공식 코드 목록 안에서만** 고르게 하려고(지어낸 분류 방지).
//   NCS 세분류 코드는 훈련과정 API(ncsCd)에 붙어 있어, 연결되면 실제 개설 강의를 예시 근거로 쓸 수 있다.
// ⚠️ 직무정보 API(215L01, AI 추천)는 직업↔NCS 연결용으로 잡음이 커서 쓰지 않는다
//   (사회복지사 → 감정평가·조달, 회계사무원 → 작물재배가 섞임. 2026-10-19 시험).
// 키: WORK24_KEY_COMMON_CODE (공통코드 '훈련' 319L01, srchType 05~08)
const fs = require('fs');
const path = require('path');

(async () => {
  const names = {};
  for (const t of ['05', '06', '07', '08']) {
    const qs = new URLSearchParams({ authKey: process.env.WORK24_KEY_COMMON_CODE, returnType: 'XML', outType: '1', srchType: t });
    const xml = await (await fetch(`https://www.work24.go.kr/cm/openApi/call/hr/callOpenApiSvcInfo319L01.do?${qs}`)).text();
    for (const m of xml.matchAll(/<rsltCode>(\d+)<\/rsltCode><rsltName>([^<]*)<\/rsltName>/g)) names[m[1]] = m[2];
  }
  const count = (len) => Object.keys(names).filter((c) => c.length === len).length;
  const out = { generatedAt: new Date().toISOString().slice(0, 10), names };
  if (count(2) < 20 || count(8) < 1000) throw new Error(`트리가 비정상(대 ${count(2)} · 세 ${count(8)})`);
  fs.writeFileSync(path.join(__dirname, '../config/ncsTree.json'), JSON.stringify(out));
  console.log(`대 ${count(2)} · 중 ${count(4)} · 소 ${count(6)} · 세 ${count(8)}`);
})();
