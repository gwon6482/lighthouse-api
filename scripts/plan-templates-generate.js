// 직업별 '단계 템플릿' 생성 — 비전공 > 전공 > 이직 (진로설계 '템플릿에서 수정하기' 더미/시범 데이터)
//   node --env-file=.env scripts/plan-templates-generate.js --req temp/job-requirements-pilot.json --out temp/plan-templates-pilot.json --model gemini-3.7-flash
//
// 사용자 원칙(2026-10-22):
//   - 단계는 비전공 > 전공 > 이직. 기존 전문성이 낮을수록 준비가 길어야 한다
//   - **비전공 단계를 가장 빈틈없이** 설계하고, 그 뒤 단계는 대학(전공)·실무(경력)에서 배우는 것을 **빼서** 만든다
// 그래서 LLM 은 비전공 플랜 하나만 설계하고, 프로젝트마다 '전공자도 필요한가 / 관련 경력자도 필요한가'와 빠지는 이유를 단다.
// 전공·이직 플랜은 앱에서 그 표시로 걸러 만든다(같은 프로젝트 = 같은 이름·커리큘럼이라 단계 간 비교가 된다).
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { pickProvider } = require('./lib/llm');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('model', 'gemini-3.7-flash');

const SYSTEM = `너는 진로 준비 코치다. 한 직업을 목표로 하는 '비전공자'(관련 학과도, 관련 경력도 없는 사람)를 위해
취업 가능한 수준까지 가는 진로계획을 **빈틈없이** 설계한다. 이 계획은 나중에 전공자·관련 경력자용으로 일부를 빼서 쓴다.

규칙:
- 반드시 주어진 근거(채용공고 집계·직업정보) 안에서 설계한다. 근거에 없는 자격증·도구는 쓰지 않는다. 특정 학원·유료 강의·책 이름을 지어내지 않는다.
- 프로젝트 10~14개. 순서는 실제로 해 나갈 순서(기초 지식 → 기술 → 자격 → 결과물). order 는 1부터.
- category: qualification(자격증·면허 준비) / knowledge(이론·법규·개념 공부) / skill(도구·기술 연습) / portfolio(결과물로 남는 경험·프로젝트)
- 각 프로젝트: name(짧고 구체적), goal(끝나면 남는 것 한 문장), level("입문"|"중급"|"심화"),
  curriculum(주마다 title + items 3개, 각 15자 안팎). 기간은 현실적으로: 국가자격 시험 준비 8~16주, 지식 3~8주, 기술 3~8주, 포트폴리오 4~10주.
  daysPerWeek(1~6), minutesPerSession(30~180), basis(근거 한 줄, 공고 비율이 있으면 숫자로).
- neededForMajor: 이 직업 관련 학과를 졸업한 사람에게도 따로 필요한가? 대학 전공 수업에서 배우는 기초 이론·기본 실습이면 false.
  면허·자격시험 준비, 현장 도구, 실무형 포트폴리오처럼 대학이 대신해 주지 않는 것은 true.
- neededForCareer: 이 직업과 관련된 실무 경력(유사 직무 1년 이상)이 있는 사람에게도 따로 필요한가?
  일하면서 이미 익혔을 업무 도구·기본 실무·업무 문서 작성 등은 false. 법정 면허·자격, 경력만으로 증명되지 않는 결과물은 true.
  neededForMajor 가 false 인 것 중에도 경력자에게 필요한 게 있을 수 있다(예: 실무에서 안 다루는 이론 시험 과목)
- skipReason: neededForMajor 나 neededForCareer 가 false 면 왜 빼도 되는지 한 문장(예: "간호학과 기본간호학 실습에서 배운다"). 둘 다 true 면 빈 문자열.
- 비전공자 기준으로 빠진 기초가 없게: 전공자가 대학에서 배우는 기초 과목 중 이 직업에 꼭 필요한 것은 비전공 플랜에 반드시 넣는다.`;

const PROJECT = {
  type: 'object',
  properties: {
    order: { type: 'integer' },
    category: { type: 'string', enum: ['qualification', 'knowledge', 'skill', 'portfolio'] },
    name: { type: 'string' }, goal: { type: 'string' }, level: { type: 'string', enum: ['입문', '중급', '심화'] },
    daysPerWeek: { type: 'integer' }, minutesPerSession: { type: 'integer' }, basis: { type: 'string' },
    neededForMajor: { type: 'boolean' }, neededForCareer: { type: 'boolean' }, skipReason: { type: 'string' },
    curriculum: { type: 'array', items: { type: 'object', properties: { week: { type: 'integer' }, title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['week', 'title', 'items'] } },
  },
  required: ['order', 'category', 'name', 'goal', 'level', 'daysPerWeek', 'minutesPerSession', 'basis', 'neededForMajor', 'neededForCareer', 'skipReason', 'curriculum'],
};
const SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, projects: { type: 'array', items: PROJECT } },
  required: ['summary', 'projects'],
};

const fmt = (arr, n = 12) => (arr ?? []).slice(0, n).map((x) => `${x.name} ${Math.round(x.share * 100)}%`).join(', ') || '(없음)';

(async () => {
  const reqs = JSON.parse(fs.readFileSync(path.resolve(arg('req', 'temp/job-requirements-pilot.json')), 'utf8'));
  const only = String(arg('jobs', '')).split(',').filter(Boolean);
  const llm = pickProvider(arg('provider', 'gemini'));
  await mongoose.connect(process.env.MONGODB_URI);
  const info = new Map((await mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data').collection('job_info')
    .find({ jobCode: { $in: reqs.map((r) => r.jobCode) } }, { projection: { jobCode: 1, title: 1, overview: 1, relatedCertifications: 1, relatedMajors: 1, 'work24.way': 1, 'details.지식.중요도': 1 } })
    .toArray()).map((j) => [j.jobCode, j]));
  const knName = new Map((await mongoose.connection.useDb(process.env.REFERENCE_DATA_DB || 'reference_data').collection('career_attributes')
    .find({ category: 'knowledge' }, { projection: { code: 1, name: 1 } }).toArray()).map((a) => [a.code, a.name]));
  await mongoose.disconnect();

  const out = [];
  const usage = { input: 0, output: 0 };
  for (const r of reqs) {
    if (only.length && !only.includes(r.jobCode)) continue;
    const j = info.get(r.jobCode);
    if (!j) continue;
    const knowledgeTop = (j.details?.지식?.중요도?.직업내 ?? []).slice(0, 8).map((x) => `${knName.get(x.code) ?? x.code}(${x.score})`).join(', ');
    const prompt = `# 목표 직업: ${j.title}
개요: ${j.overview ?? ''}
되는 길(직업정보): ${String(j.work24?.way ?? '').slice(0, 800)}
관련 자격(직업정보): ${(j.relatedCertifications ?? []).join(', ') || '(없음)'}
관련 학과(직업정보): ${(j.relatedMajors ?? []).map((m) => m.name ?? m).join(', ') || '(없음)'}
중요 지식(직업정보, 5점 만점): ${knowledgeTop || '(없음)'}

# 채용공고 집계 (고용24 ${r.posts}건, 비율 = 요구한 공고 비율)
자격증: ${fmt(r.qualifications)}
분야지식: ${fmt(r.knowledge)}
기술·도구: ${fmt(r.skills)}
경험: ${fmt(r.experiences)}
전공: ${fmt(r.majors, 8)}
담당업무: ${fmt(r.duties, 10)}

비전공자용 진로계획을 설계하라. summary 는 이 계획이 어떤 순서로 무엇을 준비하는지 두 문장.`;
    const { data, usage: u } = await llm.json({ model: MODEL, system: SYSTEM, prompt, schema: SCHEMA, temperature: 0.3 });
    usage.input += u.input; usage.output += u.output;
    data.projects.sort((a, b) => a.order - b.order);
    out.push({ jobCode: r.jobCode, title: j.title, posts: r.posts, model: MODEL, ...data });
    const n = data.projects.length;
    const major = data.projects.filter((p) => p.neededForMajor).length;
    const career = data.projects.filter((p) => p.neededForCareer).length;
    const weeks = (f) => data.projects.filter(f).reduce((s, p) => s + p.curriculum.length, 0);
    console.log(`${j.title}: 비전공 ${n}개(${weeks(() => true)}주) · 전공 ${major}개(${weeks((p) => p.neededForMajor)}주) · 이직 ${career}개(${weeks((p) => p.neededForCareer)}주)`);
  }
  fs.writeFileSync(path.resolve(arg('out', 'temp/plan-templates-pilot.json')), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ model: MODEL, jobs: out.length, ...usage }));
})().catch((e) => { console.error(e); process.exit(1); });
