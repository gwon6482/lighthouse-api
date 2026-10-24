// 직업별 인재상 → 진로설계 프로젝트 예시 — 진로설계 '예시 DB' 4단계.
//   node --env-file=.env scripts/project-examples-generate.js --req temp/job-requirements-pilot.json --out temp/project-examples-pilot.json --model gemini-pro-latest
//
// 직업 × 카테고리(자격요건·분야지식·직무기술·포트폴리오)마다 예시 프로젝트를 만든다. 앱의 Project 모양 그대로:
//   이름·목표·주차별 커리큘럼(주마다 제목+할 일 3개)·권장 요일 수·1회 시간·난이도 + **근거**(어떤 공고 비율·직업정보에서 왔는지)
// 원칙:
//   - 근거 없는 예시는 만들지 않는다. 각 예시는 basis 에 근거 항목을 적는다(예: "공고 97건 중 20%가 정보처리기사 요구")
//   - 자격증은 공식 목록(official) 또는 공고에 2건 이상 나온 것만. 지어낸 자격증 금지
//   - 특정 학원·유료 강의 상품명을 지어내지 않는다(실제 강의 연결은 훈련과정 API 단계에서 따로)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { pickProvider } = require('./lib/llm');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('model', 'gemini-pro-latest');
const PER_CAT = Number(arg('per', 4));

const CATS = {
  qualification: '자격요건 — 자격증·면허 취득 준비',
  knowledge: '분야지식 — 이론·법규·개념 공부',
  skill: '직무기술 — 도구·기술을 손에 익히는 연습',
  portfolio: '포트폴리오 — 결과물이 남는 프로젝트(웹앱·기획서·콘텐츠·공모전 출품작 등)',
  // 2026-10-25 추가: 인턴·현장실습처럼 '기간·시간을 채우는' 준비물. 예전엔 포트폴리오에 억지로 넣어 '실습 보고서' 같은 가짜 결과물이 생겼다
  experience: '실무경험 — 인턴십·현장실습·대외활동·봉사처럼 기간이나 시간을 채우는 활동',
};

const SYSTEM = `너는 진로 준비 코치다. 한 직업을 목표로 하는 사람이 '진로계획'에 담을 프로젝트 예시를 만든다.
반드시 주어진 근거(채용공고 집계·직업정보) 안에서만 만든다. 근거에 없는 자격증·도구는 쓰지 않는다.
- 프로젝트 하나 = 몇 주 동안 반복해서 하는 준비 활동. 이름은 짧고 구체적으로(예: "정보처리기사 필기 합격", "Java 웹 게시판 만들기").
- goal: 끝났을 때 무엇이 남는지 한 문장.
- curriculum: 2~8주. 주마다 title 과 items(할 일 3개, 각 15자 안팎).
- daysPerWeek(1~6), minutesPerSession(30~180), level("입문"|"중급").
- basis: 이 예시의 근거를 한 문장으로. 공고 비율이 있으면 숫자로(예: "응용SW 공고 97건 중 20%가 정보처리기사를 요구").
- 특정 학원·유료 강의·책 제목을 지어내지 않는다.
- 같은 카테고리 안에서 예시끼리 겹치지 않게, 쉬운 것부터 어려운 것 순서로.
- 개수를 억지로 채우지 않는다. 이 직업 채용에서 관행이 아닌 카테고리는 적게 만들거나 빈 배열로 둔다
  (예: 간호사·사회복지사는 결과물 포트폴리오를 거의 보지 않는다 — '매뉴얼북 제작' 같은 항목을 지어내지 말 것).
- 실습·인턴·대외활동은 portfolio 가 아니라 experience 다. 법정 필수 실습(예: 사회복지사 2급 현장실습 120시간)은 반드시 experience 에 넣는다.
- experience 의 curriculum 은 '그 기간 동안 무엇을 하고 무엇을 정리하는지'로 쓴다(지원·준비 → 수행 → 기록·정리).`;

const PROJECT = {
  type: 'object',
  properties: {
    name: { type: 'string' }, goal: { type: 'string' }, level: { type: 'string', enum: ['입문', '중급'] },
    daysPerWeek: { type: 'integer' }, minutesPerSession: { type: 'integer' }, basis: { type: 'string' },
    curriculum: { type: 'array', items: { type: 'object', properties: { week: { type: 'integer' }, title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['week', 'title', 'items'] } },
  },
  required: ['name', 'goal', 'level', 'daysPerWeek', 'minutesPerSession', 'basis', 'curriculum'],
};
const SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(Object.keys(CATS).map((c) => [c, { type: 'array', items: PROJECT }])),
  required: Object.keys(CATS),
};

const fmt = (arr, n = 12) => (arr ?? []).slice(0, n).map((x) => `${x.name} ${Math.round(x.share * 100)}%${x.official === false ? '(공식목록 외)' : ''}`).join(', ') || '(없음)';

(async () => {
  const reqs = JSON.parse(fs.readFileSync(path.resolve(arg('req', 'temp/job-requirements-pilot.json')), 'utf8'));
  const llm = pickProvider(arg('provider', 'gemini'));
  await mongoose.connect(process.env.MONGODB_URI);
  const info = new Map((await mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data').collection('job_info')
    .find({ jobCode: { $in: reqs.map((r) => r.jobCode) } }, { projection: { jobCode: 1, title: 1, overview: 1, duties: 1, relatedCertifications: 1, relatedMajors: 1, 'work24.way': 1, 'details.지식.중요도': 1 } })
    .toArray()).map((j) => [j.jobCode, j]));
  // 직업정보 지식은 코드(KN01…)로 들어 있다 → 이름표(reference_data.career_attributes)
  const knName = new Map((await mongoose.connection.useDb(process.env.REFERENCE_DATA_DB || 'reference_data').collection('career_attributes')
    .find({ category: 'knowledge' }, { projection: { code: 1, name: 1 } }).toArray()).map((a) => [a.code, a.name]));
  await mongoose.disconnect();

  const out = [];
  const usage = { input: 0, output: 0 };
  for (const r of reqs) {
    const j = info.get(r.jobCode);
    if (!j) continue;
    const knowledgeTop = (j.details?.지식?.중요도?.직업내 ?? []).slice(0, 8).map((x) => `${knName.get(x.code) ?? x.code}(${x.score})`).join(', ');
    const prompt = `# 목표 직업: ${j.title}
개요: ${j.overview ?? ''}
되는 길(직업정보): ${String(j.work24?.way ?? '').slice(0, 600)}
직업정보 관련 자격: ${(j.relatedCertifications ?? []).join(', ') || '(없음)'}
직업정보 관련 학과: ${(j.relatedMajors ?? []).map((m) => m.name ?? m).join(', ') || '(없음)'}
직업정보 중요 지식: ${knowledgeTop || '(없음)'}

# 채용공고 집계 (고용24 공고 ${r.posts}건, 비율 = 그 항목을 요구한 공고 비율)
자격증: ${fmt(r.qualifications)}
분야지식: ${fmt(r.knowledge)}
기술·도구: ${fmt(r.skills)}
경험: ${fmt(r.experiences)}
담당업무: ${fmt(r.duties, 10)}

카테고리마다 예시를 최대 ${PER_CAT}개 만들어라(근거가 약한 카테고리는 적게, 관행이 없으면 0개).
실무경험(experience)의 근거는 공고 집계의 '경험' 항목을 우선한다.
${Object.entries(CATS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
    const { data, usage: u } = await llm.json({ model: MODEL, system: SYSTEM, prompt, schema: SCHEMA, temperature: 0.4 });
    usage.input += u.input; usage.output += u.output;
    out.push({ jobCode: r.jobCode, title: j.title, posts: r.posts, model: MODEL, examples: data });
    console.log(`${j.title}: ${Object.entries(data).map(([k, v]) => `${k} ${v.length}`).join(' · ')}`);
  }
  fs.writeFileSync(path.resolve(arg('out', 'temp/project-examples-pilot.json')), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ model: MODEL, jobs: out.length, ...usage, perJob: { input: Math.round(usage.input / (out.length || 1)), output: Math.round(usage.output / (out.length || 1)) } }));
})().catch((e) => { console.error(e); process.exit(1); });
