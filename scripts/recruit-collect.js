// 채용공고 원문 수집 — 진로설계 '예시 DB'(인재상)의 1단계. 고용24 채용정보 목록(210L01) + 상세(210D01).
//   node --env-file=.env scripts/recruit-collect.js --all --per 100 --out temp/recruit-postings.jsonl
//   node --env-file=.env scripts/recruit-collect.js --jobs 133201,304004 --per 100 --out temp/recruit-pilot.jsonl
//
// 왜 상세까지 받나: 인재상의 본체는 상세의 jobCont(담당업무·자격·우대 자유서술)다. 목록에는 없다.
//   정리된 칸(certificate·major·pfCond…)은 절반 이하만 채워져 있고 '자동차운전면허' 같은 잡음이 섞인다(2026-10-19 표본).
// 직업 연결: job_info.work24.keco.code + '00' = 채용 직종(채용 탭과 같은 규칙 — jobCode 를 그대로 넣지 말 것).
//   **직종 단위로 한 번만 받는다** — 537 직업이 395 직종을 쓰고, 73 직종은 여러 직업이 공유한다(2026-10-19).
//   레코드의 jobCodes 에 그 직종을 쓰는 직업들을 모두 적는다.
// 호출 한도는 문서에 없다 → 간격(DELAY_MS)을 두고 부른다. 실패한 건은 건너뛰고 직종별로 개수를 보고한다.
// 출력: JSON Lines(한 줄 = 공고 1건). 이어 받기: 같은 --out 이면 이미 받은 (직종, 공고번호)는 건너뛴다
//   — 중간에 끊겨도 같은 명령으로 다시 돌리면 이어진다.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { XMLParser } = require('fast-xml-parser');

const LIST_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do';
const DETAIL_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210D01.do';
const DELAY_MS = 250;
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
// 상세 본문의 &#xd; · 연속 공백 정리(줄바꿈은 살린다 — 추출 단계가 항목 구분에 쓴다)
const clean = (s) => String(s ?? '').replace(/&#xd;|\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function getXml(url) {
  const xml = await (await fetch(url)).text();
  const err = (xml.match(/<error>([^<]*)<\/error>/) || [])[1];
  if (err) throw new Error(`고용24: ${err}`);
  return parser.parse(xml);
}

(async () => {
  const jobCodes = String(arg('jobs', '')).split(',').filter(Boolean);
  const per = Math.min(1000, Number(arg('per', 100)));
  const out = path.resolve(arg('out', 'temp/recruit-postings.jsonl'));
  if (!jobCodes.length && !flag('all')) throw new Error('--all 또는 --jobs 133201,304004 를 주세요');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const seen = new Set(fs.existsSync(out)
    ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.occupation}:${r.wantedAuthNo}` })
    : []);

  await mongoose.connect(process.env.MONGODB_URI);
  const filter = flag('all') ? {} : { jobCode: { $in: jobCodes } };
  const jobs = await mongoose.connection.useDb(process.env.JOB_DATA_DB || 'job_data').collection('job_info')
    .find(filter, { projection: { jobCode: 1, title: 1, 'work24.keco': 1 } }).toArray();
  await mongoose.disconnect();

  // 직종 → 그 직종을 쓰는 직업들
  const occs = new Map();
  for (const j of jobs) {
    const k = j.work24?.keco?.code;
    if (!/^\d{4}$/.test(String(k ?? ''))) { console.log(JSON.stringify({ jobCode: j.jobCode, title: j.title, skipped: 'keco 없음' })); continue; }
    const o = `${k}00`;
    if (!occs.has(o)) occs.set(o, { occupation: o, jobs: [] });
    occs.get(o).jobs.push({ jobCode: j.jobCode, title: j.title });
  }

  const key = process.env.WORK24_KEY_RECRUIT;
  const started = Date.now();
  let n = 0;
  for (const { occupation, jobs: occJobs } of occs.values()) {
    n++;
    const ids = [];
    let total = 0;
    try {
      for (let page = 1; ids.length < per; page++) {
        const qs = new URLSearchParams({ authKey: key, callTp: 'L', returnType: 'XML', startPage: String(page), display: '100', occupation, sortOrderBy: 'DESC' });
        const root = (await getXml(`${LIST_URL}?${qs}`))?.wantedRoot ?? {};
        total = Number(root.total ?? 0);
        const w = root.wanted == null ? [] : [].concat(root.wanted);
        ids.push(...w.map((x) => x.wantedAuthNo));
        if (w.length < 100) break;
        await sleep(DELAY_MS);
      }
    } catch (e) {
      console.log(JSON.stringify({ occupation, listError: e.message }));
      continue;
    }
    let ok = 0, fail = 0, skip = 0;
    for (const id of ids.slice(0, per)) {
      if (seen.has(`${occupation}:${id}`)) { skip++; continue; }
      try {
        const qs = new URLSearchParams({ authKey: key, callTp: 'D', returnType: 'XML', wantedAuthNo: id, infoSvc: 'VALIDATION' });
        const d = (await getXml(`${DETAIL_URL}?${qs}`))?.wantedDtl;
        const w = d?.wantedInfo;
        if (!w) throw new Error('상세 없음');
        const rec = {
          wantedAuthNo: id, source: 'work24', occupation,
          jobCodes: occJobs.map((j) => j.jobCode), jobTitles: occJobs.map((j) => j.title),
          company: d.corpInfo?.corpNm ?? '', companySize: d.corpInfo?.busiSize ?? '', industry: d.corpInfo?.indTpCdNm ?? '',
          title: w.wantedTitle ?? '', jobsNm: w.jobsNm ?? '', relJobsNm: w.relJobsNm ?? '',
          jobCont: clean(w.jobCont),
          certificate: clean(w.certificate), major: clean(w.major), pfCond: clean(w.pfCond), etcPfCond: clean(w.etcPfCond),
          compAbl: clean(w.compAbl), forLang: clean(w.forLang),
          education: w.eduNm ?? '', career: w.enterTpNm ?? '', empType: w.empTpNm ?? '',
          selMthd: clean(w.selMthd), submitDoc: clean(w.submitDoc),
          collectedAt: new Date().toISOString(),
        };
        fs.appendFileSync(out, JSON.stringify(rec) + '\n');
        seen.add(`${occupation}:${id}`);
        ok++;
      } catch (e) {
        fail++;
      }
      await sleep(DELAY_MS);
    }
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(JSON.stringify({ n: `${n}/${occs.size}`, occupation, jobs: occJobs.map((j) => j.title).join('·'), total, ok, fail, skip, mins }));
  }
  console.log(`완료 → ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
