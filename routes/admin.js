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
const { getOnboardingStats } = require('../controllers/onboardingStatsController');
const { listUsers, getUserDetail, deleteUser, resetUser } = require('../controllers/adminUserController');

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

/**
 * @swagger
 * /api/admin/onboarding/stats:
 *   get:
 *     summary: 회원가입 진로답변(Q1~Q3) 분포
 *     description: |
 *       회원가입 3~5단계 답변 분포. 비율의 분모는 `answered` 다 —
 *       `onboarding` 필드는 2026-09-09 에 생겨서 그 전 가입자에겐 필드 자체가 없다.
 *       Q2 는 복수 선택이라 byConcern 의 합계가 answered 를 넘을 수 있다.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: 조회 성공
 */
router.get('/onboarding/stats', getOnboardingStats);

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: 회원 목록 조회 (관리자)
 *     description: |
 *       가입된 회원을 최신순으로 조회합니다. 각 회원의 딸린 데이터 건수를 함께 돌려줍니다.
 *       ⚠️ 건수 집계는 컬렉션당 1회씩(총 4회)만 돕니다 — 유저마다 세면 N+1 입니다.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: 이메일·이름 부분일치(대소문자 무시)
 *       - in: query
 *         name: provider
 *         schema: { type: string, enum: [local, kakao, google] }
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: ['true', 'false'] }
 *     responses:
 *       200:
 *         description: 조회 성공
 *       401:
 *         description: 관리자 인증 실패
 */
router.get('/users', listUsers);

/**
 * @swagger
 * /api/admin/users/{uid}:
 *   get:
 *     summary: 회원 상세 조회 (관리자)
 *     description: |
 *       가입 설문(숫자 코드 원본) / 자기이해 검사 / 진로 탐색 / 진로 설계를 한 번에 돌려줍니다.
 *       ⚠️ 가입 설문 선택지 **문구는 싣지 않습니다.** 정본은 FE `SignupWizardPage.vue` 이고
 *       API 에 복사해두면 FE 가 문구를 바꿨을 때 조용히 어긋납니다.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 조회 성공 }
 *       404: { description: 유저를 찾을 수 없음 }
 */
router.get('/users/:uid', getUserDetail);

/**
 * @swagger
 * /api/admin/users/{uid}/reset:
 *   post:
 *     summary: 회원 단계별 리셋 (관리자) — 되돌릴 수 없음
 *     description: |
 *       계정은 남기고 해당 단계 **이후**의 데이터만 지웁니다. 단계는 누적입니다.
 *       - `design` : 진로계획·주간일정·달성기록·커리큘럼완료·인증사진
 *       - `survey` : 검사결과·추천직업·북마크·목표진로 + design
 *       - `signup` : 이름·나이·성별·가입설문 + survey + design
 *
 *       ⚠️ `signup` 이 가입 위저드를 다시 띄우는 것은 **소셜 계정뿐**입니다.
 *       앱 진입 가드가 `socialOnly && !onboarding.answeredAt` 일 때만 위저드로 보냅니다.
 *       응답의 `wizardWillShow` 로 그 여부를 알려줍니다.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stage:
 *                 type: string
 *                 enum: [design, survey, signup]
 *     responses:
 *       200: { description: 리셋 완료. cleared 에 항목별 건수 }
 *       400: { description: stage 값이 올바르지 않음 }
 *       404: { description: 유저를 찾을 수 없음 }
 */
router.post('/users/:uid/reset', resetUser);

/**
 * @swagger
 * /api/admin/users/{uid}:
 *   delete:
 *     summary: 회원 영구 삭제 (관리자) — 되돌릴 수 없음
 *     description: |
 *       계정 문서와 딸린 데이터(진로계획·주간일정·달성기록·커리큘럼완료·검사결과)를 영구 삭제하고
 *       S3 인증사진도 지웁니다. 직업 후기는 본문을 남기고 작성자 이메일만 비워 익명화합니다.
 *       본인 탈퇴(`DELETE /api/user`)와 **같은 경로**(services/userPurge)를 사용합니다.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 삭제 완료. deleted 에 항목별 건수
 *       404:
 *         description: 유저를 찾을 수 없음
 *       401:
 *         description: 관리자 인증 실패
 */
router.delete('/users/:uid', deleteUser);

module.exports = router;