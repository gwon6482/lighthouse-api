// 고용24 원문(work24_raw) → 우리 job_info 형태로 변환.
//
// **API 를 단일 기준으로 삼는다.** 우리에만 있던 값은 재분류·정리된 것으로 보고 남기지 않는다.
// (예외는 매핑이 없는 직업뿐 — 그건 애초에 이 변환을 타지 않는다)
const { asArray } = require('./client');

// details 한 칸을 만드는 명세.
// ⚠️ `Cmpr` 접미가 **직업내(1~6 리커트)**, 없는 쪽이 **직업간(1~100 백분위)** 이다.
//    우리 details 구조 `<영역>.<중요도|수준>.<직업내|직업간>` 과 그대로 대응한다.
const DETAIL_SPEC = [
  // [우리 영역, 우리 중요도/수준, 우리 직업내/직업간, 원문 섹션키, 배열태그, 값태그, 이름태그, resolver 섹션]
  ['업무수행능력', '중요도', '직업내', 'ability', 'jobAbilCmpr',    'jobAblStatusCmpr',          'jobAblNmCmpr',          'jobAbil'],
  ['업무수행능력', '중요도', '직업간', 'ability', 'jobAbil',        'jobAblStatus',              'jobAblNm',              'jobAbil'],
  ['업무수행능력', '수준',   '직업내', 'ability', 'jobAbilLvlCmpr', 'jobAblLvlStatusCmpr',       'jobAblLvlNmCmpr',       'jobAbil'],
  ['업무수행능력', '수준',   '직업간', 'ability', 'jobAbilLvl',     'jobAblLvlStatus',           'jobAblLvlNm',           'jobAbil'],
  ['지식',       '중요도', '직업내', 'ability', 'KnwldgCmpr',     'knwldgStatusCmpr',          'knwldgNmCmpr',          'Knwldg'],
  ['지식',       '중요도', '직업간', 'ability', 'Knwldg',         'knwldgStatus',              'knwldgNm',              'Knwldg'],
  ['지식',       '수준',   '직업내', 'ability', 'KnwldgLvlCmpr',  'knwldgLvlStatusCmpr',       'knwldgLvlNmCmpr',       'Knwldg'],
  ['지식',       '수준',   '직업간', 'ability', 'KnwldgLvl',      'knwldgLvlStatus',           'knwldgLvlNm',           'Knwldg'],
  ['업무환경',    '중요도', '직업내', 'ability', 'jobsEnvCmpr',    'jobEnvStatusCmpr',          'jobEnvNmCmpr',          'jobsEnv'],
  ['업무환경',    '중요도', '직업간', 'ability', 'jobsEnv',        'jobEnvStatus',              'jobEnvNm',              'jobsEnv'],
  ['성격',       '중요도', '직업내', 'character', 'jobChrCmpr',   'jobChrStatusCmpr',          'jobChrNmCmpr',          'jobChr'],
  ['성격',       '중요도', '직업간', 'character', 'jobChr',       'jobChrStatus',              'jobChrNm',              'jobChr'],
  ['흥미',       '중요도', '직업내', 'character', 'jobIntrstCmpr','intrstStatusCmpr',          'intrstNmCmpr',          'jobIntrst'],
  ['흥미',       '중요도', '직업간', 'character', 'jobIntrst',    'intrstStatus',              'intrstNm',              'jobIntrst'],
  ['가치관',      '중요도', '직업내', 'character', 'jobValsCmpr',  'valsStatusCmpr',            'valsNmCmpr',            'jobVals'],
  ['가치관',      '중요도', '직업간', 'character', 'jobVals',      'valsStatus',                'valsNm',                'jobVals'],
  ['업무활동',    '중요도', '직업내', 'activity', 'jobActvImprtncCmpr','jobActvImprtncStatusCmpr','jobActvImprtncNmCmpr','jobActvImprtnc'],
  ['업무활동',    '중요도', '직업간', 'activity', 'jobActvImprtnc',    'jobActvImprtncStatus',    'jobActvImprtncNm',    'jobActvImprtnc'],
  ['업무활동',    '수준',   '직업내', 'activity', 'jobActvLvlCmpr',    'jobActvLvlStatusCmpr',    'jobActvLvlNmCmpr',    'jobActvLvl'],
  ['업무활동',    '수준',   '직업간', 'activity', 'jobActvLvl',        'jobActvLvlStatus',        'jobActvLvlNm',        'jobActvLvl'],
];

/**
 * 임금 문자열 파싱.
 * 원문: "조사년도:2025년, 임금 하위(25%) 8640만원, 평균(50%) 9300만원, 상위(25%) 10250만원"
 * ⚠️ 형식이 바뀌면 조용히 null 이 된다. 호출부가 null 비율을 감시해야 한다.
 */
function parseSalary(sal) {
  const s = String(sal ?? '');
  const year = s.match(/조사년도\s*:\s*(\d{4})/)?.[1];
  const lower = s.match(/하위\(\d+%\)\s*(\d+)\s*만원/)?.[1];
  const median = s.match(/평균\(\d+%\)\s*(\d+)\s*만원/)?.[1];
  const upper = s.match(/상위\(\d+%\)\s*(\d+)\s*만원/)?.[1];
  return {
    lower: lower ? Number(lower) : null,
    median: median ? Number(median) : null,
    upper: upper ? Number(upper) : null,
    surveyYear: year ? Number(year) : null,
  };
}

// "- a\n- b" → ['a','b'].  선행 '-' 와 빈 줄을 털어낸다.
function parseDuties(execJob) {
  return String(execJob ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-·•]\s*/, '').trim())
    .filter(Boolean);
}

const EDU_LABELS = {
  edubgMgraduUndr: '중졸 이하', edubgHgradu: '고졸', edubgCgraduUndr: '전문대졸',
  edubgUgradu: '대졸', edubgGgradu: '석사', edubgDgradu: '박사',
};
const DPT_LABELS = {
  cultLangDpt: '인문계열', socDpt: '사회계열', eduDpt: '교육계열', engnrDpt: '공학계열',
  natrlDpt: '자연계열', mediDpt: '의약계열', artphyDpt: '예체능계열',
};
// {키: "47"} → [{key, label, ratio}] (0 은 버린다 — 화면에 0% 막대를 그릴 이유가 없다)
function parseRatioMap(obj, labels) {
  return Object.entries(labels)
    .map(([k, label]) => ({ key: k, label, ratio: Number(obj?.[k] ?? 0) }))
    .filter((x) => x.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio);
}

/**
 * @param {object} rawDoc  work24_raw 문서
 * @param {object} resolver attrResolver.buildResolver() 결과
 * @returns {{ patch: object, unresolved: string[] }}
 */
function transform(rawDoc, resolver) {
  const d = rawDoc.detail;
  const s = d.summary, du = d.duties, e = d.education, p = d.prospect;
  const unresolved = [];

  const details = {};
  for (const [area, imp, scope, secKey, arrTag, valTag, nmTag, resolveSec] of DETAIL_SPEC) {
    const items = asArray(d[secKey]?.[arrTag]);
    const out = [];
    for (const el of items) {
      const name = el?.[nmTag];
      const score = Number(el?.[valTag]);
      if (!name || Number.isNaN(score)) continue;
      const code = resolver.resolve(resolveSec, name);
      if (!code) { unresolved.push(`${resolveSec}:${name}`); continue; }
      out.push({ code, score });
    }
    if (out.length) {
      details[area] = details[area] || {};
      details[area][imp] = details[area][imp] || {};
      // ⚠️ 정렬해 둔다. 화면이 상위 N 개만 보여줄 때 매번 정렬하지 않아도 되게.
      details[area][imp][scope] = out.sort((a, b) => b.score - a.score);
    }
  }

  const salary = parseSalary(s.sal);

  return {
    unresolved,
    patch: {
      overview: String(du.jobSum ?? s.jobSum ?? '').trim() || null,
      duties: parseDuties(du.execJob),
      details,
      salary: { lower: salary.lower, median: salary.median, upper: salary.upper },
      jobSatisfaction: s.jobSatis != null && s.jobSatis !== '' ? Number(s.jobSatis) : null,
      // API 를 단일 기준으로 삼으므로 없으면 빈 배열이다(우리 옛 값을 남기지 않는다).
      relatedCertifications: asArray(s.relCertList).map((x) => String(x.certNm ?? '').trim()).filter(Boolean),
      relatedMajors: asArray(s.relMajorList).map((x) => ({
        code: String(x.majorCd ?? '').trim() || null,
        name: String(x.majorNm ?? '').trim(),
      })).filter((x) => x.name),

      work24: {
        jobCd: rawDoc.jobCd,
        jobNm: rawDoc.meta?.jobNm ?? s.jobSmclNm ?? null,
        classification: { large: s.jobLrclNm ?? null, middle: s.jobMdclNm ?? null, small: s.jobSmclNm ?? null },
        keco: e.kecoList ? { code: e.kecoList.kecoCd ?? null, name: e.kecoList.kecoNm ?? null } : null,
        way: String(s.way ?? e.technKnow ?? '').trim() || null,
        education: parseRatioMap(e.edubg, EDU_LABELS),
        schoolDepartments: parseRatioMap(e.schDpt, DPT_LABELS),
        prospect: {
          text: String(p.jobProspect ?? '').trim() || null,
          distribution: asArray(p.jobSumProspect).map((x) => ({
            name: String(x.jobProspectNm ?? '').trim(),
            ratio: Number(x.jobProspectRatio ?? 0),
            year: x.jobProspectInqYr ? Number(x.jobProspectInqYr) : null,
          })).filter((x) => x.name),
        },
        jobStatus: String(p.jobStatus ?? s.jobStatus ?? '').trim() || null,
        relatedJobs: asArray(du.relJobList).map((x) => ({
          jobCd: String(x.jobCd ?? '').trim() || null,
          jobNm: String(x.jobNm ?? '').trim(),
        })).filter((x) => x.jobNm),
        salarySurveyYear: salary.surveyYear,
        collectedAt: rawDoc.collectedAt ?? null,
      },
    },
  };
}

module.exports = { transform, parseSalary, parseDuties, parseRatioMap, DETAIL_SPEC };
