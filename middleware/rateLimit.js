const { rateLimit } = require('express-rate-limit');

// 클라이언트 IP는 Lightsail 프록시가 넘기는 X-Forwarded-For 기반(req.ip).
// server.js에서 app.set('trust proxy', 1)로 신뢰 홉을 1개(Lightsail LB)로 한정 →
// 클라이언트가 위조한 XFF 값은 무시되고 실제 IP로 카운트된다.

// 로그인 브루트포스 방어: 실패한 로그인만 카운트(skipSuccessfulRequests)한다.
// 정상 로그인(200)은 세지 않으므로 공유 IP(모바일 CGNAT)의 정상 사용자 오탐이 최소화된다.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10분
  limit: 10,                // 실패 10회/10분/IP
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

// 이메일 존재 확인(가입 위저드) 대량 열거 방어.
// 성공/실패 모두 200이라 전부 카운트되므로 공유 IP를 고려해 다소 넉넉하게 잡는다.
const checkEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10분
  limit: 30,                // 30회/10분/IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

module.exports = { loginLimiter, checkEmailLimiter };
