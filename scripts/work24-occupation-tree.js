// 고용24 채용 직종코드 트리 → config/work24OccupationTree.json
//   node --env-file=.env scripts/work24-occupation-tree.js
//
// 왜 필요한가: 채용정보(210L01)는 6자리 세분류(occupation=133200)로 찾지만,
// 공채속보(210L21)는 **중분류(3자리, 024 소프트웨어)·대분류(2자리)** 로만 걸린다(6자리는 0건, 2026-10-16 실측).
// 세분류 → 중분류는 코드 앞자리로 알 수 없다(012100 의 상위는 011) — 공통코드 트리의 superCd 가 정본이다.
// 직종코드 개편 때 다시 돌린다(키: WORK24_KEY_COMMON_CODE).
const fs = require('fs');
const path = require('path');

(async () => {
  const qs = new URLSearchParams({ returnType: 'XML', target: 'CMCD', authKey: process.env.WORK24_KEY_COMMON_CODE, dtlGb: '2' });
  const xml = await (await fetch(`https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo21L01.do?${qs}`)).text();
  const names = {};
  const parent = {};
  for (const m of xml.matchAll(/<jobsCd>(\d+)<\/jobsCd><jobsNm>([^<]*)<\/jobsNm>(?:<superCd>(\d+)<\/superCd>)?/g)) {
    names[m[1]] = m[2];
    if (m[3]) parent[m[1]] = m[3];
  }
  const top = Object.keys(names).filter((c) => c.length === 2).length;
  const mid = Object.keys(names).filter((c) => c.length === 3).length;
  if (top < 10 || mid < 50) throw new Error(`트리가 비정상(대 ${top} · 중 ${mid}) — 키·응답을 확인할 것`);
  const out = { generatedAt: new Date().toISOString().slice(0, 10), names, parent };
  fs.writeFileSync(path.join(__dirname, '../config/work24OccupationTree.json'), JSON.stringify(out));
  console.log(`대 ${top} · 중 ${mid} · 전체 ${Object.keys(names).length}`);
})();
