const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, deleteAccount, addSurveyResult, getSurveyResults, getBookmarks, addBookmark, removeBookmark, saveRecommendedJobs, getTargetCareer, setTargetCareer, registerDevice, removeDevice } = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');

// 모든 /api/user 라우트는 인증 필요
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: User
 *   description: 유저 프로필 관련 API
 */

/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: 내 프로필 조회
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 유저 프로필 반환
 *       401:
 *         description: 인증 실패
 */
router.get('/profile', getProfile);

/**
 * @swagger
 * /api/user/profile:
 *   put:
 *     summary: 프로필 수정
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 type: object
 *                 properties:
 *                   notifications:
 *                     type: object
 *                     properties:
 *                       push:
 *                         type: boolean
 *                       email:
 *                         type: boolean
 *                   language:
 *                     type: string
 *                     enum: [ko, en]
 *                   theme:
 *                     type: string
 *                     enum: [light, dark, auto]
 *     responses:
 *       200:
 *         description: 수정된 유저 프로필 반환
 *       401:
 *         description: 인증 실패
 */
router.put('/profile', updateProfile);

/**
 * @swagger
 * /api/user:
 *   delete:
 *     summary: 계정 탈퇴 (소프트 삭제)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 계정 비활성화 완료
 *       401:
 *         description: 인증 실패
 */
router.delete('/', deleteAccount);

/**
 * @swagger
 * /api/user/survey-results:
 *   post:
 *     summary: 설문 결과 연결
 *     description: 설문 완료 후 survey_id를 유저 계정에 연결합니다.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [survey_id]
 *             properties:
 *               survey_id:
 *                 type: string
 *                 example: "SURV20260519D_120000T"
 *     responses:
 *       201:
 *         description: 연결 성공, 전체 surveyResults 배열 반환
 *       404:
 *         description: 존재하지 않는 survey_id
 *       409:
 *         description: 이미 연결된 survey_id
 */
router.post('/survey-results', addSurveyResult);

/**
 * @swagger
 * /api/user/survey-results:
 *   get:
 *     summary: 내 설문 결과 목록 조회
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 설문 결과 메타 정보 목록 (survey_id, submitted_at, T1_result)
 */
router.get('/survey-results', getSurveyResults);

/**
 * @swagger
 * /api/user/bookmarks:
 *   get:
 *     summary: 북마크 직업 목록 조회
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 북마크된 직업 상세 정보 목록
 */
router.get('/bookmarks', getBookmarks);

/**
 * @swagger
 * /api/user/bookmarks/{jobCode}:
 *   post:
 *     summary: 직업 북마크 추가
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobCode
 *         required: true
 *         schema:
 *           type: string
 *         example: "013601"
 *     responses:
 *       201:
 *         description: 북마크 추가 성공
 *       404:
 *         description: 존재하지 않는 jobCode
 *       409:
 *         description: 이미 북마크된 직업
 */
router.post('/bookmarks/:jobCode', addBookmark);

/**
 * @swagger
 * /api/user/bookmarks/{jobCode}:
 *   delete:
 *     summary: 직업 북마크 삭제
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 북마크 삭제 성공
 *       404:
 *         description: 북마크되지 않은 직업
 */
router.delete('/bookmarks/:jobCode', removeBookmark);
router.post('/recommended-jobs', saveRecommendedJobs);

/**
 * @swagger
 * /api/user/target-career:
 *   get:
 *     summary: 목표 진로 조회
 *     description: refType이 jobCode이면 job_info에서 직업 정보도 함께 반환합니다.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 목표 진로 정보 반환 (미설정 시 targetCareer=null)
 */
router.get('/target-career', getTargetCareer);

/**
 * @swagger
 * /api/user/target-career:
 *   put:
 *     summary: 목표 진로 설정/변경/삭제
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [refType, ref]
 *                 properties:
 *                   refType:
 *                     type: string
 *                     enum: [jobCode, custom]
 *                   ref:
 *                     type: string
 *                     example: "013601"
 *               - type: "null"
 *     responses:
 *       200:
 *         description: 목표 진로 설정 완료
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 존재하지 않는 jobCode
 */
router.put('/target-career', setTargetCareer);

/**
 * @swagger
 * /api/user/devices:
 *   post:
 *     summary: FCM 기기 토큰 등록/갱신
 *     description: deviceId 기준으로 이미 존재하면 토큰 갱신, 없으면 새로 등록.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceToken, platform, deviceId]
 *             properties:
 *               deviceToken:
 *                 type: string
 *                 example: "fXB9r4k..."
 *               platform:
 *                 type: string
 *                 enum: [ios, android, web]
 *               deviceId:
 *                 type: string
 *                 example: "UUID-device-001"
 *     responses:
 *       201:
 *         description: 기기 등록/갱신 성공
 */
router.post('/devices', registerDevice);

/**
 * @swagger
 * /api/user/devices/{deviceId}:
 *   delete:
 *     summary: FCM 기기 토큰 제거
 *     description: 로그아웃 시 해당 기기 토큰을 제거합니다.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 기기 제거 성공
 *       404:
 *         description: 등록되지 않은 기기
 */
router.delete('/devices/:deviceId', removeDevice);

module.exports = router;
