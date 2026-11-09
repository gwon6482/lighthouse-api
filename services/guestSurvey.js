// 회원 가입 전(비회원) 자기이해 검사 — 열람 키(2026-11-09).
//
// survey_id 는 'SURV20261109D_193012T' 처럼 시각 형식이라 추측할 수 있다. 그래서 비회원 응답은
// 제출 때 무작위 열람 키를 하나 만들어 응답자에게만 주고(기기 저장), 서버에는 해시만 둔다.
// 조회·삭제·계정 연결은 이 키가 맞을 때만 한다. 계정에 연결되면 해시를 지운다(그때부터는 계정이 소유).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const newGuestKey = () => crypto.randomBytes(24).toString('hex');
const hashGuestKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/** 문서의 비회원 열람 키와 맞는가(시간차 공격을 막으려 timingSafeEqual) */
function guestKeyMatches(doc, key) {
  const stored = doc?.guest?.keyHash;
  if (!stored || typeof key !== 'string' || !key) return false;
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(hashGuestKey(key), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 로그인이 선택인 경로에서 토큰을 읽는다. 없거나 틀리면 null(=비회원) */
function optionalUser(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(h.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { newGuestKey, hashGuestKey, guestKeyMatches, optionalUser };
