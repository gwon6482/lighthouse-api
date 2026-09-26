// 고용24 Open API 호출 클라이언트.
//
// 명세 정리본: 공유 docs `reference/work24-open-api.md`
//
// ⚠️ **호출 한도가 공개돼 있지 않다.** 이용조건에 "활용제한 사유가 발생한 경우 한국고용정보원에서
//    활용을 제한할 수 있다"는 재량 조항만 있다. 2026-09-26 실측으로는 초당 2.5회 / 30회 연속
//    무실패였지만, 문서화된 보장이 아니므로 **스스로 속도를 억제한다.**
//
// ⚠️ 명세 페이지는 `m.work24.go.kr` 이지만 **호출 호스트는 `www.work24.go.kr`** 다.
// ⚠️ 3종 API 모두 **XML 고정**이다. JSON 선택지가 없다.
const { XMLParser } = require('fast-xml-parser');

const BASE = 'https://www.work24.go.kr/cm/openApi/call/wk';

// 호출 간 최소 간격(ms). 초당 ~2.5회. 한도를 모르므로 보수적으로 잡는다.
const MIN_INTERVAL_MS = Number(process.env.WORK24_MIN_INTERVAL_MS || 400);
const MAX_RETRY = 3;

let lastCallAt = 0;

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,   // 숫자처럼 보이는 코드가 Number 로 바뀌면 앞자리 0 이 날아간다
  trimValues: true,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 호출 간격을 강제한다. 병렬 호출을 하더라도 이 게이트를 통과해야 한다.
async function throttle() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

// 응답이 XML 이 아니거나 에러 본문일 때를 구분한다.
// ⚠️ 인증 실패도 200 + 에러 본문으로 올 수 있어 **상태코드만 믿으면 안 된다.**
function assertLooksLikeData(xml, expectRoot) {
  if (!xml || typeof xml !== 'string') throw new Error('빈 응답');
  if (!xml.includes('<')) throw new Error(`XML 이 아님: ${xml.slice(0, 120)}`);
  if (expectRoot && !xml.includes(`<${expectRoot}`)) {
    throw new Error(`기대한 루트 <${expectRoot}> 가 없음: ${xml.slice(0, 200)}`);
  }
}

/**
 * 고용24 API 한 건 호출.
 * @param {string} endpoint  예: 'callOpenApiSvcInfo212L01.do'
 * @param {object} params    authKey 를 뺀 쿼리 파라미터
 * @param {string} expectRoot 기대하는 XML 루트 태그(검증용)
 */
async function call(endpoint, params, expectRoot) {
  const authKey = process.env.WORK24_KEY;
  if (!authKey) throw new Error('WORK24_KEY 가 설정되지 않았습니다');

  const qs = new URLSearchParams({ authKey, returnType: 'XML', ...params });
  const url = `${BASE}/${endpoint}?${qs}`;

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      assertLooksLikeData(text, expectRoot);
      return parser.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRY) {
        // 지수 백오프. 상대가 조이고 있을 수 있으니 넉넉히 쉰다.
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
  // ⚠️ URL 을 그대로 실으면 authKey 가 로그에 남는다. 엔드포인트와 파라미터만 남긴다.
  const safe = JSON.stringify(params);
  throw new Error(`work24 호출 실패 (${endpoint} ${safe}): ${lastErr.message}`);
}

// XML 파싱 결과에서 반복 요소를 항상 배열로 받는다.
// ⚠️ fast-xml-parser 는 항목이 **1개면 객체, 여러 개면 배열**로 준다.
//    이걸 놓치면 "직업이 1건인 분류"에서 조용히 깨진다.
function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

module.exports = { call, asArray, MIN_INTERVAL_MS };
