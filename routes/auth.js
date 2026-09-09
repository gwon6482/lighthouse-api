const express = require('express');
const router = express.Router();
const { register, checkEmail, login, logout, me } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, checkEmailLimiter } = require('../middleware/rateLimit');

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

module.exports = router;
