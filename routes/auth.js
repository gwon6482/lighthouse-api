const express = require('express');
const router = express.Router();
const { register, checkEmail, login, logout, me } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

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
router.get('/check-email', checkEmail);

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
router.post('/login', login);

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
