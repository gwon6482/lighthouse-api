const crypto = require('crypto');

// 관리자 API 보호: 공유 비밀키(x-admin-key)를 상수시간 비교로 검증한다.
// 키를 SHA-256으로 고정 길이 해시한 뒤 timingSafeEqual → 길이 노출/타이밍 공격 방지.
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

const adminAuth = (req, res, next) => {
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

  // 키가 서버에 구성돼 있지 않으면 열지 않고 막는다(fail-closed).
  if (!ADMIN_API_KEY) {
    return res.status(503).json({
      success: false,
      error: '관리자 인증이 구성되지 않았습니다 (ADMIN_API_KEY 미설정)',
    });
  }

  const provided = req.headers['x-admin-key'] || '';
  if (!crypto.timingSafeEqual(sha256(provided), sha256(ADMIN_API_KEY))) {
    return res.status(401).json({ success: false, error: '관리자 인증이 필요합니다' });
  }

  next();
};

module.exports = adminAuth;
