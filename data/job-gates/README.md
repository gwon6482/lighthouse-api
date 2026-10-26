# 직업 진입 관문 초안 (2026-10-27)

전공·시험·면허 없이는 될 수 없는 직업을 고르는 1층 분류. 정본이 되기 전까지 **초안**이다(사용자 검토 중).

- `1-dump-candidates.js` — job_info 537개 중 고용24 '되는 길'에 관문 단서가 있는 188개 추출(읽기 전용)
- `2-classify.py` — 문장을 읽고 사람이(Claude) 붙인 조건표. 직업마다 badges·conditions·weight·note·status·evidence
- `jobGates.draft.json` — 결과: 관문 111 · 관문 아님 86 · 확인 필요 18

조건: education(none|major|graduate) · training(none|designated|residency) · exam(none|license|selection) · experience · other(fitness·physical·age·eligibility) · entry(direct|senior)
배지 키(아이콘은 사용자가 SVG 로 교체 예정 — 키로만 다룰 것): senior · degree · selection · license · experience. 화면은 최대 2개, 우선순위 위 순서.

⚠️ 고용24 설명이 낡은 곳이 있다(공무원 응시 연령 상한·약대 PEET 등) → status 'check'. 법정 필수만 배지, 사실상 필수는 2층(준비 비중).
