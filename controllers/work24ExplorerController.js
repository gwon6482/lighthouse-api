// 어드민 고용24 API 탐색기 — 화면에서 고른 API 를 서버가 대신 불러 응답을 그대로 돌려준다.
//
// 🔒 인증키는 **여기서만** 붙인다. 화면(브라우저)은 키를 모른다.
// 🔒 허용 목록(config/work24Endpoints.js)에 있는 주소만 부른다 — apiId 로 고르고, 주소·키는 서버가 정한다.
//    화면이 보낸 authKey 는 버린다(키를 바꿔 끼워 다른 키로 부르는 것도 막는다).
// 명세: lighthouse-docs/work24-api/
const ENDPOINTS = require('../config/work24Endpoints');

const BASE = 'https://www.work24.go.kr';
const TIMEOUT_MS = 20000;
const MAX_BODY = 1_000_000;         // 응답이 아주 클 때(직업정보 전체 목록 등) 화면이 멈추지 않게 자른다
const MAX_PARAMS = 40;

// GET /api/admin/work24/endpoints — 키가 설정됐는지(값 아님)와 함께 허용 목록
const listWork24Endpoints = (req, res) => {
  const data = Object.entries(ENDPOINTS).map(([id, e]) => ({ id, name: e.name, path: e.path, keyName: e.key, keyReady: !!process.env[e.key] }));
  res.json({ success: true, data });
};

// POST /api/admin/work24/call  { apiId, params: { name: value } }
const callWork24 = async (req, res) => {
  const { apiId, params } = req.body || {};
  const ep = ENDPOINTS[apiId];
  if (!ep) return res.status(400).json({ success: false, error: '허용되지 않은 API 입니다.' });
  const key = process.env[ep.key];
  if (!key) return res.status(503).json({ success: false, error: `${ep.key} 가 서버에 설정되지 않았습니다.` });

  const entries = Object.entries(params && typeof params === 'object' ? params : {})
    .filter(([k, v]) => k !== 'authKey' && /^[A-Za-z0-9_]{1,40}$/.test(k) && v !== '' && v != null)
    .slice(0, MAX_PARAMS);
  const qs = new URLSearchParams([['authKey', key], ...entries.map(([k, v]) => [k, String(v).slice(0, 300)])]);

  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${ep.path}?${qs}`, { signal: ctl.signal });
    const text = await r.text();
    const truncated = text.length > MAX_BODY;
    // 고용24 는 오류도 HTTP 200 으로 주고 본문에 <error>·<message> 를 싣는다 — 화면이 바로 보이게 뽑아 둔다
    const apiError = (text.match(/<error>([^<]*)<\/error>/) || text.match(/<message>([^<]*)<\/message>/) || [])[1] || null;
    res.json({
      success: true,
      data: {
        httpStatus: r.status,
        ms: Date.now() - started,
        contentType: r.headers.get('content-type'),
        apiError,
        truncated,
        bytes: text.length,
        body: truncated ? text.slice(0, MAX_BODY) : text,
        // 키를 가린 호출 주소(재현·문서용)
        url: `${BASE}${ep.path}?${qs.toString().replace(/authKey=[^&]+/, `authKey=[${ep.key}]`)}`,
      },
    });
  } catch (e) {
    res.status(502).json({ success: false, error: e.name === 'AbortError' ? `고용24 응답 없음(${TIMEOUT_MS / 1000}초)` : '고용24 호출 실패', ms: Date.now() - started });
  } finally {
    clearTimeout(t);
  }
};

module.exports = { listWork24Endpoints, callWork24 };
