// 고용24 API 의 **속성 이름** → 우리 `reference_data.career_attributes` **코드** 변환.
//
// ⚠️ API 는 코드를 주지 않는다. `jobAblNm: "인적자원 관리"` 처럼 이름만 온다.
//    우리 job_info.details 는 `{ code: 'AB30', score: 100 }` 형식이라(2026-04-22 정규화)
//    이름을 코드로 바꿔야 매칭·화면이 그대로 돈다.
//
// 2026-09-26 실측: 가치관을 뺀 **191/191** 이 정규화 후 정확히 붙는다.
//   ability 44/44 · knowledge 33/33 · work_environment 49/49
//   personality 16/16 · interest 6/6 · work_activity 41/41
//
// ⚠️ 가치관만 다르다. 고용24가 체계를 13→9 로 개편해서 9개만 대응된다
//    (T23 설문도 2026-09-26 에 9문항으로 맞췄다).

// 가치관 별칭 — 고용24가 문구를 바꾼 것들.
//
// ⚠️ 2026-09-26 에 가치관 체계가 **13개 → 9개**로 개편되면서 이름이 바뀌었다.
//    이름만 보면 공통이 '성취·경제적 보상' 2개뿐이지만, **정의문을 대조하면 9개가 모두**
//    우리 VA 코드에 대응된다. 그 대조 결과를 여기 고정한다.
//    (근거: 공유 docs `reference/work24-open-api.md` 의 가치관 대조표)
//
// 예) API '사회적 공헌' = "다른 사람이나 사회에 도움이 되는 것"
//     우리 VA10 이타     = "남을 위해 봉사할 수 있다"
const VALUE_ALIASES = {
  '사회적 공헌':    '이타',        // VA10
  '사회적 인정':    '인정',        // VA09
  '직업안정':      '고용안정',     // VA11
  '변화지향':      '다양성',       // VA03
  '자율성':       '자율',        // VA07
  '자기개발':      '지적 추구',    // VA04 — API 쪽이 '기술·능력 발전'까지 포함해 더 넓다
  '일과 삶의 균형': '심신의 안녕',  // VA12 — ⚠️ 근사다. 우리 건 '여유(상태)', 저쪽은 '균형(배분)'
};
// ⚠️ 우리 13개 중 **개인지향·영향력·애국·신체활동 4개는 새 체계에 대응이 없다.**
//    그 개념들은 업무환경(WE)·성격(PS)에서 이미 측정된다(예: 신체활동 → WE02 앉아서 근무,
//    WE38 서서 근무 등 9개 항목). T23 설문에서도 해당 4문항을 제거했다.

// API 섹션 → 우리 category
const CATEGORY_BY_SECTION = {
  jobAbil: 'ability',
  Knwldg: 'knowledge',
  jobsEnv: 'work_environment',
  jobChr: 'personality',
  jobIntrst: 'interest',
  jobVals: 'value',
  jobActvImprtnc: 'work_activity',
  jobActvLvl: 'work_activity',
};

/**
 * 이름 정규화.
 * ⚠️ 괄호 안을 지우는 것이 핵심이다. API 는 `현실형(Realistic)` 처럼 영문을 병기하는데
 *    우리는 `현실형` 이다. 이걸 안 지우면 흥미 6개가 **0개** 매칭된다(실제로 그랬다).
 * ⚠️ 마침표도 지운다. API `고장의 발견.수리` ↔ 우리 `고장의 발견·수리`.
 */
function normalizeName(s) {
  return String(s ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s·・.,/\-]/g, '')
    .toLowerCase();
}

/**
 * career_attributes 문서 배열로 이름→코드 조회기를 만든다.
 * @param {Array<{category:string, code:string, name:string}>} attrs
 */
function buildResolver(attrs) {
  const byCat = new Map();
  for (const a of attrs) {
    if (!byCat.has(a.category)) byCat.set(a.category, new Map());
    byCat.get(a.category).set(normalizeName(a.name), a.code);
  }

  /** 못 찾으면 null 을 돌려준다. 호출부가 집계해 보고해야 한다 — 조용히 버리면 안 된다. */
  function resolve(section, name) {
    const category = CATEGORY_BY_SECTION[section];
    if (!category) return null;
    const table = byCat.get(category);
    if (!table) return null;
    const direct = table.get(normalizeName(name));
    if (direct) return direct;
    // 가치관은 개편으로 문구가 바뀌어 별칭이 필요하다.
    if (category === 'value') {
      const alias = VALUE_ALIASES[String(name).trim()];
      if (alias) return table.get(normalizeName(alias)) ?? null;
    }
    return null;
  }

  function categoryOf(section) {
    return CATEGORY_BY_SECTION[section] ?? null;
  }

  function sizeOf(category) {
    return byCat.get(category)?.size ?? 0;
  }

  return { resolve, categoryOf, sizeOf, normalizeName };
}

module.exports = { buildResolver, normalizeName, CATEGORY_BY_SECTION };
