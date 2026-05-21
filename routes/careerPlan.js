const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  createPlan, updatePlan, getMyPlans, getPlan, deletePlan,
  addProject, updateProject, deleteProject, saveTimeline
} = require('../controllers/careerPlanController');

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
 *               duties:    { type: array, items: { type: string } }
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
 *               duties:    { type: array, items: { type: string } }
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

module.exports = router;
