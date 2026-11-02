const mongoose = require('mongoose');
const { TeamScheduleItem, TeamMember, DATE_RE } = require('../models/TeamSchedule');

// 어드민 '일정관리' — /api/admin/schedule/*. 인증은 /api/admin 앞단(x-admin-key)이 한다.

const ITEM_FIELDS = ['kind', 'title', 'memo', 'category', 'assignee', 'startDate', 'endDate', 'done', 'link', 'source'];
const pick = (body) => Object.fromEntries(ITEM_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

// 날짜 짝 검사 — 끝이 시작보다 앞이면 거절(모델 검사로는 두 필드를 같이 못 본다)
function dateError(item) {
  const { startDate = '', endDate = '' } = item;
  if (endDate && !startDate && item.kind !== 'todo') return '시작일을 넣어 주세요';
  if (startDate && endDate && endDate < startDate) return '끝나는 날이 시작일보다 앞이에요';
  return null;
}

const badRequest = (res, error) => res.status(400).json({ success: false, error });
const validId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /schedule/items?from=YYYY-MM-DD&to=YYYY-MM-DD
//   기간을 주면 그 기간과 겹치는 항목 + 날짜 없는 항목(할 일). 안 주면 전부(팀 내부용이라 수가 적다)
const listItems = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let q = {};
    if (from || to) {
      if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return badRequest(res, 'from·to 는 YYYY-MM-DD');
      const overlap = { $and: [] };
      if (to) overlap.$and.push({ startDate: { $ne: '', $lte: to } });
      if (from) overlap.$and.push({ $or: [{ endDate: { $gte: from } }, { endDate: '', startDate: { $gte: from } }] });
      q = { $or: [overlap, { startDate: '' }] };
    }
    const data = await TeamScheduleItem.find(q).sort({ startDate: 1, createdAt: 1 }).lean();
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

const createItem = async (req, res, next) => {
  try {
    const body = pick(req.body ?? {});
    if (!body.source) delete body.source;
    const err = dateError(body);
    if (err) return badRequest(res, err);
    // 같은 출처의 자동 기록이 이미 있으면 그대로 돌려준다(200) — 워크플로를 다시 돌려도 중복이 생기지 않게
    if (body.source) {
      const existing = await TeamScheduleItem.findOne({ source: body.source }).lean();
      if (existing) return res.json({ success: true, data: existing, existing: true });
    }
    const item = await TeamScheduleItem.create(body);
    res.status(201).json({ success: true, data: item });
  } catch (e) {
    if (e.name === 'ValidationError') return badRequest(res, Object.values(e.errors)[0]?.message ?? '입력값이 올바르지 않습니다');
    next(e);
  }
};

const updateItem = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return badRequest(res, 'id 형식이 올바르지 않습니다');
    const item = await TeamScheduleItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다' });
    const { source, ...patch } = pick(req.body ?? {});   // 출처는 만들 때만 정한다
    void source;
    Object.assign(item, patch);
    const err = dateError(item);
    if (err) return badRequest(res, err);
    await item.save();
    res.json({ success: true, data: item });
  } catch (e) {
    if (e.name === 'ValidationError') return badRequest(res, Object.values(e.errors)[0]?.message ?? '입력값이 올바르지 않습니다');
    next(e);
  }
};

const deleteItem = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return badRequest(res, 'id 형식이 올바르지 않습니다');
    const r = await TeamScheduleItem.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다' });
    res.json({ success: true });
  } catch (e) { next(e); }
};

const listMembers = async (req, res, next) => {
  try {
    const data = await TeamMember.find().sort({ createdAt: 1 }).lean();
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

const createMember = async (req, res, next) => {
  try {
    const member = await TeamMember.create({ name: req.body?.name, color: req.body?.color ?? '' });
    res.status(201).json({ success: true, data: member });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ success: false, error: '이미 있는 이름이에요' });
    if (e.name === 'ValidationError') return badRequest(res, Object.values(e.errors)[0]?.message ?? '입력값이 올바르지 않습니다');
    next(e);
  }
};

// 팀원을 지워도 그 사람이 담당한 항목은 남는다(이름 글자로 남아 기록이 사라지지 않게)
const deleteMember = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return badRequest(res, 'id 형식이 올바르지 않습니다');
    const r = await TeamMember.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) return res.status(404).json({ success: false, error: '팀원을 찾을 수 없습니다' });
    res.json({ success: true });
  } catch (e) { next(e); }
};

module.exports = { listItems, createItem, updateItem, deleteItem, listMembers, createMember, deleteMember };
