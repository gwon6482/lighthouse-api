const express = require('express');
const router = express.Router();
const {
  getAllQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getQuestionStats,
  getAllStats,
  getAdminT1Types,
  updateAdminT1Type
} = require('../controllers/adminController');
const { getAdminReviews, createAdminReview, updateAdminReview, deleteAdminReview } = require('../controllers/reviewController');

/**
 * @swagger
 * /api/admin/questions/stats:
 *   get:
 *     summary: 전체 통계 정보 조회
 *     description: 모든 컬렉션의 질문 통계 정보를 조회합니다.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: 통계 정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_questions:
 *                       type: number
 *                     active_questions:
 *                       type: number
 *                     collections:
 *                       type: object
 */
router.get('/questions/stats', getAllStats);

/**
 * @swagger
 * /api/admin/questions/{collection_type}:
 *   get:
 *     summary: 컬렉션별 질문 목록 조회
 *     description: 특정 컬렉션의 질문 목록을 페이지네이션과 필터링을 지원하여 조회합니다.
 *     tags: [Admin]
 *     parameters:
 *       - $ref: '#/components/parameters/collectionType'
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 페이지 번호
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: 페이지당 항목 수
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: 검색어
 *     responses:
 *       200:
 *         description: 질문 목록 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Question'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                     total_items:
 *                       type: integer
 */
router.get('/questions/:collection_type', getAllQuestions);

/**
 * @swagger
 * /api/admin/questions/{collection_type}/stats:
 *   get:
 *     summary: 컬렉션별 통계 정보 조회
 *     description: 특정 컬렉션의 질문 통계 정보를 조회합니다.
 *     tags: [Admin]
 *     parameters:
 *       - $ref: '#/components/parameters/collectionType'
 *     responses:
 *       200:
 *         description: 컬렉션 통계 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     collection_type:
 *                       type: string
 *                     total_questions:
 *                       type: number
 *                     active_questions:
 *                       type: number
 *                     inactive_questions:
 *                       type: number
 */
router.get('/questions/:collection_type/stats', getQuestionStats);

/**
 * @swagger
 * /api/admin/questions/{collection_type}/{question_id}:
 *   get:
 *     summary: 개별 질문 조회
 *     description: 특정 컬렉션의 질문 ID로 개별 질문을 조회합니다.
 *     tags: [Admin]
 *     parameters:
 *       - $ref: '#/components/parameters/collectionType'
 *       - $ref: '#/components/parameters/questionId'
 *     responses:
 *       200:
 *         description: 질문 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Question'
 *       404:
 *         description: 질문을 찾을 수 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/questions/:collection_type/:question_id', getQuestionById);

/**
 * @swagger
 * /api/admin/questions/{collection_type}:
 *   post:
 *     summary: 새 질문 생성
 *     description: 특정 컬렉션에 새로운 질문을 생성합니다.
 *     tags: [Admin]
 *     parameters:
 *       - $ref: '#/components/parameters/collectionType'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question_text
 *               - question_type
 *             properties:
 *               question_text:
 *                 type: string
 *                 description: 질문 내용
 *               question_type:
 *                 type: string
 *                 description: 질문 타입
 *               options:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: 선택지 옵션들
 *               category:
 *                 type: string
 *                 description: 질문 카테고리
 *               is_active:
 *                 type: boolean
 *                 default: true
 *                 description: 활성화 상태
 *     responses:
 *       201:
 *         description: 질문 생성 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Question'
 *       400:
 *         description: 잘못된 요청
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/questions/:collection_type', createQuestion);

/**
 * @swagger
 * /api/admin/questions/{collection_type}/{question_id}:
 *   put:
 *     summary: 질문 수정
 *     description: 특정 컬렉션의 질문을 수정합니다.
 *     tags: [Admin]
 *     parameters:
 *       - $ref: '#/components/parameters/collectionType'
 *       - $ref: '#/components/parameters/questionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question_text:
 *                 type: string
 *               question_type:
 *                 type: string
 *               options:
 *                 type: array
 *                 items:
 *                   type: string
 *               category:
 *                 type: string
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 질문 수정 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Question'
 *       404:
 *         description: 질문을 찾을 수 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/questions/:collection_type/:question_id', updateQuestion);

/**
 * @swagger
 * /api/admin/questions/{collection_type}/{question_id}:
 *   delete:
 *     summary: 질문 삭제
 *     description: 특정 컬렉션의 질문을 삭제합니다. permanent=true로 영구 삭제할 수 있습니다.
 *     tags: [Admin]
 *     parameters:
 *       - $ref: '#/components/parameters/collectionType'
 *       - $ref: '#/components/parameters/questionId'
 *       - in: query
 *         name: permanent
 *         schema:
 *           type: boolean
 *           default: false
 *         description: 영구 삭제 여부
 *     responses:
 *       200:
 *         description: 질문 삭제 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: 질문을 찾을 수 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/questions/:collection_type/:question_id', deleteQuestion);

/**
 * @swagger
 * /api/admin/t1-types:
 *   get:
 *     summary: T1 성격 유형 목록 조회
 *     description: reference_data.t1_types의 135개 유형을 조회합니다. base_type, modifier_type 필터링 가능.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: base_type
 *         schema:
 *           type: string
 *           enum: [E, C, S, A, I, R, G, U, T]
 *       - in: query
 *         name: modifier_type
 *         schema:
 *           type: string
 *           enum: [TOP2, BOTTOM1]
 *     responses:
 *       200:
 *         description: 조회 성공
 */
router.get('/t1-types', getAdminT1Types);

/**
 * @swagger
 * /api/admin/t1-types/{type_code}:
 *   put:
 *     summary: T1 성격 유형 수정
 *     description: type_code로 특정 T1 유형의 modifier, full_name, description을 수정합니다. type_code, base_type, modifier_type, modifier_element는 변경 불가.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: type_code
 *         required: true
 *         schema:
 *           type: string
 *         description: "T1 유형 코드 (예: T1EUC)"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               modifier:
 *                 type: string
 *               full_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: 수정 성공
 *       404:
 *         description: 해당 type_code 없음
 */
router.put('/t1-types/:type_code', updateAdminT1Type);

router.get('/reviews', getAdminReviews);
router.post('/reviews', createAdminReview);
router.put('/reviews/:id', updateAdminReview);
router.delete('/reviews/:id', deleteAdminReview);

module.exports = router;