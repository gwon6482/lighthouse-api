#!/usr/bin/env node
/**
 * 어드민 '일정관리' 요약 — 작업준비(세션 시작) 때 docs 와 함께 읽는다(2026-11-02).
 *
 *   node scripts/schedule-brief.js            # 운영 API
 *   SCHEDULE_API=http://localhost:4000 node scripts/schedule-brief.js
 *
 * 개발일지(devlog)는 docs 에 있으니 여기선 다루지 않는다. 어드민에서 사람이 넣은 일정·계획·할 일과
 * 배포 워크플로가 남긴 출시 기록을 읽어, 지금 진행 중인 것·다가오는 것·남은 것만 짧게 보여 준다.
 * 키는 .env 의 SCHEDULE_WRITE_KEY(일정 전용 — 조회·추가·수정만). 읽기만 한다.
 * 공개 레포(lighthouse-docs)에 올리지 않으려고 문서로 만들지 않고 그때그때 조회한다.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API = process.env.SCHEDULE_API || 'https://api.lighthouse.career';
const KEY = process.env.SCHEDULE_WRITE_KEY;
const UPCOMING_DAYS = 14;   // 곧 시작할 일정
const RECENT_DAYS = 7;      // 최근에 사람이 바꾼 항목
const RECENT_MAX = 10;      // 그중 몇 건까지 보여 줄지(한꺼번에 많이 넣은 날 출력이 길어지지 않게)

const CAT = { api: 'API', app: '앱', admin: '어드민', landing: '랜딩', planning: '기획', design: '디자인', data: '데이터', ops: '운영' };

// 서울 날짜 'YYYY-MM-DD'
const seoulDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (day, n) => seoulDay(new Date(Date.parse(`${day}T00:00:00+09:00`) + n * 86400e3));
const endOf = (it) => it.endDate || it.startDate;
const range = (it) => (!it.startDate ? (it.endDate ? `~${it.endDate}` : '날짜 없음')
  : it.endDate && it.endDate !== it.startDate ? `${it.startDate}~${it.endDate}` : it.startDate);
const line = (it, extra = '') =>
  `- [${CAT[it.category] ?? it.category}] ${it.title} (${range(it)}${it.assignee ? ` · ${it.assignee}` : ''})${extra}`
  + (it.memo ? `\n    ${it.memo.split('\n')[0].slice(0, 100)}` : '');

async function main() {
  if (!KEY) {
    console.log('⚠️ SCHEDULE_WRITE_KEY 가 lighthouse-api/.env 에 없어 일정관리를 읽지 못했다(키 등록 전). 건너뛴다.');
    return;
  }
  const res = await fetch(`${API}/api/admin/schedule/items`, { headers: { 'x-schedule-key': KEY } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    console.log(`⚠️ 일정관리 조회 실패 ${res.status}: ${body.error ?? ''}`);
    return;
  }
  const items = body.data;
  const today = seoulDay();
  const soon = addDays(today, UPCOMING_DAYS);
  const recentFrom = Date.now() - RECENT_DAYS * 86400e3;
  const open = items.filter((it) => !it.done);

  const sections = [
    ['🛠️ 진행 중인 개발일정', open.filter((it) => it.kind === 'schedule' && it.startDate && it.startDate <= today)
      .map((it) => line(it, endOf(it) < today ? ' ⚠️ 끝날 날 지남' : ''))],
    [`🗓️ ${UPCOMING_DAYS}일 안에 시작할 일정`, open.filter((it) => it.kind === 'schedule' && it.startDate > today && it.startDate <= soon)
      .map((it) => line(it))],
    ['🎯 향후 계획', open.filter((it) => it.kind === 'plan')
      .sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'))
      .map((it) => line(it, it.startDate && endOf(it) < today ? ' ⚠️ 지남' : ''))],
    ['☑️ 남은 할 일', open.filter((it) => it.kind === 'todo')
      .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'))
      .map((it) => line(it, it.endDate && it.endDate < today ? ' ⚠️ 마감 지남' : ''))],
    // 사람이 어드민에서 넣거나 고친 것(자동 기록 source 제외) — 개발일지에 없는 결정·계획일 수 있다
    [`✍️ 최근 ${RECENT_DAYS}일 어드민에서 바뀐 항목`, items
      .filter((it) => !it.source && Date.parse(it.updatedAt) >= recentFrom)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((it) => line(it, ` — ${it.createdAt === it.updatedAt ? '추가' : '수정'} ${seoulDay(new Date(it.updatedAt))}${it.done ? ' · 완료' : ''}`))
      .reduce((acc, row, i, all) => (i < RECENT_MAX ? [...acc, row] : i === RECENT_MAX ? [...acc, `- …외 ${all.length - RECENT_MAX}건(어드민 일정관리에서)`] : acc), [])],
  ];

  console.log(`# 어드민 일정관리 요약 (${today} 기준, 전체 ${items.length}건)`);
  for (const [title, rows] of sections) {
    console.log(`\n## ${title}`);
    console.log(rows.length ? rows.join('\n') : '- 없음');
  }
}

main().catch((e) => console.log(`⚠️ 일정관리 조회 오류: ${e.message}`));
