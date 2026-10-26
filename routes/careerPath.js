const express = require('express');
const router = express.Router();
const { careerPathLimiter } = require('../middleware/rateLimit');
const { submitContribution } = require('../controllers/careerPathController');

/**
 * @swagger
 * /api/career-path/contributions:
 *   post:
 *     summary: 직업인 진로과정 참여 제출 (공개, 비회원)
 *     description: |
 *       랜딩 www /career-path. type=mine(나의 진로과정 등록) 또는 review(라이트하우스 템플릿 살펴보기).
 *       검수 대기(pending)로 저장하고 제출 확인 번호(contribution_id)를 돌려준다 — 삭제 요청은 이 번호로 받는다(처리방침 제6조).
 *       이름·연락처·User-Agent 는 받지 않는다(처리방침 제2조 6). 보유 3년(TTL).
 *     tags: [CareerPath]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, consent, jobCode, careerYears, startStage]
 *             properties:
 *               type: { type: string, enum: [mine, review] }
 *               consent: { type: boolean }
 *               jobCode: { type: string }
 *               careerYears: { type: string, enum: [lt1, 1to3, 3to5, 5to10, gte10] }
 *               startStage: { type: string, enum: [nonmajor, major, career] }
 *               respondent_id: { type: string, description: 연구 설문 결과 링크에서 이어 온 경우 }
 *               campaign: { type: string, description: "'__local_test__' = 테스트" }
 *               mine: { type: object, description: "{ track{id?,name,desc?}, entries[{kind,category,name,link?,weeks?,hoursPerWeek?,why?,items[]}], retro{must,skip,redo} }" }
 *               review: { type: object, description: "{ stages[{stage,reordered,order[],changes[{type,id?,at?,name?,goal?,weeks?,comment?,reason?}]}], overall? }" }
 *     responses:
 *       201: { description: "{ success, contribution_id }" }
 *       400: { description: 입력 오류 }
 *       429: { description: 요청 과다 }
 */
router.post('/contributions', careerPathLimiter, submitContribution);

module.exports = router;
