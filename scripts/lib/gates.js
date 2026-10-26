// 직업 진입 관문 → 생성 지시문 (2026-10-27, 사용자: "생성기준에 추가")
// 데이터: data/job-gates/jobGates.draft.json(사용자 검토 완료본). 관문이 없는 직업은 빈 문자열 — 원래 규칙대로 만든다.
const fs = require('fs');
const path = require('path');

let ROWS = null;
function gates() {
  if (!ROWS) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'job-gates', 'jobGates.draft.json'), 'utf8'));
    ROWS = new Map(d.rows.filter((r) => r.badges.length).map((r) => [r.jobCode, r]));
  }
  return ROWS;
}
const gateOf = (jobCode) => gates().get(jobCode);

// 배지마다 계획에서 강조할 것 — 앱 shared/jobGates/gateBadges.ts 의 guide 와 같은 뜻으로 유지
const RULES = {
  senior: '바로 될 수 없는 직업(경력·승진으로 진입)이다. 계획은 **먼저 시작할 직업**에 들어가 경력을 쌓는 경로로 짜고, 그 직업에서 필요한 준비를 중심에 둔다.',
  degree: '관련 학과(또는 대학원) 졸업이 법정 필수다. 비전공 플랜은 **진학 준비**(입시·편입·학사편입·전문대학원 입학시험 등)를 중심에 두고, 학과 과정 이후는 국가시험까지의 큰 단계로만 둔다. 학교에서 배우는 내용을 비전공자가 따로 공부하는 프로젝트로 채우지 않는다.',
  selection: '정원을 뽑는 선발 시험(공채·임용 등)이 관문이다. 시험 과목별 학습·기출 반복·모의고사로 짜고, 포트폴리오·실무경험은 만들지 않는다(법이 요구하는 것 제외). 체력 시험이 있으면 체력 준비를 넣는다.',
  license: '면허·자격 없이는 일할 수 없다. 지정 교육 이수와 자격시험 준비를 계획 맨 앞에 둔다.',
  experience: '응시·진입 전에 정해진 실무 경력이 법정 요건이다. 그 경력을 채우는 실무경험 프로젝트를 반드시 넣고 기간을 요건에 맞춘다.',
};
const ORDER = ['senior', 'degree', 'selection', 'license', 'experience'];
const LABEL = { senior: '경력직', degree: '학위 필수', selection: '선발 시험', license: '면허·자격 필수', experience: '경력 필요' };

/** 프롬프트에 끼울 블록. 관문 없으면 '' */
function gatePromptBlock(jobCode) {
  const g = gateOf(jobCode);
  if (!g) return '';
  const b = [...g.badges].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  return `
# 진입 관문(사람이 검토한 법정 요건 — 직업정보보다 우선)
관문: ${b.map((k) => LABEL[k]).join(' · ')}
되는 길 요약: ${g.note}
규칙:
${b.map((k) => `- ${RULES[k]}`).join('\n')}
- 관문 준비와 상관없는 포트폴리오·경력 쌓기 프로젝트로 개수를 채우지 않는다.`;
}

module.exports = { gateOf, gatePromptBlock };

// 생성 결과 검사 — 영역에 없는 진행 방식은 지운다(앱에선 '방식 미정'으로 보이고 사용자가 고른다)
const { METHODS_BY_CATEGORY } = require('../../config/projectMethods');
function fixMethod(p, category) {
  const c = category ?? p.category;
  if (!(METHODS_BY_CATEGORY[c] ?? []).includes(p.method)) { p.method = null; p.methodDetail = {}; return false; }
  return true;
}
module.exports.fixMethod = fixMethod;
