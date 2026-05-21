const express = require('express');
const router = express.Router();
const { searchDuties } = require('../controllers/dutyController');

/**
 * @swagger
 * tags:
 *   name: Duties
 *   description: 직무 카탈로그 API
 */

/**
 * @swagger
 * /api/duties:
 *   get:
 *     summary: 직무 검색
 *     tags: [Duties]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: 검색어 (직무명/키워드)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: 직무 목록 반환
 */
router.get('/', searchDuties);

module.exports = router;
