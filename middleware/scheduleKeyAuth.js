const crypto = require('crypto');

// /api/admin 맨 앞 — 일정관리 전용 키(SCHEDULE_WRITE_KEY, 헤더 x-schedule-key)(2026-11-02).
//
// 배포 워크플로(GitHub Actions)와 개발일지를 쓰는 Claude 가 일정관리에 기록을 남기는 용도.
// 전체 관리자 키를 Actions 에 주지 않으려고 따로 둔다 — 이 키로는 **일정 항목 조회·추가·수정만** 된다
// (삭제·팀원 관리·그 밖의 /api/admin 은 안 된다).
// - 헤더가 없으면 아무것도 하지 않고 다음(문항 편집 키 → 관리자 키 검사)으로 넘긴다.
// - 헤더가 있는데 키가 틀렸거나 허용 밖이면 바로 401(관리자 키 검사로 넘기지 않는다 — 어느 키가 거절됐는지 헷갈리지 않게).
// - SCHEDULE_WRITE_KEY 가 서버에 없으면 이 경로는 닫힌다(fail-closed).
const ITEMS = /^\/schedule\/items(\/[0-9a-f]{24})?\/?$/;
const ALLOWED = { GET: true, POST: true, PUT: true };

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();
const keyMatches = (provided, expected) => !!expected && crypto.timingSafeEqual(sha256(provided), sha256(expected));

const scheduleKeyAuth = (req, res, next) => {
  const provided = req.headers['x-schedule-key'];
  if (provided === undefined) return next();

  const allowed = ALLOWED[req.method] && ITEMS.test(req.path);
  if (allowed && keyMatches(provided, process.env.SCHEDULE_WRITE_KEY)) {
    req.scheduleKeyOk = true;
    res.on('finish', () => console.log(`[schedule-key] status=${res.statusCode} ${req.method} ${req.originalUrl}`));
    return next();
  }
  return res.status(401).json({
    success: false,
    error: allowed ? '일정 키가 올바르지 않습니다' : '일정 키로는 일정 항목 조회·추가·수정만 할 수 있습니다',
  });
};

module.exports = scheduleKeyAuth;
