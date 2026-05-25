const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('./config/database');
const errorHandler = require('./middleware/error');

// Swagger 설정
const swaggerSpecs = require('./config/swagger');

// 라우터 가져오기
const adminRoutes = require('./routes/admin');
const surveyRoutes = require('./routes/survey');
const jobRoutes = require('./routes/job');
const referenceRoutes = require('./routes/reference');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const careerPlanRoutes = require('./routes/careerPlan');

const app = express();

// MongoDB 연결
connectDB();

// 미들웨어
app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: false,
}));
app.use(cors());
app.options('*', cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger JSON 스펙 (동적 서버 URL)
app.get('/api-docs/swagger.json', (req, res) => {
  const host = req.get('host') || '';
  const serverUrl = host.includes('localhost') || host.includes('127.0.0.1')
    ? `http://${host}`
    : 'https://api.lighthouse.career';
  res.json({
    ...swaggerSpecs,
    servers: [{ url: serverUrl, description: '현재 서버' }]
  });
});

// Swagger UI (CDN 기반 - 로컬/Vercel 모두 호환)
app.get(['/api-docs', '/api-docs/'], (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Lighthouse DB API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>.swagger-ui .topbar { display: none }</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
<script>
  window.onload = function() {
    SwaggerUIBundle({
      url: '/api-docs/swagger.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout',
      docExpansion: 'list',
      filter: true,
      showRequestHeaders: true
    });
  }
</script>
</body>
</html>`);
});

// 라우터
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/job', jobRoutes);
app.use('/api/reference', referenceRoutes);
app.use('/api/career-plan', careerPlanRoutes);

// 기본 라우트
/**
 * @swagger
 * /:
 *   get:
 *     summary: 서버 기본 정보
 *     description: Lighthouse DB API 서버의 기본 정보와 사용 가능한 엔드포인트를 반환합니다.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: 서버 정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Lighthouse DB API 서버에 오신 것을 환영합니다!"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 status:
 *                   type: string
 *                   example: "running"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 endpoints:
 *                   type: object
 *                 collection_types:
 *                   type: array
 *                   items:
 *                     type: string
 */
app.get('/', (req, res) => {
  res.json({
    message: 'Lighthouse DB API 서버에 오신 것을 환영합니다!',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      info: '/api/info',
      docs: '/api-docs',
      admin: {
        all_stats: '/api/admin/questions/stats',
        collection_questions: '/api/admin/questions/:collection_type',
        collection_stats: '/api/admin/questions/:collection_type/stats',
        question_by_id: '/api/admin/questions/:collection_type/:question_id'
      }
    },
    collection_types: ['T1_personality', 'T2_1_talent', 'T2_2_interest', 'T2_3_values', 'T3_environmental']
  });
});

// 헬스 체크 엔드포인트
/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: 서버 헬스 체크
 *     description: 서버의 현재 상태와 데이터베이스 연결 상태를 확인합니다.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: 헬스 체크 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: 서버 실행 시간 (초)
 *                 memory:
 *                   type: object
 *                   description: 메모리 사용량 정보
 *                 database:
 *                   type: string
 *                   example: "connected"
 *                   description: 데이터베이스 연결 상태
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 서버 정보 엔드포인트
/**
 * @swagger
 * /api/info:
 *   get:
 *     summary: 서버 상세 정보
 *     description: 서버의 상세한 설정 정보를 반환합니다.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: 서버 정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: "Lighthouse DB API"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 environment:
 *                   type: string
 *                   example: "development"
 *                 port:
 *                   type: number
 *                   example: 3000
 *                 database:
 *                   type: object
 *                   properties:
 *                     job_data:
 *                       type: string
 *                     survey_questions:
 *                       type: string
 */
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Lighthouse DB API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    database: {
      job_data: process.env.JOB_DATA_DB || 'job_data',
      survey_questions: process.env.SURVEY_QUESTIONS_DB || 'survey_questions'
    }
  });
});

// 404 핸들러
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: '요청한 리소스를 찾을 수 없습니다',
    path: req.originalUrl
  });
});

// 에러 핸들러
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('🚀 Lighthouse DB API 서버가 시작되었습니다!');
    console.log(`📍 서버 주소: http://localhost:${PORT}`);
    console.log(`📚 API 문서: http://localhost:${PORT}/api-docs`);
    console.log(`🌍 환경: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⏰ 시작 시간: ${new Date().toLocaleString('ko-KR')}`);
    console.log('📋 사용 가능한 엔드포인트:');
    console.log(`   - GET  / (기본 정보)`);
    console.log(`   - GET  /api/health (헬스 체크)`);
    console.log(`   - GET  /api/info (서버 정보)`);
    console.log(`   - GET  /api-docs (API 문서)`);
    console.log('🔧 관리자 API:');
    console.log(`   - GET    /api/admin/questions/stats (전체 통계)`);
    console.log(`   - GET    /api/admin/questions/:collection_type (컬렉션별 질문 목록)`);
    console.log(`   - GET    /api/admin/questions/:collection_type/stats (컬렉션별 통계)`);
    console.log(`   - GET    /api/admin/questions/:collection_type/:id (개별 질문)`);
    console.log(`   - POST   /api/admin/questions/:collection_type (질문 생성)`);
    console.log(`   - PUT    /api/admin/questions/:collection_type/:id (질문 수정)`);
    console.log(`   - DELETE /api/admin/questions/:collection_type/:id (질문 삭제)`);
    console.log(`   - PATCH  /api/admin/questions/:collection_type/:id/restore (질문 복구)`);
    console.log('📊 지원 컬렉션: T1_personality, T2_1_talent, T2_2_interest, T2_3_values, T3_environmental');
    console.log('');
  });
}

module.exports = app;