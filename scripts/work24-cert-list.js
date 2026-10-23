// 고용24 자격면허 코드 목록 → config/work24CertList.json  (node --env-file=.env scripts/work24-cert-list.js)
//
// 왜: 진로설계 예시의 '자격요건' 에 **지어낸 자격증**이 들어가지 않게 대조하는 기준. 국가기술·국가전문·민간등록 등 약 3천 개.
// ⚠️ 벤더 자격(GAIQ 등)은 목록에 없다 → 목록 밖 자격은 버리지 말고 '공고 근거가 충분할 때만' 쓰는 쪽으로(예시 생성 단계 규칙).
// 키: WORK24_KEY_COMMON_CODE (공통코드 21L01, dtlGb=3)
const fs = require('fs');
const path = require('path');

(async () => {
  const qs = new URLSearchParams({ returnType: 'XML', target: 'CMCD', authKey: process.env.WORK24_KEY_COMMON_CODE, dtlGb: '3' });
  const xml = await (await fetch(`https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo21L01.do?${qs}`)).text();
  const groups = {};
  const certs = [];
  for (const m of xml.matchAll(/<certCd>(\d+)<\/certCd><certNm>([^<]*)<\/certNm><superCd>(\d+)<\/superCd>/g)) {
    const [, code, name, superCd] = m;
    if (superCd === '500' || code.length <= 5) groups[code] = name; // 묶음(국가기술자격(ㄱ) 등)
    else certs.push({ code, name, group: superCd });
  }
  if (certs.length < 1000) throw new Error(`목록이 비정상(${certs.length})`);
  fs.writeFileSync(path.join(__dirname, '../config/work24CertList.json'), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), groups, certs }));
  console.log(`자격 ${certs.length} · 묶음 ${Object.keys(groups).length}`);
})();
