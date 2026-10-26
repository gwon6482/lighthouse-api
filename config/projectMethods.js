// 프로젝트 영역 × 진행 방식 — 서버 쪽 단일 정본(2026-10-26)
//
// ⚠️ 동기화(사용자 원칙): 직업인 조사(랜딩 /career-path)와 실제 서비스(앱 진로설계)는 항상 같은 분류를 쓴다.
//    함께 고칠 곳: 앱 lighthouse-test `composables/projectMethods.ts` · 랜딩 `composables/useCareerPath.ts`(KINDS·PREP_METHODS)
//    · 어드민 `dashboard/career-path` 라벨. 여기 하나만 바꾸면 조용히 갈라진다.
const CATEGORIES = ['qualification', 'knowledge', 'skill', 'portfolio', 'experience'];

// 앱 진행 방식(ProjectMethod)
const PROJECT_METHODS = [
  'book', 'lecture', 'academy', 'study_group',
  'required_course', 'school', 'practice',
  'personal_project', 'team_project', 'contest', 'content',
  'internship', 'field_practice', 'parttime', 'club', 'activity',
  'etc',
];

// 영역별로 고를 수 있는 방식(앱 METHODS_BY_CATEGORY 와 같게)
const METHODS_BY_CATEGORY = {
  qualification: ['book', 'lecture', 'academy', 'required_course', 'etc'],
  knowledge: ['book', 'lecture', 'school', 'academy', 'study_group', 'etc'],
  skill: ['lecture', 'book', 'academy', 'practice', 'study_group', 'etc'],
  portfolio: ['personal_project', 'team_project', 'contest', 'content', 'etc'],
  experience: ['internship', 'field_practice', 'parttime', 'club', 'activity', 'etc'],
};

// 직업인 조사의 '해 온 것' 종류 = 앱 방식 + 대상 2종(자격증·어학). 대상은 어떻게 준비했는지(prep)가 방식이 된다
const TARGET_KINDS = ['qualification', 'language'];
const CONTRIBUTION_KINDS = [...TARGET_KINDS, ...PROJECT_METHODS];
const PREP_METHODS = METHODS_BY_CATEGORY.qualification;   // 자격요건의 방식과 같은 목록

/** 조사 항목 → 앱 진행 방식. 대상 종류는 prep, 그 밖은 종류 자체. 맞지 않으면 null */
function methodOfKind(kind, prep) {
  if (TARGET_KINDS.includes(kind)) return PREP_METHODS.includes(prep) ? prep : null;
  return PROJECT_METHODS.includes(kind) ? kind : null;
}

module.exports = { CATEGORIES, PROJECT_METHODS, METHODS_BY_CATEGORY, TARGET_KINDS, CONTRIBUTION_KINDS, PREP_METHODS, methodOfKind };
