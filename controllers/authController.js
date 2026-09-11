const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const generateToken = (user) =>
  jwt.sign({ uid: user.uid, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

// POST /api/auth/register
// 온보딩 답변 정규화. 잘못된 형식이면 INVALID 를 돌려 400 으로 끊는다.
// 답이 아예 없으면 null — 이때는 필드 자체를 만들지 않는다(빈 객체를 남기지 않기 위해).
const INVALID = Symbol('invalid-onboarding');

function buildOnboarding(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return INVALID;

  const { status, concerns, selfAwareness } = raw;
  const doc = {};

  if (status !== undefined && status !== null) {
    if (!Number.isInteger(status) || status < 1 || status > 4) return INVALID;
    doc.status = status;
  }
  if (concerns !== undefined && concerns !== null) {
    if (!Array.isArray(concerns)) return INVALID;
    // 빈 배열은 '고르지 않음'으로 본다. 여기서 400 을 내면 선택 항목 하나 때문에
    // **가입 자체가 실패**한다 — 그 대가는 잘못된 형식을 잡는 이득보다 훨씬 크다.
    if (concerns.length > 0) {
      if (!concerns.every((n) => Number.isInteger(n) && n >= 1 && n <= 6)) return INVALID;
      // 중복 제거 — FE 토글이 꼬여도 같은 값이 두 번 들어가지 않게 한다
      doc.concerns = [...new Set(concerns)];
    }
  }
  if (selfAwareness !== undefined && selfAwareness !== null) {
    if (!Number.isInteger(selfAwareness) || selfAwareness < 1 || selfAwareness > 3) return INVALID;
    doc.selfAwareness = selfAwareness;
  }

  if (Object.keys(doc).length === 0) return null;
  doc.answeredAt = new Date();
  return doc;
}

const register = async (req, res, next) => {
  try {
    const { email, password, name, age, gender, onboarding } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: '이메일과 비밀번호를 입력해주세요' });
    }
    if (gender && !['M', 'F'].includes(gender)) {
      return res.status(400).json({ success: false, error: '성별은 M 또는 F만 허용됩니다' });
    }

    // 진로 온보딩 답변(Q1~Q3)은 선택 입력이다. 넘어오면 검증해서 저장하고, 없으면 필드를 만들지 않는다.
    // 2026-09-09 이전에는 FE 가 localStorage 에만 넣고 서버로 보내지 않아 답이 전부 버려졌다.
    const onboardingDoc = buildOnboarding(onboarding);
    if (onboardingDoc === INVALID) {
      return res.status(400).json({ success: false, error: '온보딩 답변 형식이 올바르지 않습니다' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, error: '이미 사용 중인 이메일입니다' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      passwordHash,
      authProviders: [{ provider: 'local', providerId: email.toLowerCase().trim() }],
      ...(name && { name }),
      ...(age && { age: Number(age) }),
      ...(gender && { gender }),
      ...(onboardingDoc && { onboarding: onboardingDoc }),
    });

    const token = generateToken(user);
    res.status(201).json({
      success: true,
      token,
      user: user.toJSON(),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/check-email?email=
// 회원가입 입력 단계에서 이메일 중복 여부를 미리 확인
const checkEmail = async (req, res, next) => {
  try {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ success: false, error: '이메일을 입력해주세요' });
    }
    const existing = await User.findOne({ email });
    res.json({ success: true, available: !existing });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: '이메일과 비밀번호를 입력해주세요' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
    if (!user || !user.passwordHash) {
      return res.status(401).json({ success: false, error: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, error: '비활성화된 계정입니다' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: user.toJSON(),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  // JWT는 서버에서 무효화할 수 없으므로 클라이언트에서 토큰 삭제 안내
  res.json({ success: true, message: '로그아웃되었습니다. 클라이언트 토큰을 삭제해주세요.' });
};

// GET /api/auth/me
const me = async (req, res, next) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }
    res.json({ success: true, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/complete-profile  (인증 필요)
// 소셜 가입자가 가입 위저드를 마칠 때 부른다.
//
// ⚠️ 소셜 로그인은 콜백에서 **계정이 이미 만들어진다.** 그래서 위저드 끝에서 register 를
//    부를 수 없다(409 가 난다). 이메일 가입이 register 한 번에 하는 일을
//    '계정 생성(콜백)' + '나머지 채우기(여기)' 둘로 나눈 것이다.
const completeProfile = async (req, res, next) => {
  try {
    const { name, age, gender, onboarding } = req.body;

    if (gender && !['M', 'F'].includes(gender)) {
      return res.status(400).json({ success: false, error: '성별은 M 또는 F만 허용됩니다' });
    }
    if (age !== undefined && age !== null) {
      const n = Number(age);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        return res.status(400).json({ success: false, error: '나이는 1~120 사이 정수만 허용됩니다' });
      }
    }

    // 검증 규칙은 register 와 **같은 함수**를 쓴다. 두 벌로 두면 반드시 어긋난다.
    const onboardingDoc = buildOnboarding(onboarding);
    if (onboardingDoc === INVALID) {
      return res.status(400).json({ success: false, error: '온보딩 답변 형식이 올바르지 않습니다' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, error: '유저를 찾을 수 없습니다' });
    }

    // 보내온 것만 덮어쓴다. 빈 값으로 기존 값을 지우지 않는다
    // (위저드를 두 번 돌더라도 이미 채운 정보가 날아가면 안 된다).
    if (name) user.name = name;
    if (age !== undefined && age !== null) user.age = Number(age);
    if (gender) user.gender = gender;
    if (onboardingDoc) user.onboarding = onboardingDoc;

    await user.save();
    res.json({ success: true, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};

// buildOnboarding 은 검증 로직 단위 확인용으로 함께 내보낸다(라우터는 쓰지 않는다).
module.exports = { register, checkEmail, login, logout, me, completeProfile, buildOnboarding, INVALID };
