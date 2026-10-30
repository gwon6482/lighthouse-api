const mongoose = require('mongoose');
const crypto = require('crypto');

// ── 프로젝트 서브스키마 ──────────────────────────────────────
// FE: curriculum = [{ week, title, description }]
// description 은 그 주차의 설명 텍스트(2026-08-27~). 한 주 = 한 덩어리라 항목으로 쪼개지 않는다.
// items 는 그 이전 포맷(주차 안에 항목 여러 개)의 레거시 필드 — 신규 저장은 안 하고 읽기 호환만 유지.

const CurriculumWeekSchema = new mongoose.Schema({
  week:        { type: Number, required: true },
  title:       { type: String, default: '' },
  description: { type: String, default: '' },
  items:       { type: [String], default: [] }   // legacy
}, { _id: false });

// 프로젝트 진행 방식 — 정본은 config/projectMethods.js(앱·랜딩 조사와 동기화)
const { PROJECT_METHODS } = require('../config/projectMethods');
const METHOD_DETAIL_KEYS = ['title', 'link', 'org', 'target', 'deadline', 'resultUrl', 'note'];

// 들어온 방식·세부를 정리한다. 모르는 방식은 null(방식 미정), 세부는 정해진 키·문자열 300자만.
// ⚠️ $set 수정은 스키마 검증을 안 거치므로(runValidators 꺼짐) 컨트롤러가 반드시 이걸 거친다
function cleanMethod(method, detail) {
  const m = PROJECT_METHODS.includes(method) ? method : null;
  const d = {};
  if (m && detail && typeof detail === 'object') {
    for (const k of METHOD_DETAIL_KEYS) {
      if (typeof detail[k] === 'string' && detail[k].trim()) d[k] = detail[k].trim().slice(0, 300);
    }
  }
  return { method: m, methodDetail: d };
}

const ProjectSchema = new mongoose.Schema({
  id:               { type: String, default: () => crypto.randomUUID() },
  name:             { type: String, required: true, trim: true },
  category:         { type: String, enum: ['qualification', 'knowledge', 'skill', 'portfolio', 'experience'], required: true },
  // 진행 방식(영역 × 방식, 2026-10-26) — 앱 composables/projectMethods.ts 와 같은 목록. null = 방식 미정(예전·템플릿 프로젝트)
  method:           { type: String, enum: [...PROJECT_METHODS, null], default: null },
  methodDetail:     { type: Object, default: () => ({}) },   // title·link·org·target·deadline·resultUrl·note (cleanMethod 로 정리)
  goal:             { type: String, default: '' },
  days:             { type: [String], default: [] },
  startTime:        { type: String, default: '' },
  endTime:          { type: String, default: '' },
  // FE 추가 필드 (있으면 저장, 없어도 OK)
  duration:         { type: Number, default: 0 },
  priority:         { type: String, default: 'normal' },
  notification:     { type: Boolean, default: false },
  missedNotification: { type: Boolean, default: true },
  notificationTime: { type: String, default: '' },
  memo:             { type: String, default: '' },
  curriculum:       { type: [CurriculumWeekSchema], default: [] }
}, { _id: false });

// ── 타임라인 서브스키마 ──────────────────────────────────────
// 타임라인 슬롯에는 projectId 배열만 저장 (중복 저장 없음)

// 타임라인 슬롯 — week 는 프로젝트의 **시작 주차**(1-based).
// 주차 경계는 FE 정본(usePlanTimeline): 한 주 = 월요일~일요일 달력 주, 1주차 = startDate 가 속한 주.
// 점유 구간은 저장하지 않는다. 프로젝트의 기간(FE weeks = curriculum 길이)에서 파생하므로
// 여기 저장하면 프로젝트 기간을 고쳤을 때 둘이 어긋난다.
//
// month 는 2026-08-27 주차 전환 이전의 레거시 필드. 신규 저장은 하지 않고,
// 구 데이터를 읽을 때만 startDate 기준으로 week 로 환산한다(_withPopulatedTimeline, 근사값).
const TimelineSlotSchema = new mongoose.Schema({
  week:       { type: Number },                   // 1-based 시작 주차
  month:      { type: String },                   // legacy 'YYYY.MM'
  projectIds: { type: [String], default: [] }
}, { _id: false });

// ── 루틴 서브스키마 ──────────────────────────────────────────
// 진로계획이 끝날 때까지 매일 꾸준히 반복하는 규칙

const RoutineSchema = new mongoose.Schema({
  id:               { type: String, default: () => crypto.randomUUID() },
  name:             { type: String, required: true, trim: true },
  days:             { type: [String], default: [] },
  duration:         { type: Number, default: 30 },
  notificationTime: { type: String, default: '09:00' },
  notification:     { type: Boolean, default: false },
  memo:             { type: String, default: '' }
}, { _id: false });

// ── 진로계획 메인 스키마 ─────────────────────────────────────

const CareerPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    unique: true,
    default: () => crypto.randomUUID()
  },
  userUid: {
    type: String,
    required: true,
    index: true
  },
  name:       { type: String, default: '' },
  targetJob:  { type: String, default: '' },
  startDate:  { type: String, default: '' },   // 'YYYY-MM' 또는 'YYYY-MM-DD'
  endDate:    { type: String, default: '' },   // 'YYYY-MM' 또는 'YYYY-MM-DD'
  reviewDay:  { type: String, default: '' },   // 주간리뷰 요일 ('월'|'화'|...|'일'). 일주일의 끝이자 시작
  // 진행 속도(2026-10-30) — 앱 usePlanPace 의 키와 주당 시간. 주간결산에서 바꿀 수 있다(바꾸면 남은 계획 재배치)
  paceKey:    { type: String, enum: ['', 'light', 'steady', 'focus', 'full', 'allin'], default: '' },
  paceHours:  { type: Number, default: null },
  projects:   { type: [ProjectSchema], default: [] },
  routines:   { type: [RoutineSchema], default: [] },
  timeline:   { type: [TimelineSlotSchema], default: [] },
  status: {
    type: String,
    enum: ['draft', 'active', 'completed'],
    default: 'draft'
  }
}, {
  timestamps: true
});

const userDataDb = mongoose.connection.useDb(process.env.USER_DATA_DB || 'user_data');
module.exports = userDataDb.model('CareerPlan', CareerPlanSchema, 'career_plans');
module.exports.cleanMethod = cleanMethod;
module.exports.PROJECT_METHODS = PROJECT_METHODS;
