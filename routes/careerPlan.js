const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  createPlan, updatePlan, getMyPlans, getPlan, deletePlan,
  addProject, bulkAddProjects, updateProject, deleteProject,
  addRoutine, updateRoutine, deleteRoutine,
  saveTimeline,
  getTemplates
} = require('../controllers/careerPlanController');
const {
  listSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule
} = require('../controllers/weeklyScheduleController');
const {
  listAchievements, upsertAchievement, deleteAchievement,
  listCurriculum, upsertCurriculum, presignUpload
} = require('../controllers/achievementController');

/**
 * @swagger
 * /api/career-plan/templates:
 *   get:
 *     summary: 공개 진로계획 템플릿 목록 (인증 불필요)
 *     tags: [CareerPlan]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: 검색어 (풀텍스트)
 *     responses:
 *       200:
 *         description: 템플릿 목록 반환
 */
router.get('/templates', getTemplates);

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: CareerPlan
 *   description: 진로계획 API
 */

/**
 * @swagger
 * /api/career-plan:
 *   post:
 *     summary: 진로계획 생성 (STEP1)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:      { type: string }
 *               targetJob: { type: string }
 *               startDate: { type: string, example: "2026-03" }
 *               endDate:   { type: string, example: "2026-12" }
 *     responses:
 *       201:
 *         description: 생성 성공
 */
router.post('/', createPlan);

/**
 * @swagger
 * /api/career-plan:
 *   get:
 *     summary: 내 진로계획 목록
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 계획 목록 반환
 */
router.get('/', getMyPlans);

/**
 * @swagger
 * /api/career-plan/{planId}:
 *   get:
 *     summary: 진로계획 상세 조회
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 계획 반환
 *       404:
 *         description: 계획 없음
 */
router.get('/:planId', getPlan);

/**
 * @swagger
 * /api/career-plan/{planId}:
 *   put:
 *     summary: 진로계획 기본 정보 수정
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:      { type: string }
 *               targetJob: { type: string }
 *               startDate: { type: string }
 *               endDate:   { type: string }
 *               status:    { type: string, enum: [draft, active, completed] }
 *     responses:
 *       200:
 *         description: 수정 성공
 */
router.put('/:planId', updatePlan);

/**
 * @swagger
 * /api/career-plan/{planId}:
 *   delete:
 *     summary: 진로계획 삭제
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 삭제 성공
 */
router.delete('/:planId', deletePlan);

/**
 * @swagger
 * /api/career-plan/{planId}/projects:
 *   post:
 *     summary: 프로젝트 추가 (STEP2)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, category]
 *             properties:
 *               name:       { type: string }
 *               category:   { type: string, enum: [qualification, knowledge, skill, portfolio] }
 *               goal:       { type: string }
 *               days:       { type: array, items: { type: string } }
 *               startTime:  { type: string }
 *               endTime:    { type: string }
 *               curriculum: { type: array }
 *     responses:
 *       201:
 *         description: 추가 성공
 */
router.post('/:planId/projects', addProject);
router.post('/:planId/projects/bulk', bulkAddProjects);

/**
 * @swagger
 * /api/career-plan/{planId}/projects/{projId}:
 *   put:
 *     summary: 프로젝트 수정
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: projId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 수정 성공
 */
router.put('/:planId/projects/:projId', updateProject);

/**
 * @swagger
 * /api/career-plan/{planId}/projects/{projId}:
 *   delete:
 *     summary: 프로젝트 삭제
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: projId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 삭제 성공
 */
router.delete('/:planId/projects/:projId', deleteProject);

/**
 * @swagger
 * /api/career-plan/{planId}/routines:
 *   post:
 *     summary: 루틴 추가
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:             { type: string }
 *               days:             { type: array, items: { type: string } }
 *               duration:         { type: integer }
 *               notificationTime: { type: string, example: "09:00" }
 *               notification:     { type: boolean }
 *               memo:             { type: string }
 *     responses:
 *       201:
 *         description: 추가 성공
 */
router.post('/:planId/routines', addRoutine);

/**
 * @swagger
 * /api/career-plan/{planId}/routines/{routineId}:
 *   put:
 *     summary: 루틴 수정
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: routineId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 수정 성공
 */
router.put('/:planId/routines/:routineId', updateRoutine);

/**
 * @swagger
 * /api/career-plan/{planId}/routines/{routineId}:
 *   delete:
 *     summary: 루틴 삭제
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: routineId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 삭제 성공
 */
router.delete('/:planId/routines/:routineId', deleteRoutine);

/**
 * @swagger
 * /api/career-plan/{planId}/timeline:
 *   put:
 *     summary: 타임라인 저장 (STEP3)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [timeline]
 *             properties:
 *               timeline:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     month:    { type: string, example: "2026.03" }
 *                     projects: { type: array }
 *     responses:
 *       200:
 *         description: 저장 성공
 */
router.put('/:planId/timeline', saveTimeline);

/**
 * @swagger
 * /api/career-plan/{planId}/weekly-schedule:
 *   get:
 *     summary: 주간 일정 목록 (weekStart desc)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 주간 일정 목록
 *   post:
 *     summary: 주간 일정 생성 (해당 주가 이미 있으면 409)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [weekStart, weekEnd]
 *             properties:
 *               weekStart: { type: string, example: "2026-05-26" }
 *               weekEnd:   { type: string, example: "2026-06-01" }
 *               items:     { type: array }
 *     responses:
 *       201: { description: 생성 성공 }
 *       409: { description: 해당 주의 일정이 이미 존재 }
 */
router.get('/:planId/weekly-schedule', listSchedules);
router.post('/:planId/weekly-schedule', createSchedule);

/**
 * @swagger
 * /api/career-plan/{planId}/weekly-schedule/{weekStart}:
 *   get:
 *     summary: 특정 주의 일정 조회 (없으면 schedule=null 반환)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *   put:
 *     summary: 주간 일정 수정 (items / weekEnd / reviewNote / status)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: 주간 일정 삭제
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:planId/weekly-schedule/:weekStart', getSchedule);
router.put('/:planId/weekly-schedule/:weekStart', updateSchedule);
router.delete('/:planId/weekly-schedule/:weekStart', deleteSchedule);

/**
 * @swagger
 * /api/career-plan/uploads/presign:
 *   post:
 *     summary: 인증사진 S3 업로드용 presigned URL 발급
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contentType: { type: string, example: image/jpeg }
 *     responses:
 *       200:
 *         description: "{ uploadUrl, fileUrl, key } 반환 (uploadUrl 로 PUT 후 fileUrl 저장)"
 */
router.post('/uploads/presign', presignUpload);

/**
 * @swagger
 * /api/career-plan/{planId}/achievements:
 *   get:
 *     summary: 진로달성 기록 목록 (from/to 범위, 피드/완료상태 복원용)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         schema: { type: string }
 *         required: true
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *         description: "YYYY-MM-DD (이상)"
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *         description: "YYYY-MM-DD (이하)"
 *     responses:
 *       200:
 *         description: "{ records: [...] }"
 *
 * /api/career-plan/{planId}/achievements/{date}/{itemType}/{itemId}:
 *   put:
 *     summary: 달성 기록 upsert (완료 토글 또는 인증 기록)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: 달성 기록 삭제 (완료 토글 off)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:planId/achievements', listAchievements);
router.put('/:planId/achievements/:date/:itemType/:itemId', upsertAchievement);
router.delete('/:planId/achievements/:date/:itemType/:itemId', deleteAchievement);

/**
 * @swagger
 * /api/career-plan/{planId}/curriculum:
 *   get:
 *     summary: 커리큘럼 항목 완료 목록
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 *
 * /api/career-plan/{planId}/curriculum/{projectId}/{week}/{idx}:
 *   put:
 *     summary: 커리큘럼 항목 완료 토글 (body.done=false 면 해제)
 *     tags: [CareerPlan]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:planId/curriculum', listCurriculum);
router.put('/:planId/curriculum/:projectId/:week/:idx', upsertCurriculum);

module.exports = router;
