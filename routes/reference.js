const express = require('express');
const router = express.Router();
const {
  getSurveyElements, getSurveyElementByCode, getCareerAttributes, getCareerAttributeByCode,
  createSurveyElement, updateSurveyElement, deleteSurveyElement,
  createCareerAttribute, updateCareerAttribute, deleteCareerAttribute,
  getT1Types, getT1TypeByCode
} = require('../controllers/referenceController');
const adminAuth = require('../middleware/adminAuth');

/**
 * @swagger
 * tags:
 *   name: Reference
 *   description: 공통 참조 데이터 (코드 정의)
 */

/**
 * @swagger
 * /api/reference/survey-elements:
 *   get:
 *     summary: 설문 요소 정의 조회
 *     description: |
 *       survey_elements 컬렉션을 조회합니다. query 파라미터로 필터링 가능합니다.
 *       - test_code: T1, T21, T22, T23, T3
 *       - area: personality, talent, interest, values, environmental
 *       - level: upper (상위), sub (하위), item (단일/3단계 항목)
 *       - parent_code: 상위 요소 코드 (하위 요소 필터링 시 사용)
 *     tags: [Reference]
 *     parameters:
 *       - in: query
 *         name: test_code
 *         schema:
 *           type: string
 *           enum: [T1, T21, T22, T23, T3]
 *         description: 검사 코드
 *       - in: query
 *         name: area
 *         schema:
 *           type: string
 *           enum: [personality, talent, interest, values, environmental]
 *         description: 영역명
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [upper, sub, item]
 *         description: 요소 레벨
 *       - in: query
 *         name: parent_code
 *         schema:
 *           type: string
 *         description: "상위 요소 코드 (예: E)"
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       test_code:
 *                         type: string
 *                         example: T1
 *                       area:
 *                         type: string
 *                         example: personality
 *                       level:
 *                         type: string
 *                         enum: [upper, sub, item]
 *                       code:
 *                         type: string
 *                         example: E
 *                       name:
 *                         type: string
 *                         example: 외향성
 *                       definition:
 *                         type: string
 *                         nullable: true
 *                       parent_code:
 *                         type: string
 *                         nullable: true
 */
/**
 * @swagger
 * /api/reference/survey-elements:
 *   post:
 *     summary: 설문 요소 생성
 *     tags: [Reference]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [test_code, area, level, code, name]
 *             properties:
 *               test_code:
 *                 type: string
 *                 enum: [T1, T21, T22, T23, T3]
 *               area:
 *                 type: string
 *                 enum: [personality, talent, interest, values, environmental]
 *               level:
 *                 type: string
 *                 enum: [upper, sub, item]
 *               code:
 *                 type: string
 *               name:
 *                 type: string
 *               definition:
 *                 type: string
 *               parent_code:
 *                 type: string
 *     responses:
 *       201:
 *         description: 생성 성공
 *       409:
 *         description: code 중복
 */
router.get('/survey-elements', getSurveyElements);
router.post('/survey-elements', adminAuth, createSurveyElement);

/**
 * @swagger
 * /api/reference/survey-elements/{code}:
 *   get:
 *     summary: 설문 요소 단건 조회
 *     description: 코드로 특정 요소를 조회합니다. 하위 요소의 경우 상위 요소(parent)도 함께 반환합니다.
 *     tags: [Reference]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: "요소 코드 (예: A, A2)"
 *     responses:
 *       200:
 *         description: 조회 성공
 *       404:
 *         description: 해당 코드 없음
 */
/**
 * @swagger
 * /api/reference/survey-elements/{code}:
 *   put:
 *     summary: 설문 요소 수정
 *     description: code 자체는 변경 불가. 나머지 필드만 수정 가능.
 *     tags: [Reference]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 수정 성공
 *       404:
 *         description: 해당 code 없음
 *   delete:
 *     summary: 설문 요소 삭제
 *     tags: [Reference]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 삭제 성공
 *       404:
 *         description: 해당 code 없음
 */
router.get('/survey-elements/:code', getSurveyElementByCode);
router.put('/survey-elements/:code', adminAuth, updateSurveyElement);
router.delete('/survey-elements/:code', adminAuth, deleteSurveyElement);

/**
 * @swagger
 * /api/reference/career-attributes:
 *   get:
 *     summary: 진로백과 속성 조회
 *     description: |
 *       career_attributes 컬렉션을 조회합니다. category 파라미터로 필터링 가능합니다.
 *       - work_activity: 업무활동 (A01~A41)
 *       - ability: 업무수행능력 (AB01~AB44)
 *       - knowledge: 지식 (KN01~KN33)
 *       - work_environment: 업무환경 (WE01~WE49)
 *       - personality: 성격 (PS01~PS16)
 *       - interest: 흥미 Holland (R, I, A, S, E, C)
 *       - value: 가치관 (VA01~VA13)
 *     tags: [Reference]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [work_activity, ability, knowledge, work_environment, personality, interest, value]
 *         description: 카테고리 필터
 *     responses:
 *       200:
 *         description: 조회 성공
 */
/**
 * @swagger
 * /api/reference/career-attributes:
 *   post:
 *     summary: 진로백과 속성 생성
 *     tags: [Reference]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, code, name, definition]
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [work_activity, ability, knowledge, work_environment, personality, interest, value]
 *               code:
 *                 type: string
 *               name:
 *                 type: string
 *               definition:
 *                 type: string
 *     responses:
 *       201:
 *         description: 생성 성공
 *       409:
 *         description: code 중복
 */
router.get('/career-attributes', getCareerAttributes);
router.post('/career-attributes', adminAuth, createCareerAttribute);

/**
 * @swagger
 * /api/reference/career-attributes/{code}:
 *   get:
 *     summary: 진로백과 속성 단건 조회
 *     tags: [Reference]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: "속성 코드 (예: AB01, KN05, I)"
 *     responses:
 *       200:
 *         description: 조회 성공
 *       404:
 *         description: 해당 코드 없음
 */
/**
 * @swagger
 * /api/reference/career-attributes/{code}:
 *   put:
 *     summary: 진로백과 속성 수정
 *     description: code 자체는 변경 불가. 나머지 필드만 수정 가능.
 *     tags: [Reference]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 수정 성공
 *       404:
 *         description: 해당 code 없음
 *   delete:
 *     summary: 진로백과 속성 삭제
 *     tags: [Reference]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 삭제 성공
 *       404:
 *         description: 해당 code 없음
 */
router.get('/career-attributes/:code', getCareerAttributeByCode);
router.put('/career-attributes/:code', adminAuth, updateCareerAttribute);
router.delete('/career-attributes/:code', adminAuth, deleteCareerAttribute);

/**
 * @swagger
 * /api/reference/t1-types:
 *   get:
 *     summary: T1 성격 유형 목록 조회
 *     description: reference_data.t1_types 컬렉션의 135개 T1 유형을 조회합니다. base_type, modifier_type으로 필터링 가능합니다.
 *     tags: [Reference]
 *     parameters:
 *       - in: query
 *         name: base_type
 *         schema:
 *           type: string
 *           enum: [E, C, S, A, I, R, G, U, T]
 *         description: 대유형 코드
 *       - in: query
 *         name: modifier_type
 *         schema:
 *           type: string
 *           enum: [TOP2, BOTTOM1]
 *         description: 수식어 유형
 *     responses:
 *       200:
 *         description: 조회 성공
 */
router.get('/t1-types', getT1Types);

/**
 * @swagger
 * /api/reference/t1-types/{type_code}:
 *   get:
 *     summary: T1 성격 유형 단건 조회
 *     description: type_code로 특정 T1 유형을 조회합니다. (예: T1EUC)
 *     tags: [Reference]
 *     parameters:
 *       - in: path
 *         name: type_code
 *         required: true
 *         schema:
 *           type: string
 *         description: "T1 유형 코드 (예: T1EUC)"
 *     responses:
 *       200:
 *         description: 조회 성공
 *       404:
 *         description: 해당 유형 코드 없음
 */
router.get('/t1-types/:type_code', getT1TypeByCode);

module.exports = router;
