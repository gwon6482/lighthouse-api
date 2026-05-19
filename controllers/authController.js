const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const generateToken = (user) =>
  jwt.sign({ uid: user.uid, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, name, age, gender } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: '이메일과 비밀번호를 입력해주세요' });
    }
    if (gender && !['M', 'F'].includes(gender)) {
      return res.status(400).json({ success: false, error: '성별은 M 또는 F만 허용됩니다' });
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

module.exports = { register, login, logout, me };
