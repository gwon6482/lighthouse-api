const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');

// ── 카카오 로그인 (REST API, Authorization Code Grant) ───────────────────
//
// 흐름 (전부 웹 기준 — 네이티브 앱은 현재 패키징하지 않는다):
//   1. FE 가 GET /api/auth/kakao?redirect=<FE 복귀 URL> 로 브라우저를 보낸다
//   2. 여기서 state 를 서명해 붙이고 카카오 인가 페이지로 302
//   3. 카카오가 GET /api/auth/kakao/callback?code=&state= 로 돌려보낸다
//   4. 서버가 code 를 토큰으로 교환(client_secret 필요) → 사용자 정보 조회
//   5. 계정을 찾거나 만들고 우리 JWT 를 발급 → FE 복귀 URL 로 302 (#token=...)
//
// ⚠️ client_secret 은 카카오에서 **기본 활성화**라 토큰 요청에 반드시 포함해야 한다.
//    그래서 코드 교환은 브라우저가 아니라 **서버에서만** 한다.

const KAKAO_AUTH_URL = 'https://kauth.kakao.com/oauth/authorize';
const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_USER_URL = 'https://kapi.kakao.com/v2/user/me';

const STATE_TTL = '10m';   // 인가 페이지에 머무는 시간. 넉넉하되 짧게.

// 카카오 앱 키가 설정돼 있을 때만 기능이 켜진다.
// 키가 없으면 라우트는 살아 있되 503 을 돌려주고, FE 는 그걸 보고 '준비 중'을 띄운다.
function kakaoConfig() {
  const clientId = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;
  const redirectUri = process.env.KAKAO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

const isKakaoEnabled = () => kakaoConfig() !== null;

// ⚠️ 오픈 리다이렉트 방지 — FE 복귀 URL 은 반드시 허용 목록 안이어야 한다.
// 이 검사가 없으면 ?redirect=https://evil.example 로 **우리가 발급한 JWT 를 넘겨주게 된다.**
function allowedReturnOrigins() {
  const fromEnv = (process.env.OAUTH_ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  // env 미설정 시 기본값 — 운영 도메인만.
  return ['https://app.lighthouse.career', 'https://test.lighthouse.career'];
}

function sanitizeReturnUrl(raw) {
  const fallback = `${allowedReturnOrigins()[0]}/onboarding/oauth`;
  if (!raw) return fallback;
  let url;
  try { url = new URL(raw); } catch { return fallback; }
  return allowedReturnOrigins().includes(url.origin) ? url.toString() : fallback;
}

// GET /api/auth/kakao
// 카카오 인가 페이지로 넘긴다.
const kakaoStart = async (req, res, next) => {
  try {
    const cfg = kakaoConfig();
    if (!cfg) {
      return res.status(503).json({
        success: false,
        error: '카카오 로그인이 아직 설정되지 않았습니다',
      });
    }

    // state 는 서버가 서명한 단명 JWT 다. 세션 저장소가 없어도 위조를 막을 수 있고,
    // 복귀 URL 을 함께 실어 콜백에서 되찾는다.
    const state = jwt.sign(
      { returnTo: sanitizeReturnUrl(req.query.redirect), n: Math.random().toString(36).slice(2) },
      JWT_SECRET,
      { expiresIn: STATE_TTL },
    );

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      state,
    });
    res.redirect(`${KAKAO_AUTH_URL}?${params}`);
  } catch (err) {
    next(err);
  }
};

// 실패해도 사용자는 FE 화면으로 돌아가야 한다. 에러는 쿼리로 전달한다.
function redirectWithError(res, returnTo, code) {
  const url = new URL(returnTo);
  url.searchParams.set('error', code);
  return res.redirect(url.toString());
}

// GET /api/auth/kakao/callback
const kakaoCallback = async (req, res, next) => {
  const cfg = kakaoConfig();
  if (!cfg) {
    return res.status(503).json({ success: false, error: '카카오 로그인이 아직 설정되지 않았습니다' });
  }

  // state 를 먼저 푼다 — 복귀 URL 을 알아야 에러도 화면으로 돌려보낼 수 있다.
  let returnTo = sanitizeReturnUrl(null);
  try {
    const decoded = jwt.verify(req.query.state || '', JWT_SECRET);
    returnTo = sanitizeReturnUrl(decoded.returnTo);
  } catch {
    return redirectWithError(res, returnTo, 'invalid_state');
  }

  // 사용자가 동의 화면에서 취소한 경우
  if (req.query.error || !req.query.code) {
    return redirectWithError(res, returnTo, 'cancelled');
  }

  try {
    // 1) 인가 코드 → 토큰
    const tokenRes = await fetch(KAKAO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code: req.query.code,
      }),
    });
    if (!tokenRes.ok) {
      // 카카오는 실패 사유를 error_code(KOE00x)로 준다. 그대로 남겨야 원인을 안다.
      //   KOE004 = 카카오 로그인이 앱에서 비활성화됨
      //   KOE006 = 등록되지 않은 Redirect URI (콘솔 등록값과 정확히 일치해야 한다)
      console.error('[kakao] 토큰 교환 실패', tokenRes.status, await tokenRes.text());
      return redirectWithError(res, returnTo, 'token_failed');
    }
    const { access_token: accessToken } = await tokenRes.json();

    // 2) 토큰 → 사용자 정보
    const meRes = await fetch(KAKAO_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      console.error('[kakao] 사용자 조회 실패', meRes.status, await meRes.text());
      return redirectWithError(res, returnTo, 'profile_failed');
    }
    const profile = await meRes.json();

    const user = await findOrCreateKakaoUser(profile);
    if (user === EMAIL_TAKEN) {
      return redirectWithError(res, returnTo, 'email_taken');
    }

    // 3) 우리 JWT 발급
    const token = jwt.sign(
      { uid: user.uid, email: user.email },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    );

    // ⚠️ 토큰은 쿼리스트링이 아니라 **프래그먼트**로 넘긴다.
    // 프래그먼트는 브라우저가 서버로 보내지 않으므로 CloudFront/S3 액세스 로그나
    // Referer 헤더에 토큰이 남지 않는다.
    const url = new URL(returnTo);
    url.hash = `token=${encodeURIComponent(token)}`;
    return res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
};

// 같은 이메일을 쓰는 로컬 계정이 이미 있을 때 쓰는 표식.
const EMAIL_TAKEN = Symbol('email-taken');

// 카카오 프로필 → 우리 유저.
// ⚠️ 이메일이 같다고 기존 계정에 **자동 연결하지 않는다.** 이메일 기반 자동 연결은
//    계정 탈취 경로로 알려져 있다. 지금은 명시적 에러를 내고, 로그인한 사용자가
//    스스로 카카오를 연결하는 흐름(계정 연동)은 후속 과제로 남긴다.
async function findOrCreateKakaoUser(profile) {
  // ⚠️ 식별자는 **회원번호(id)** 다. 카카오 문서가 명시적으로 경고한다 —
  // "이메일 또는 전화번호와 같은 변경 가능한 정보를 사용하지 않아야 합니다".
  // 사용자가 카카오에서 이메일을 바꾸면 우리 DB 와 어긋난다. 아래에서 email 도 저장하지만
  // 그건 표시용 스냅샷일 뿐 **신원 판단에는 쓰지 않는다.**
  const providerId = String(profile.id);

  const existing = await User.findOne({
    authProviders: { $elemMatch: { provider: 'kakao', providerId } },
  });
  if (existing) return existing;

  const account = profile.kakao_account || {};
  // ⚠️ 동의하지 않은 항목은 값이 null 이 아니라 **필드 자체가 응답에서 빠진다**
  // (대신 email_needs_agreement: true 가 온다). 그래서 undefined 를 정상 경로로 다뤄야 한다.
  // 이메일 동의를 '필수'로 받으려면 비즈니스 앱 전환 + 검수가 필요하므로,
  // 당분간 **이메일 없는 카카오 계정이 정상적으로 존재한다**고 보고 설계한다.
  const email = account.is_email_valid && account.is_email_verified && account.email
    ? String(account.email).toLowerCase().trim()
    : undefined;

  if (email) {
    const clash = await User.findOne({ email });
    if (clash) return EMAIL_TAKEN;
  }

  const nickname = account.profile?.nickname;

  return User.create({
    ...(email && { email }),
    // passwordHash 없음 — 카카오 전용 계정은 비밀번호 로그인을 할 수 없다
    authProviders: [{ provider: 'kakao', providerId }],
    ...(nickname && { name: nickname }),
  });
}

// GET /api/auth/providers
// FE 가 어떤 소셜 로그인을 켜도 되는지 묻는다. 플래그를 FE/BE 양쪽에 두면
// 반드시 어긋나므로, **API env 하나만을 진실로 삼는다.**
const listProviders = (_req, res) => {
  res.json({
    success: true,
    data: {
      kakao: isKakaoEnabled(),
      google: false,   // 미구현
      apple: false,    // 미구현
    },
  });
};

module.exports = {
  kakaoStart,
  kakaoCallback,
  listProviders,
  // 테스트용
  sanitizeReturnUrl,
  findOrCreateKakaoUser,
  isKakaoEnabled,
  EMAIL_TAKEN,
};
