const express = require('express');
const router = express.Router();
const { register, checkEmail, login, logout, me } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, checkEmailLimiter } = require('../middleware/rateLimit');
const { kakaoStart, kakaoCallback, listProviders } = require('../controllers/oauthController');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: 인증 관련 API
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: 회원가입
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 example: "securepassword"
 *               onboarding:
 *                 type: object
 *                 description: >
 *                   진로 온보딩 답변(선택). 회원가입 3~5단계 Q1~Q3.
 *                   선택지 문구는 models/User.js 의 OnboardingSchema 주석 참조.
 *                 properties:
 *                   status:
 *                     type: integer
 *                     description: Q1 현재 상황 (1~4)
 *                     example: 2
 *                   concerns:
 *                     type: array
 *                     description: Q2 진로 고민, 복수 선택 (각 1~6)
 *                     items: { type: integer }
 *                     example: [1, 3]
 *                   selfAwareness:
 *                     type: integer
 *                     description: Q3 자기이해 정도 (1~3)
 *                     example: 2
 *     responses:
 *       201:
 *         description: 회원가입 성공, JWT 토큰 발급
 *       400:
 *         description: 입력값 오류
 *       409:
 *         description: 이미 존재하는 이메일
 */
router.post('/register', register);

/**
 * @swagger
 * /api/auth/check-email:
 *   get:
 *     summary: 이메일 사용 가능 여부 확인
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         example: user@example.com
 *     responses:
 *       200:
 *         description: "{ available: true } 사용 가능 / false 이미 사용 중"
 *       400:
 *         description: 이메일 미입력
 */
router.get('/check-email', checkEmailLimiter, checkEmail);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: 로그인
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 로그인 성공, JWT 토큰 반환
 *       401:
 *         description: 인증 실패
 */
router.post('/login', loginLimiter, login);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: 로그아웃
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 로그아웃 성공 (클라이언트에서 토큰 삭제 필요)
 */
router.post('/logout', authenticate, logout);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: 내 정보 조회
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 현재 로그인된 유저 정보
 *       401:
 *         description: 인증 토큰 없음 또는 만료
 */
router.get('/me', authenticate, me);

/**
 * @swagger
 * /api/auth/providers:
 *   get:
 *     summary: 사용 가능한 소셜 로그인 목록
 *     description: >
 *       FE 가 어떤 소셜 로그인 버튼을 활성화할지 판단한다.
 *       플래그를 FE/BE 양쪽에 두면 반드시 어긋나므로 API env 하나만을 진실로 삼는다.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: "예) { kakao: true, google: false, apple: false }"
 */
router.get('/providers', listProviders);

/**
 * @swagger
 * /api/auth/kakao:
 *   get:
 *     summary: 카카오 로그인 시작 (카카오 인가 페이지로 302)
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: redirect
 *         schema: { type: string }
 *         description: >
 *           로그인 후 돌아올 FE URL. OAUTH_ALLOWED_ORIGINS 안의 오리진만 허용된다
 *           (오픈 리다이렉트 방지). 벗어나면 기본값으로 대체된다.
 *     responses:
 *       302:
 *         description: 카카오 인가 페이지로 리다이렉트
 *       503:
 *         description: 카카오 앱 키 미설정
 */
router.get('/kakao', kakaoStart);

/**
 * @swagger
 * /api/auth/kakao/callback:
 *   get:
 *     summary: 카카오 인가 코드 콜백 (카카오가 호출)
 *     description: >
 *       코드를 토큰으로 교환하고 사용자 정보를 조회해 계정을 찾거나 만든 뒤,
 *       우리 JWT 를 발급해 FE 복귀 URL 로 302 한다.
 *       토큰은 쿼리가 아니라 **프래그먼트**(#token=)로 넘긴다 — 로그·Referer 에 남지 않도록.
 *       실패 시 ?error= 코드로 돌려보낸다 (invalid_state / cancelled / token_failed /
 *       profile_failed / email_taken).
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: FE 복귀 URL 로 리다이렉트
 *       503:
 *         description: 카카오 앱 키 미설정
 */
router.get('/kakao/callback', kakaoCallback);

module.exports = router;
