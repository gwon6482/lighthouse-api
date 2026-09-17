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

// state 는 서버가 서명한 **단명 JWT** 다. 세션 저장소가 없어도 위조를 막을 수 있고,
// 복귀 URL 을 함께 실어 콜백에서 되찾는다. 제공자가 늘어도 이 한 곳만 쓴다.
function signState(redirect) {
  return jwt.sign(
    { returnTo: sanitizeReturnUrl(redirect), n: Math.random().toString(36).slice(2) },
    JWT_SECRET,
    { expiresIn: STATE_TTL },
  );
}

// 우리 서비스 JWT. 이메일 로그인(authController.generateToken)과 **같은 형태**여야 한다 —
// 제공자별로 담는 값이 갈리면 그 토큰을 읽는 쪽이 전부 갈린다.
function issueAppToken(user) {
  return jwt.sign(
    { uid: user.uid, email: user.email },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
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

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      state: signState(req.query.redirect),
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
    // ⚠️ 토큰은 쿼리스트링이 아니라 **프래그먼트**로 넘긴다.
    // 프래그먼트는 브라우저가 서버로 보내지 않으므로 CloudFront/S3 액세스 로그나
    // Referer 헤더에 토큰이 남지 않는다.
    const url = new URL(returnTo);
    url.hash = `token=${encodeURIComponent(issueAppToken(user))}`;
    return res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
};

// 같은 이메일을 쓰는 로컬 계정이 이미 있을 때 쓰는 표식.
const EMAIL_TAKEN = Symbol('email-taken');

// 소셜 프로필 → 우리 유저. **모든 소셜 제공자가 이 함수 하나를 쓴다.**
//
// ⚠️ 제공자마다 따로 쓰면 계정 정책이 반드시 갈라진다. 여기 담긴 규칙은 세 가지다.
//    1) 신원은 **제공자가 준 불변 식별자**로만 판단한다(카카오 회원번호, 구글 sub).
//       이메일은 바뀔 수 있어 표시용 스냅샷일 뿐이다 — 카카오 문서도 명시적으로 경고한다.
//    2) 이메일이 같다고 기존 계정에 **자동 연결하지 않는다.** 계정 탈취 경로로 알려져 있다.
//       (로그인한 사용자가 스스로 연결하는 흐름은 후속 과제)
//    3) 기존 유저면 lastLoginAt 을 갱신한다. 안 하면 소셜 유저만 접속 집계에서 빠진다.
//
// 인자는 제공자별 응답을 **이미 정규화한 뒤** 넘긴다(아래 normalize* 함수들).
async function findOrCreateSocialUser({ provider, providerId, email, name }) {
  const existing = await User.findOne({
    authProviders: { $elemMatch: { provider, providerId } },
  });
  if (existing) {
    // ⚠️ save() 가 아니라 updateOne 인 이유: 문서 전체 검증을 다시 돌리지 않기 위해서다.
    // 옛 계정에 스키마와 어긋난 값이 하나라도 있으면 save() 는 **로그인 자체를 실패시킨다.**
    const now = new Date();
    await User.updateOne({ _id: existing._id }, { $set: { lastLoginAt: now } });
    existing.lastLoginAt = now;   // 호출부가 방금 쓴 값을 그대로 보게
    return existing;
  }

  if (email) {
    const clash = await User.findOne({ email });
    if (clash) return EMAIL_TAKEN;
  }

  return User.create({
    ...(email && { email }),
    // passwordHash 없음 — 소셜 전용 계정은 비밀번호 로그인을 할 수 없다
    authProviders: [{ provider, providerId }],
    ...(name && { name }),
    lastLoginAt: new Date(),   // 가입 = 첫 로그인. 기존 유저 경로와 맞춘다
    // ⚠️ 나이는 어느 제공자에서도 받지 않는다. 가입 위저드에서 **사용자가 직접 입력**한다.
    //    카카오 출생연도(birthyear)로 채우는 방법이 있었지만 동의항목 승인에 시간이 걸려 접었다
    //    (2026-09-11). 승인이 나면 카카오 정규화 쪽에서 age 를 채우면 된다 —
    //    단 생일은 별개 동의항목이라 만 나이가 아니라 연 나이가 된다.
  });
}

// 카카오 응답 → 공통 형태.
// ⚠️ 동의하지 않은 항목은 값이 null 이 아니라 **필드 자체가 응답에서 빠진다**
// (대신 email_needs_agreement: true 가 온다). 그래서 undefined 를 정상 경로로 다뤄야 한다.
// 이메일 동의를 '필수'로 받으려면 비즈니스 앱 전환 + 검수가 필요하므로,
// 당분간 **이메일 없는 카카오 계정이 정상적으로 존재한다**고 보고 설계한다.
function normalizeKakaoProfile(profile) {
  const account = profile.kakao_account || {};
  return {
    provider: 'kakao',
    providerId: String(profile.id),
    email: account.is_email_valid && account.is_email_verified && account.email
      ? String(account.email).toLowerCase().trim()
      : undefined,
    name: account.profile?.nickname,
  };
}

// 구글 userinfo(OIDC) → 공통 형태.
// ⚠️ 신원은 **sub** 다. 구글도 문서에서 sub 를 쓰라고 명시한다 — 이메일은 재사용·변경될 수 있다.
// ⚠️ email_verified 가 false 인 이메일은 저장하지 않는다. 미인증 이메일을 그대로 받으면
//    "그 이메일의 주인"이 아닌 계정이 우리 쪽 이메일 칸을 차지할 수 있다.
function normalizeGoogleProfile(profile) {
  return {
    provider: 'google',
    providerId: String(profile.sub),
    email: profile.email_verified && profile.email
      ? String(profile.email).toLowerCase().trim()
      : undefined,
    name: profile.name,
  };
}

// 하위 호환 — 기존 호출부/테스트가 쓰던 이름.
async function findOrCreateKakaoUser(profile) {
  return findOrCreateSocialUser(normalizeKakaoProfile(profile));
}

// ── 구글 로그인 (OAuth 2.0 + OpenID Connect) ─────────────────────────────
//
// 카카오와 흐름이 같다. 다른 점만 적는다.
//   - 인가 요청에 **scope 가 필수**다(카카오는 콘솔 동의항목으로 정해져 생략 가능했다)
//   - 신원 식별자는 **sub**(카카오의 회원번호에 해당)
//   - 이메일은 `email_verified` 가 true 일 때만 쓴다
//
// ⚠️ 우리는 id_token 을 쓰지 않는다. 액세스 토큰으로 userinfo 를 부르는 방식이
//    카카오와 동일해서 코드가 한 모양으로 유지된다.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

// 구글 클라이언트가 설정돼 있을 때만 켜진다(카카오와 같은 fail-closed).
function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

const isGoogleEnabled = () => googleConfig() !== null;

// GET /api/auth/google
const googleStart = async (req, res, next) => {
  try {
    const cfg = googleConfig();
    if (!cfg) {
      return res.status(503).json({
        success: false,
        error: '구글 로그인이 아직 설정되지 않았습니다',
      });
    }

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      // openid 만으로는 이메일·이름이 오지 않는다. 우리가 필요한 최소 집합이다.
      scope: 'openid email profile',
      state: signState(req.query.redirect),
      // ⚠️ 계정 선택 화면을 강제한다. 없으면 브라우저에 구글 세션이 하나 있을 때
      //    묻지도 않고 그 계정으로 들어가서, 다른 계정으로 바꿀 방법이 없다.
      prompt: 'select_account',
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/google/callback
const googleCallback = async (req, res, next) => {
  const cfg = googleConfig();
  if (!cfg) {
    return res.status(503).json({ success: false, error: '구글 로그인이 아직 설정되지 않았습니다' });
  }

  let returnTo = sanitizeReturnUrl(null);
  try {
    const decoded = jwt.verify(req.query.state || '', JWT_SECRET);
    returnTo = sanitizeReturnUrl(decoded.returnTo);
  } catch {
    return redirectWithError(res, returnTo, 'invalid_state');
  }

  if (req.query.error || !req.query.code) {
    return redirectWithError(res, returnTo, 'cancelled');
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code: req.query.code,
      }),
    });
    if (!tokenRes.ok) {
      // ⚠️ 구글의 redirect_uri_mismatch 는 **콘솔 등록값과 한 글자라도 다르면** 난다
      //    (끝의 / 하나까지). 카카오 KOE006 과 같은 성격이다. 본문을 남겨야 원인을 안다.
      console.error('[google] 토큰 교환 실패', tokenRes.status, await tokenRes.text());
      return redirectWithError(res, returnTo, 'token_failed');
    }
    const { access_token: accessToken } = await tokenRes.json();

    const meRes = await fetch(GOOGLE_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      console.error('[google] 사용자 조회 실패', meRes.status, await meRes.text());
      return redirectWithError(res, returnTo, 'profile_failed');
    }
    const profile = await meRes.json();

    const user = await findOrCreateSocialUser(normalizeGoogleProfile(profile));
    if (user === EMAIL_TAKEN) {
      return redirectWithError(res, returnTo, 'email_taken');
    }

    const url = new URL(returnTo);
    url.hash = `token=${encodeURIComponent(issueAppToken(user))}`;
    return res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/providers
// FE 가 어떤 소셜 로그인을 켜도 되는지 묻는다. 플래그를 FE/BE 양쪽에 두면
// 반드시 어긋나므로, **API env 하나만을 진실로 삼는다.**
const listProviders = (_req, res) => {
  res.json({
    success: true,
    data: {
      kakao: isKakaoEnabled(),
      google: isGoogleEnabled(),
      apple: false,    // 미구현
    },
  });
};

module.exports = {
  kakaoStart,
  kakaoCallback,
  googleStart,
  googleCallback,
  listProviders,
  // 테스트용
  sanitizeReturnUrl,
  findOrCreateKakaoUser,
  findOrCreateSocialUser,
  normalizeKakaoProfile,
  normalizeGoogleProfile,
  isKakaoEnabled,
  isGoogleEnabled,
  EMAIL_TAKEN,
};
