const express = require('express');
const router = express.Router();
const { getCareerNews } = require('../services/news');

/**
 * @swagger
 * tags:
 *   name: News
 *   description: 진로 뉴스(앱 '진로정보' 탭)
 */

/**
 * @swagger
 * /api/news/career:
 *   get:
 *     summary: "진로 뉴스 목록(진로엔뉴스 RSS)"
 *     description: |
 *       진로엔뉴스 공식 RSS 를 1시간 캐시해 **제목·날짜·출처·원문 링크만** 돌려준다.
 *       저작권(진로엔뉴스 저작권보호정책)상 썸네일·요약은 내보내지 않는다. 로그인 불필요.
 *     tags: [News]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, minimum: 1, maximum: 30 }
 *     responses:
 *       200:
 *         description: 성공(가져오지 못하면 items 가 빈 배열)
 */
router.get('/career', async (req, res, next) => {
  try {
    const data = await getCareerNews({ limit: req.query.limit });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
