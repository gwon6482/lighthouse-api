// 채용공고 → 인재상 항목 추출 — 진로설계 '예시 DB' 2단계.
//   node --env-file=.env scripts/recruit-extract.js --in temp/recruit-pilot.jsonl --out temp/recruit-extract.jsonl --model gemini-flash-latest
//
// 공고 1건 → { relevant, qualifications[{name,type}], majors[], knowledge[], skills[], experiences[], duties[] }
//   - 공고에 **적힌 것만** 뽑는다(지어내지 않기). 운전면허·차량소지·고용장려금 같은 행정 조건은 뺀다
//   - 일자리박람회 안내문 등 직무와 무관한 글이 섞여 있어 relevant 로 표시한다
// 여러 건을 한 번에 보낸다(BATCH). 이미 뽑은 공고는 건너뛴다(같은 --out 으로 이어 하기).
// 끝에 토큰 사용량 합계를 낸다 — 건당 비용 계산용.
const fs = require('fs');
const path = require('path');
const { pickProvider } = require('./lib/llm');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BATCH = Number(arg('batch', 8));
const MODEL = arg('model', 'gemini-flash-latest');
const MAX_CHARS = 2500; // 공고 본문이 아주 긴 경우(박람회 안내 등) 앞부분만

const SYSTEM = `너는 한국 채용공고에서 '이 직무에 필요한 인재 요건'을 뽑는 분석가다.
규칙:
- 공고에 실제로 적힌 내용만 뽑는다. 추측해서 덧붙이지 않는다. 없으면 빈 배열.
- 짧은 명사구로 쓴다(예: "정보처리기사", "Python", "환자 활력징후 측정", "전표 입력").
- qualifications: 자격증·면허만. type 은 필수면 "required", 우대면 "preferred".
  자동차운전면허·차량소지·고용촉진장려금 대상·보훈 등 직무 역량과 무관한 행정 조건은 넣지 않는다.
- knowledge: 알아야 하는 분야 지식(이론·법규·개념). 예: "부가가치세법", "간호과정", "마케팅 이론"
- skills: 할 줄 알아야 하는 기술·도구·소프트웨어. 예: "Java", "엑셀", "더존 회계프로그램", "정맥주사"
- experiences: 경험·성과로 증명할 것(포트폴리오가 될 만한 것). 예: "웹 서비스 개발 프로젝트 경험", "SNS 채널 운영 경험", "요양시설 근무 경험"
- duties: 담당 업무를 짧은 구절로(최대 6개).
- majors: 우대·요구 전공.
- relevant: 직무 채용공고면 true. 박람회·행사 안내만 있고 이 직무 요건이 없으면 false.`;

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    relevant: { type: 'boolean' },
    qualifications: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['required', 'preferred'] } }, required: ['name', 'type'] } },
    majors: { type: 'array', items: { type: 'string' } },
    knowledge: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    experiences: { type: 'array', items: { type: 'string' } },
    duties: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'relevant', 'qualifications', 'majors', 'knowledge', 'skills', 'experiences', 'duties'],
};
const SCHEMA = { type: 'object', properties: { items: { type: 'array', items: ITEM_SCHEMA } }, required: ['items'] };

function toPromptItem(r) {
  const extra = [
    r.certificate && `자격면허: ${r.certificate}`,
    r.major && `전공: ${r.major}`,
    r.pfCond && `우대조건: ${r.pfCond}`,
    r.etcPfCond && `기타우대: ${r.etcPfCond}`,
    r.compAbl && `컴퓨터활용: ${r.compAbl}`,
    r.forLang && `외국어: ${r.forLang}`,
  ].filter(Boolean).join('\n');
  return `### id=${r.wantedAuthNo}\n직종: ${(r.jobTitles ?? [r.jobTitle]).join('·')}\n제목: ${r.title}\n모집직종: ${r.jobsNm}\n학력: ${r.education} / 경력: ${r.career}\n[본문]\n${r.jobCont.slice(0, MAX_CHARS)}\n${extra}`;
}

(async () => {
  const input = path.resolve(arg('in', 'temp/recruit-pilot.jsonl'));
  const out = path.resolve(arg('out', 'temp/recruit-extract.jsonl'));
  const limit = Number(arg('limit', 0));
  const llm = pickProvider(arg('provider', 'gemini'));

  const rows = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).wantedAuthNo) : []);
  let todo = rows.filter((r) => !done.has(r.wantedAuthNo));
  if (limit) todo = todo.slice(0, limit);

  const usage = { input: 0, output: 0, calls: 0, posts: 0, failed: 0 };
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    try {
      const { data, usage: u } = await llm.json({
        model: MODEL, system: SYSTEM, schema: SCHEMA,
        prompt: `아래 채용공고 ${chunk.length}건을 각각 분석해 items 배열로 답하라(id 를 그대로 돌려줄 것).\n\n${chunk.map(toPromptItem).join('\n\n')}`,
      });
      usage.input += u.input; usage.output += u.output; usage.calls++;
      const byId = new Map((data.items ?? []).map((x) => [String(x.id), x]));
      for (const r of chunk) {
        const x = byId.get(String(r.wantedAuthNo));
        if (!x) { usage.failed++; continue; }
        fs.appendFileSync(out, JSON.stringify({
          wantedAuthNo: r.wantedAuthNo, occupation: r.occupation, jobCodes: r.jobCodes ?? [r.jobCode], model: MODEL, ...x, id: undefined,
        }) + '\n');
        usage.posts++;
      }
    } catch (e) {
      usage.failed += chunk.length;
      console.log(`실패(${chunk.length}건): ${e.message}`);
    }
    if ((i / BATCH) % 10 === 0) console.log(`${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(JSON.stringify({ model: MODEL, ...usage, secs, perPost: { input: Math.round(usage.input / (usage.posts || 1)), output: Math.round(usage.output / (usage.posts || 1)) } }));
})().catch((e) => { console.error(e); process.exit(1); });
