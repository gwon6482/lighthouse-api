const crypto = require('crypto');
const adminAuth = require('./adminAuth');

// /api/admin 앞단 — 설문 문항 편집 전용 키(QUESTION_EDITOR_KEY, 헤더 x-question-key)를 추가로 받는다.
//
// - x-question-key 로는 **PUT /api/admin/questions/:collection_type/:question_id 만** 된다(팀원 문항 문구 수정용, 2026-10-19).
//   그 밖의 /api/admin(회원 삭제·리셋 등)은 지금처럼 x-admin-key(ADMIN_API_KEY)로만 된다.
// - x-question-key 를 보냈는데 키가 틀렸거나 허용 경로가 아니면 바로 401. x-admin-key 검사로 넘기지 않는다
//   (어느 키가 거절됐는지 헷갈리지 않게).
// - QUESTION_EDITOR_KEY 가 서버에 없으면 이 경로는 닫힌다(fail-closed). ADMIN_API_KEY 경로는 영향 없음.
// - 문항 수정은 **어느 키로 했는지** 요청 로그에 남긴다(키 값은 남기지 않는다). 컨테이너 로그라 3일 보관.

const QUESTION_PUT = /^\/questions\/[^/]+\/[^/]+\/?$/;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();
const keyMatches = (provided, expected) => !!expected && crypto.timingSafeEqual(sha256(provided), sha256(expected));

function logQuestionEdit(req, res, keyName) {
  res.on('finish', () => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    console.log(`[question-edit] key=${keyName} status=${res.statusCode} ${req.method} ${req.originalUrl} ip=${ip}`);
  });
}

const questionEditorAuth = (req, res, next) => {
  const isQuestionPut = req.method === 'PUT' && QUESTION_PUT.test(req.path);
  const provided = req.headers['x-question-key'];

  if (provided !== undefined) {
    if (isQuestionPut && keyMatches(provided, process.env.QUESTION_EDITOR_KEY)) {
      req.adminKeyName = 'question-editor';
      logQuestionEdit(req, res, 'question-editor');
      return next();
    }
    if (isQuestionPut) console.warn(`[question-edit] key=question-editor 거절(키 불일치) ${req.originalUrl}`);
    return res.status(401).json({
      success: false,
      error: isQuestionPut ? '문항 편집 키가 올바르지 않습니다' : '문항 편집 키로는 문항 수정만 할 수 있습니다',
    });
  }

  // 기존 관리자 키. 문항 수정이면 관리자 키로 했다는 것도 남긴다
  if (isQuestionPut) logQuestionEdit(req, res, req.headers['x-admin-key'] ? 'admin' : 'none');
  return adminAuth(req, res, next);
};

module.exports = questionEditorAuth;
