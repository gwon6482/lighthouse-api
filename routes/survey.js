const express = require('express');
const router = express.Router();
const {
  getSurveyForm,
  submitSurveyResponse,
  getSurveyReport,
  getSurveyAnalysis,
  getT1Result,
  updateSurveyStatistics,
  getSurveyStatistics,
  getSurveyResultList
} = require('../controllers/surveyController');
const adminAuth = require('../middleware/adminAuth');
const { authenticate } = require('../middleware/auth');

/**
 * @swagger
 * /api/survey/form:
 *   get:
 *     summary: 전체 설문지 조회
 *     description: 모든 컬렉션의 활성화된 질문들을 조회하여 설문지를 생성합니다.
 *     tags: [Survey]
 *     responses:
 *       200:
 *         description: 설문지 조회 성공
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
 *                     survey_id:
 *                       type: string
 *                       description: 자동 생성된 설문 ID
 *                     questions:
 *                       type: object
 *                       properties:
 *                         T1_personality:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Question'
 *                         T2_1_talent:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Question'
 *                         T2_2_interest:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Question'
 *                         T2_3_values:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Question'
 *                         T3_environmental:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Question'
 */
router.get('/form', getSurveyForm);

/**
 * @swagger
 * /api/survey/response:
 *   post:
 *     summary: 설문 응답 제출
 *     description: 사용자의 설문 응답을 저장합니다.
 *     tags: [Survey]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - survey_id
 *               - answers
 *             properties:
 *               survey_id:
 *                 type: string
 *                 description: 설문 ID
 *               completed_at:
 *                 type: string
 *                 format: date-time
 *                 description: 완료 시간
 *               is_completed:
 *                 type: boolean
 *                 description: 완료 여부
 *               temp_save:
 *                 type: object
 *                 properties:
 *                   part:
 *                     type: string
 *                     nullable: true
 *                   page:
 *                     type: string
 *                     nullable: true
 *                   question_num:
 *                     type: string
 *                     nullable: true
 *                 description: 임시 저장 정보
 *               answer_type:
 *                 type: string
 *                 description: 응답 타입
 *               answers:
 *                 type: object
 *                 description: 컬렉션별 응답
 *                 properties:
 *                   T1:
 *                     type: object
 *                     description: 성격 관련 응답
 *                     additionalProperties:
 *                       type: string
 *                       enum: [O, X]
 *                   T21:
 *                     type: object
 *                     description: 재능 관련 응답
 *                     additionalProperties:
 *                       type: string
 *                       enum: [O, X]
 *                   T22:
 *                     type: object
 *                     description: 관심사 관련 응답
 *                     properties:
 *                       checked:
 *                         type: array
 *                         items:
 *                           type: string
 *                   T23:
 *                     type: object
 *                     description: 가치관 관련 응답
 *                     properties:
 *                       priority_1:
 *                         type: string
 *                       priority_2:
 *                         type: string
 *                       priority_3:
 *                         type: string
 *                       no_priority:
 *                         type: array
 *                         items:
 *                           type: string
 *                   T3:
 *                     type: object
 *                     description: 업무환경 파트별 레벨 (1~5 정수)
 *                     properties:
 *                       T3_PHY: { type: integer, minimum: 1, maximum: 5, description: 근무환경 강도 }
 *                       T3_PEO: { type: integer, minimum: 1, maximum: 5, description: 대인접촉 강도 }
 *                       T3_COM: { type: integer, minimum: 1, maximum: 5, description: 커뮤니케이션 강도 }
 *                       T3_RES: { type: integer, minimum: 1, maximum: 5, description: 책임·권한 강도 }
 *                       T3_STR: { type: integer, minimum: 1, maximum: 5, description: 스트레스 강도 }
 *                       T3_FLX: { type: integer, minimum: 1, maximum: 5, description: 업무 유동성 }
 *           example:
 *             survey_id: "12"
 *             completed_at: "2024-06-13T15:30:00+09:00"
 *             is_completed: true
 *             temp_save:
 *               part: null
 *               page: null
 *               question_num: null
 *             answer_type: "type_2"
 *             answers:
 *               T1:
 *                 T1_A4: "O"
 *                 T1_A1: "X"
 *                 T1_E4: "O"
 *                 T1_T1: "X"
 *                 T1_T4: "O"
 *                 T1_G4: "X"
 *                 T1_U2: "O"
 *                 T1_S5: "X"
 *                 T1_A5: "O"
 *                 T1_E3: "X"
 *                 T1_C2: "O"
 *                 T1_A6: "X"
 *                 T1_G3: "O"
 *                 T1_S2: "X"
 *                 T1_U1: "O"
 *                 T1_C3: "X"
 *                 T1_E1: "O"
 *                 T1_C5: "X"
 *                 T1_T5: "O"
 *                 T1_A3: "X"
 *                 T1_C1: "O"
 *                 T1_S1: "X"
 *                 T1_I4: "O"
 *                 T1_U5: "X"
 *                 T1_I3: "O"
 *                 T1_U4: "X"
 *                 T1_R2: "O"
 *                 T1_C4: "X"
 *                 T1_G2: "O"
 *                 T1_A2: "X"
 *                 T1_S4: "O"
 *                 T1_I2: "X"
 *                 T1_T2: "O"
 *                 T1_R1: "X"
 *                 T1_T3: "O"
 *                 T1_R4: "X"
 *                 T1_I1: "O"
 *                 T1_E5: "X"
 *                 T1_G1: "O"
 *                 T1_E2: "X"
 *                 T1_U3: "O"
 *                 T1_S3: "X"
 *                 T1_R3: "O"
 *               T21:
 *                 T21_T2: "O"
 *                 T21_N6: "X"
 *                 T21_I1: "O"
 *                 T21_A4: "X"
 *                 T21_B2: "O"
 *                 T21_S2: "X"
 *                 T21_T3: "O"
 *                 T21_S1: "X"
 *                 T21_I4: "O"
 *                 T21_A8: "X"
 *                 T21_S3: "O"
 *                 T21_L2: "X"
 *                 T21_B5: "O"
 *                 T21_S4: "X"
 *                 T21_A7: "O"
 *                 T21_B3: "X"
 *                 T21_A1: "O"
 *                 T21_N2: "X"
 *                 T21_T6: "O"
 *                 T21_L8: "X"
 *                 T21_B7: "O"
 *                 T21_L4: "X"
 *                 T21_I3: "O"
 *                 T21_B1: "X"
 *                 T21_N7: "O"
 *                 T21_S7: "X"
 *                 T21_T1: "O"
 *                 T21_A6: "X"
 *                 T21_M4: "O"
 *                 T21_B6: "X"
 *                 T21_I6: "O"
 *                 T21_A3: "X"
 *                 T21_L3: "O"
 *                 T21_T5: "X"
 *                 T21_I8: "O"
 *                 T21_I5: "X"
 *                 T21_L7: "O"
 *                 T21_A5: "X"
 *                 T21_B4: "O"
 *                 T21_M1: "X"
 *                 T21_T7: "O"
 *                 T21_S6: "X"
 *                 T21_N1: "O"
 *                 T21_M5: "X"
 *                 T21_S5: "O"
 *                 T21_B8: "X"
 *                 T21_L5: "O"
 *                 T21_A2: "X"
 *                 T21_M2: "O"
 *                 T21_M3: "X"
 *                 T21_N4: "O"
 *                 T21_M6: "X"
 *                 T21_S8: "O"
 *                 T21_N3: "X"
 *                 T21_L6: "O"
 *                 T21_I7: "X"
 *                 T21_L1: "O"
 *                 T21_I2: "X"
 *                 T21_T4: "O"
 *                 T21_N5: "X"
 *                 T21_M7: "O"
 *               T22:
 *                 checked: ["T22_BUS_1", "T22_BUS_2", "T22_BUS_3"]
 *               T23:
 *                 priority_1: "T3_1"
 *                 priority_2: "T3_2"
 *                 priority_3: "T3_3"
 *                 no_priority: ["T3_4", "T3_5", "T3_6"]
 *               T3:
 *                 T3_PHY: 3
 *                 T3_PEO: 2
 *                 T3_COM: 4
 *                 T3_RES: 3
 *                 T3_STR: 2
 *                 T3_FLX: 5
 *     responses:
 *       201:
 *         description: 설문 응답 저장 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SurveyResult'
 *       400:
 *         description: 잘못된 요청
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/response', submitSurveyResponse);

/**
 * @swagger
 * /api/survey/result/{survey_id}:
 *   get:
 *     summary: 설문 결과 조회
 *     description: 특정 설문 ID의 결과를 조회합니다.
 *     tags: [Survey]
 *     parameters:
 *       - in: path
 *         name: survey_id
 *         required: true
 *         schema:
 *           type: string
 *         description: 설문 ID
 *     responses:
 *       200:
 *         description: 설문 결과 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SurveyResult'
 *       404:
 *         description: 설문 결과를 찾을 수 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @swagger
 * /api/survey/report:
 *   post:
 *     summary: 설문 결과 보고서 조회
 *     description: survey_id로 개인 설문 결과를 조회합니다. T1/T21 그룹별 응답값, 모집단 평균, 상위%, T22/T23/T3 결과를 반환합니다.
 *     tags: [Survey]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - survey_id
 *             properties:
 *               survey_id:
 *                 type: string
 *                 description: 설문 ID
 *                 example: "SURV20260305D_120000T"
 *     responses:
 *       200:
 *         description: 설문 결과 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 result:
 *                   type: object
 *                   properties:
 *                     survey_id:
 *                       type: string
 *                     completed_at:
 *                       type: string
 *                       format: date-time
 *                     answer_type:
 *                       type: string
 *                       enum: [type_2, type_5, type_10]
 *                     T1:
 *                       type: object
 *                       description: T1 그룹별 결과 (E,C,S,A,I,R,G,U,T)
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           user:
 *                             type: number
 *                             description: 개인 정규화 점수 평균 (0~1)
 *                           average:
 *                             type: number
 *                             description: 모집단 평균
 *                           top_percent:
 *                             type: number
 *                             nullable: true
 *                             description: 상위 몇% (통계 부족 시 null)
 *                     T21:
 *                       type: object
 *                       description: T21 그룹별 결과 (T,L,M,B,S,I,N,A)
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           user:
 *                             type: number
 *                           average:
 *                             type: number
 *                           top_percent:
 *                             type: number
 *                             nullable: true
 *                     T22:
 *                       type: object
 *                       properties:
 *                         checked:
 *                           type: array
 *                           items:
 *                             type: string
 *                     T23:
 *                       type: object
 *                       properties:
 *                         priority_1:
 *                           type: string
 *                         priority_2:
 *                           type: string
 *                         priority_3:
 *                           type: string
 *                     T3:
 *                       type: object
 *                       description: 업무환경 파트별 레벨 (1~5 정수)
 *                       properties:
 *                         T3_PHY: { type: integer, minimum: 1, maximum: 5 }
 *                         T3_PEO: { type: integer, minimum: 1, maximum: 5 }
 *                         T3_COM: { type: integer, minimum: 1, maximum: 5 }
 *                         T3_RES: { type: integer, minimum: 1, maximum: 5 }
 *                         T3_STR: { type: integer, minimum: 1, maximum: 5 }
 *                         T3_FLX: { type: integer, minimum: 1, maximum: 5 }
 *       400:
 *         description: survey_id 누락
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: 해당 survey_id의 응답 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/report', adminAuth, getSurveyReport);

/**
 * @swagger
 * /api/survey/analysis/{survey_id}:
 *   get:
 *     summary: 설문 분석 결과 조회
 *     description: 특정 설문 ID의 분석 결과를 조회합니다.
 *     tags: [Survey]
 *     parameters:
 *       - in: path
 *         name: survey_id
 *         required: true
 *         schema:
 *           type: string
 *         description: 설문 ID
 *     responses:
 *       200:
 *         description: 설문 분석 결과 조회 성공
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
 *                     survey_id:
 *                       type: string
 *                     analysis:
 *                       type: object
 *                       description: 분석 결과 데이터
 */
router.get('/analysis/:survey_id', authenticate, getSurveyAnalysis);

/**
 * @swagger
 * /api/survey/t1-result/{survey_id}:
 *   get:
 *     summary: T1 성격 유형 결과 조회
 *     description: 특정 설문의 T1 성격 유형 결과를 반환합니다. type_code, full_name, description과 그룹별 상위%를 포함합니다.
 *     tags: [Survey]
 *     parameters:
 *       - in: path
 *         name: survey_id
 *         required: true
 *         schema:
 *           type: string
 *         description: 설문 ID
 *     responses:
 *       200:
 *         description: T1 결과 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 survey_id:
 *                   type: string
 *                 T1_result:
 *                   type: object
 *                   properties:
 *                     type_code:
 *                       type: string
 *                       example: T1EUC
 *                     base_type:
 *                       type: string
 *                     base_name:
 *                       type: string
 *                     modifier_type:
 *                       type: string
 *                       enum: [TOP2, BOTTOM1]
 *                     modifier_element:
 *                       type: string
 *                     modifier:
 *                       type: string
 *                     full_name:
 *                       type: string
 *                     description:
 *                       type: string
 *                     group_scores:
 *                       type: object
 *                       description: "9개 그룹(E,C,S,A,I,R,G,U,T) 정규화 점수"
 *                     percentiles:
 *                       type: object
 *                       description: "그룹별 상위% (통계 부족 시 해당 그룹 키 없음)"
 *       404:
 *         description: 해당 survey_id 없음 또는 T1 데이터 없음
 */
router.get('/t1-result/:survey_id', authenticate, getT1Result);

/**
 * @swagger
 * /api/survey/statistics/update:
 *   post:
 *     summary: 통계치 갱신
 *     description: 설문 통계치를 누적하여 갱신합니다.
 *     tags: [Survey]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - survey_id
 *               - statistics_data
 *             properties:
 *               survey_id:
 *                 type: string
 *                 description: 설문 ID
 *               statistics_data:
 *                 type: object
 *                 description: 통계 데이터
 *     responses:
 *       200:
 *         description: 통계치 갱신 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.post('/statistics/update', adminAuth, updateSurveyStatistics);

/**
 * @swagger
 * /api/survey/statistics:
 *   get:
 *     summary: 통계치 조회
 *     description: 전체 설문 통계를 조회합니다.
 *     tags: [Survey]
 *     responses:
 *       200:
 *         description: 통계치 조회 성공
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
 *                     total_surveys:
 *                       type: number
 *                     total_responses:
 *                       type: number
 *                     collection_statistics:
 *                       type: object
 */
router.get('/statistics', getSurveyStatistics);

/**
 * @swagger
 * /api/survey/result/list:
 *   get:
 *     summary: 설문 결과 리스트 조회
 *     description: 모든 설문 결과 목록을 페이지네이션을 지원하여 조회합니다.
 *     tags: [Survey]
 *     parameters:
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
 *         name: user_id
 *         schema:
 *           type: string
 *         description: 사용자 ID로 필터링
 *     responses:
 *       200:
 *         description: 설문 결과 리스트 조회 성공
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
 *                     $ref: '#/components/schemas/SurveyResult'
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
router.get('/result/list', adminAuth, getSurveyResultList);

module.exports = router; 