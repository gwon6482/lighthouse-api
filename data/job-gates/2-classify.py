import json, re, sys
SP = sys.argv[1]
cand = {x['title']: x for x in json.load(open(SP + '/gate-candidates.json'))}
extra_codes = json.load(open(SP + '/gate-extra-codes.json'))   # 후보 밖 직업 title → jobCode

# 조건 축약: edu(none|major|graduate) · train(none|designated|residency) · exam(none|license|selection) · exp(bool) · other[] · entry(direct|senior)
def J(badges, edu='none', train='none', exam='none', exp=False, other=(), entry='direct', weight='heavy', note='', status='ok'):
    return dict(badges=list(badges), conditions=dict(education=edu, training=train, exam=exam, experience=exp, other=list(other), entry=entry), weight=weight, note=note, status=status)

MGR = '사원으로 입사해 경력을 쌓고 승진해서 된다(통상 20년 안팎)'
DOC_NOTE = '의대(6년) 또는 의전원 → 의사 국가시험. 전문의는 인턴 1년 + 레지던트 3~4년 + 전문의 시험이 더 필요'
TEACH_NOTE = '교원자격(사범대·교직 이수·교육대학원) 필요. 공립은 임용시험, 사립은 학교별 선발'
G = {}
for t in ['금융관리자','건설·채굴관리자','운송관리자','경영지원관리자','영업·판매관리자','예술·디자인·방송관리자','정보통신관리자','경비·청소관리자','전기·가스·수도관리자','제조·생산관리자','기업고위임원','보험관리자','보건·의료관리자']:
    G[t] = J(['senior'], entry='senior', note=MGR)
for t in ['행정부고위공무원','정부행정관리자']:
    G[t] = J(['senior','selection'], exam='selection', entry='senior', note='공무원 공채(또는 5급 공채) 합격 후 승진')
G['경찰·소방·교도관리자'] = J(['senior','selection'], exam='selection', other=['fitness'], entry='senior', note='경찰·소방·교정직 공채 또는 간부후보생 선발 후 승진')
G['사회복지관리자'] = J(['senior','license'], train='designated', exam='license', entry='senior', note='사회복지사 자격 + 현장 경력 후 관리자')
G['유치원 원장 및 원감'] = J(['senior','license'], edu='major', exam='license', exp=True, entry='senior', note='유치원 정교사 1급 + 교육경력 3년 이상 + 연수')
G['정부·공공행정전문가'] = J(['selection'], exam='selection', note='대부분 공무원 신분 — 5급 공채(행정고시)가 현실적 경로')
for t in ['일반행정공무원','관세행정사무원','병무행정사무원']:
    G[t] = J(['selection'], exam='selection', note='국가·지방 공무원 공채 합격')
G['일반행정공무원']['status'] = 'check'; G['일반행정공무원']['note'] += ' — 고용24 설명에 관문 문장이 없어 제도로 판단'
G['조세행정사무원'] = J(['selection'], exam='selection', note='세무직 공무원 공채. ⚠️ 고용24 설명의 응시 연령 상한(만 28·32세)은 2009년 폐지된 내용', status='check')
G['법원공무원'] = J(['selection'], exam='selection', note='법원직 공무원 공채. ⚠️ 고용24 설명이 법률사무원 설명과 섞여 있음', status='check')
for t, n in [('교도관','교정직 공채 — 필기 후 체력검사'),('경찰관','경찰 공채(순경·간부후보) — 체력·신체검사'),('소방관','소방 공채·간부후보생 — 체력·신체검사'),('해양경찰관','해양경찰 공채 — 체력·신체 기준, 분야별 연령 기준'),('부사관','서류·면접·체력평가·신체검사 선발 후 교육훈련'),('위관급 장교','사관학교·ROTC·학사장교 등 선발 + 체력·신체검사')]:
    G[t] = J(['selection'], exam='selection', other=['fitness','physical'], note=n)
G['변호사'] = J(['degree','license'], edu='graduate', exam='license', note='법학전문대학원(로스쿨, LEET로 입학) 3년 → 변호사시험(졸업 후 5년 내 5회)')
G['검사'] = J(['degree','selection'], edu='graduate', exam='selection', note='로스쿨 → 변호사시험 → 검사 임용 선발')
G['판사'] = J(['senior','degree'], edu='graduate', exp=True, entry='senior', note='변호사 자격 + 법조 경력(2026년부터 10년) 후 임용')
for t, n in [('세무사','세무사시험 → 실무수습 6개월 → 등록'),('노무사','공인노무사시험(정원 선발에 가까움)'),('감정평가사','감정평가사시험 → 실무수습 1년 → 등록'),('관세사','관세사시험'),('변리사','변리사시험 → 실무수습(집합 250시간 + 현장 6개월)'),('손해사정사','손해사정사시험 → 실무수습 6개월 → 등록'),('행정사','행정사 국가자격(일반·해사·외국어번역)'),('법무사 및 집행관','법무사시험(일반 응시 선발 인원 고정)'),('부동산중개인','공인중개사시험 → 실무교육 → 개설 등록')]:
    G[t] = J(['license'], exam='license', note=n)
G['회계사'] = J(['license'], exam='license', note='공인회계사시험(영어 점수 + 1·2차) → 실무수습 → 등록. 회계·경영 관련 학점 이수 요건도 있음', status='check')
G['보험모집인'] = J(['license'], exam='license', weight='light', note='보험설계사 자격시험 → 연수 → 등록')
G['문화재보존원'] = J(['license'], exam='license', note='국가지정문화재 수리는 문화재수리기술자·기능자 자격 필요(그 외 업무는 아님)', status='check')
DOCS = ['내과의사','방사선과의사','소아청소년과의사','외과의사','산부인과의사','정신과의사','안과의사','성형외과의사','이비인후과의사','피부과의사','마취병리과의사','가정의학과의사','비뇨기과의사']
for t in DOCS: G[t] = J(['degree','license'], edu='major', train='residency', exam='license', note=DOC_NOTE)
G['일반의사'] = J(['degree','license'], edu='major', exam='license', note='의대(6년) 또는 의전원 → 의사 국가시험')
G['치과의사'] = J(['degree','license'], edu='major', exam='license', note='치대(또는 치전원) → 치과의사 국가시험. 전문의는 수련 4년 추가')
G['한의사'] = J(['degree','license'], edu='major', exam='license', note='한의대(또는 한의전) → 한의사 국가시험. 전문의는 수련 4년 추가')
G['약사'] = J(['degree','license'], edu='major', exam='license', note='약학대학 → 약사 국가시험. ⚠️ 고용24의 PEET(2+4년제) 설명은 낡음 — 2022학년도부터 6년제 신입학', status='check')
G['수의사'] = J(['degree','license'], edu='major', exam='license', note='수의대(예과 2 + 본과 4) → 수의사 국가시험')
for t, n in [('간호사','간호학과(3·4년제) → 간호사 국가시험'),('치과기공사','치기공학과 → 면허시험'),('보건의료정보관리사','보건의료정보 관련 학과 → 국가시험'),('언어치료사','언어재활 관련 학과 → 언어재활사 국가시험'),('안경사','안경광학과 → 국가시험'),('방사선사','방사선학과 → 국가시험'),('임상병리사','임상병리학과 → 국가시험'),('물리치료사','물리치료학과 → 국가시험'),('한약사','한약학과 → 국가시험'),('재활공학기사','의료보장구 관련 학과 → 의지·보조기기사 국가시험'),('작업치료사','작업치료학과 → 국가시험'),('치과위생사','치위생학과 → 국가시험')]:
    G[t] = J(['degree','license'], edu='major', exam='license', note=n)
G['영양사'] = J(['degree','license'], edu='major', exam='license', note='식품·영양 전공(지정 과목·학점 + 현장실습) → 영양사 국가시험')
G['기록물관리사'] = J(['degree'], edu='graduate', train='designated', note='공공기관은 법으로 기록물관리학 석사(또는 역사·문헌정보 학사 + 지정 교육과정) 요구. 민간은 아님')
for t, n in [('중·고등학교교사', TEACH_NOTE), ('특수교육교사','특수교육 관련 학과·교육대학원 → 특수교사 자격. 공립은 임용시험'), ('보건교사','간호학과 + 교직 이수(간호사 면허·보건교사 자격) → 공립은 임용시험. ⚠️ 고용24 설명은 간호사 설명이 그대로 들어가 있음')]:
    G[t] = J(['degree','selection'], edu='major', exam='selection', note=n, status='check' if t == '보건교사' else 'ok')
G['초등학교교사'] = J(['degree','selection'], edu='major', exam='selection', note='교육대학(또는 초등교육과) → 초등 정교사 자격 → 공립은 임용시험', status='check')
G['유치원교사'] = J(['degree','selection'], edu='major', exam='selection', note='유아교육과 → 유치원 정교사 자격 → 공립은 임용시험, 사립은 기관별', status='check')
G['사회복지사'] = J(['license'], train='designated', exam='license', note='지정 교과목·현장실습 이수로 2급, 1급은 국가시험(학점은행제 가능)')
G['보육교사'] = J(['license'], train='designated', note='보육 관련 지정 교과목(17과목 51학점) 또는 보육교사교육원 이수 → 자격')
G['간호조무사'] = J(['license'], train='designated', exam='license', note='지정 교육기관(학원) 이수 → 국가시험')
G['응급구조사'] = J(['license'], train='designated', exam='license', note='응급구조학과 또는 양성기관 과정 → 국가시험')
G['안마사'] = J(['license'], train='designated', other=['eligibility'], note='시각장애인만 자격 가능(법정) — 지정 기관 2년 교육')
G['사서'] = J(['license','selection'], train='designated', exam='selection', note='문헌정보학과·사서교육원 이수 → 사서 자격. 공공도서관은 사서직 공무원 시험, 공립학교 사서교사는 임용')
G['청소년지도사'] = J(['license'], exam='license', note='청소년지도사 자격시험(급수별 학력·경력 응시 요건)')
for t, n in [('미용사','미용사(일반) 국가기술자격'),('이용사','이용사 자격 + 면허'),('네일아티스트','미용사(네일) 자격'),('피부 및 체형관리사','미용사(피부) 자격')]:
    G[t] = J(['license'], exam='license', weight='light', note=n + ' — 없으면 영업할 수 없음')
for t, n in [('건설 및 채굴기계운전원','기종별 운전기능사 + 건설기계조종사 면허'),('크레인·호이스트운전원','기종별 자격(교육 이수)'),('지게차운전원','지게차운전기능사(3톤 미만은 교육 12시간으로 면허)')]:
    G[t] = J(['license'], exam='license', weight='light', note=n)
G['철도·전동차기관사'] = J(['license'], train='designated', exam='license', other=['physical'], note='지정 교육기관 이수 → 철도차량운전면허(필기·기능) + 신체·적성검사')
for t in ['선장 및 항해사','선박기관사']:
    G[t] = J(['license'], train='designated', exam='license', note='해기사 면허(해양계 학교·승선 경력) — 면허 유지 교육 필요', status='check')
G['선박갑판원'] = J(['license'], train='designated', weight='light', note='선원수첩(만 18세 이상, 기초안전교육)')
for t, n in [('택시운전원','운전면허 + 운전경력 1년 → 택시운전 자격시험'),('버스운전원','1종 대형면허 + 운전경력 1년 → 버스운전 자격시험'),('화물차·특수차운전원','운전면허 + 운전경력 1~2년 → 화물운송종사 자격')]:
    G[t] = J(['license','experience'], exam='license', exp=True, weight='light', note=n)
G['건축가(건축설계사)'] = J(['license','experience'], edu='major', exam='license', exp=True, note='건축학(인증 5년제) 등 → 건축사사무소 실무수련 3~4년 → 건축사시험')
# 후보 밖(제도 지식으로 판단 → 전부 확인 필요)
for t, n in [('항공기조종사','조종사 자격증명(비행시간 요건) + 항공신체검사'),('헬리콥터조종사','회전익 조종사 자격증명(비행시간) + 신체검사')]:
    G[t] = J(['license','experience'], train='designated', exam='license', exp=True, other=['physical'], note=n, status='check')
for t, n in [('항공교통관제사','항공교통관제사 자격증명(지정 교육 + 시험)'),('철도교통관제사','철도교통관제 자격증명'),('선박교통관제사','해기사 등 응시 요건 + 관제 교육'),('점화·발파·화약관리원','화약류 관리·취급 자격'),('임상심리사','정신건강임상심리사·임상심리사 자격(수련 + 시험)')]:
    G[t] = J(['license'], train='designated', exam='license', note=n, status='check')

NONE = {  # 단서는 걸렸지만 관문 아님(이유) — 검토 투명성
 '경영·진단전문가':'석사(MBA) 많음 — 우대', '인적자원전문가':'공채 관행', '문리학원강사':'학원법 강사 기준(전문대졸 이상 등) 정도 — 가벼움', '외국어강사':'전공·교원자격 등 기준 — 가벼움', '컴퓨터강사':'자격 우대', '예능강사':'학원법 기준 — 가벼움',
 '보험인수심사원(언더라이터)':'금융권 공채', '속기사':'공무원 속기직은 선택', '자산운용가':'투자자산운용사 등 업계 자격 — 확인 필요', '심리상담전문가':'민간 자격·수련(법정 아님)', '청능사':'민간 자격', '법률사무원':'자격 불필요',
 '교재·교구 및 이러닝교육전문가':'공채 관행', '학예사':'국공립은 공무원 경로, 학예사 자격은 등록 박물관 요건 — 확인 필요', '방송기자':'언론사 공채(사실상 필기) → 2층', '신문기자':'언론사 공채 → 2층', '잡지기자':'체력 언급뿐',
 '의상디자이너':'포트폴리오 → 2층', '제품디자이너':'포트폴리오 → 2층', '통역가':'필수 과정 없음', '아나운서':'방송사 공채 → 2층', '방송연출가':'방송사 공채 → 2층', '개그맨 및 코미디언':'공채·오디션', '성우':'방송사 공채', '리포터':'공채·추천',
 '연예인매니저':'체력 언급뿐', '영상·녹화 및 편집기사':'체력 언급뿐', '촬영기사':'체력 언급뿐', '음향·녹음기사':'체력 언급뿐', '연극영화방송기술감독':'경력 우대', '메이크업아티스트 및 뷰티매니저':'메이크업 자격은 영업 시 — 확인 필요',
 '음료조리사':'승진 언급뿐', '경호원':'경비업법 신임교육 정도 — 가벼움', '여행안내원':'국외여행인솔자 등록(관광통역안내사는 별도 자격) — 확인 필요', '청원경찰':'공공기관만 선발 시험', '자연 및 문화해설사':'기관별 양성과정',
 '환경미화원 및 재활용품수거원':'지자체 채용만 체력·필기', '청소원':'지자체 채용만 체력·필기', '철로설치·보수원':'공기업 공채 → 2층', '발전·배전장치조작원':'원자력 발전만 원자로조종면허',
 '건축감리기술자':'경력 등급제, 자격 우대', '토목감리기술자':'경력 등급제, 자격 우대', '건축구조기술자':'자격 우대', '토목구조설계기술자':'자격 우대', '토목시공기술자 및 견적원':'자격 우대', '토목안전·환경기술자 및 토목품질기술자':'자격이 사실상 필수 → 2층',
 '지적 및 측량기술자':'자격 우대', '지리정보시스템전문가':'자격 우대', '통신망운영기술자':'자격 우대', '게임프로그래머':'경력 우대', '조경기술자':'공무원 진출은 선택',
 '도료 및 농약품화학공학기술자 및 연구원':'대학 졸업이 사실상 기준(법정 아님) → 2층', '고무 및 플라스틱화학공학기술자 및 연구원':'대학 졸업 사실상 → 2층', '비누 및 화장품화학공학기술자 및 연구원':'대학 졸업 사실상 → 2층', '의약품공학기술자 및 연구원':'대학 졸업 사실상 → 2층', '석유화학공학기술자 및 연구원':'대학 졸업 사실상 → 2층',
 '재료(금속)공학기술자':'관련 학과 졸업 사실상 → 2층', '식품공학시험원':'관련 학과 사실상 → 2층', '농림어업시험원':'농약 사용 면허만', '생명과학시험원':'농약 사용 면허만',
}

NONE.update({t: '단서 단어만 걸림(승진·경력·체력 언급)' for t in ['노점 및 이동판매원','상품대여원','하역·적재종사원','혼례종사원','섀시조립·설치원','해외영업원','재봉사','펄프·종이제조장치조작원','제화원','패턴사','재단사','한복제조원','사무용 전자기기설치·수리원','방송송출장비기사','건설기계공학기술자 및 연구원','자동차공학기술자','대기환경기술자 및 연구원','조선·해양공학기술자','금속·재료공학시험원','보건위생·환경검사원','소방공학기술자 및 연구원','양식원','조경원','어부 및 해녀']})
NONE['잠수기능원'] = '산업 잠수는 잠수기능사 등 자격 요구 가능 — 확인 필요'
NONE['식품·담배등급원'] = '담배 등급원만 회사 필기시험'
rows = []
def code(t): return (cand.get(t) or {}).get('jobCode') or extra_codes.get(t)
def evidence(t):
    w = (cand.get(t) or {}).get('way', '')
    s = [x.strip() for x in re.split(r'(?<=[다요])\.\s*', w) if x.strip()]
    key = re.compile(r'면허|국가시험|임용|공무원|합격해야|합격하여야|취득해야|졸업|이수|수련|경력|체력|신체|선발|승진|자격')
    hit = [x for x in s if key.search(x)]
    return (hit[0] if hit else (s[0] if s else ''))[:220]
for t, g in G.items():
    rows.append(dict(jobCode=code(t), title=t, **g, evidence=evidence(t), source='고용24 직업정보(되는 길)' if t in cand else '제도 지식(근거 문장 없음)'))
for t, why in NONE.items():
    rows.append(dict(jobCode=code(t), title=t, badges=[], conditions=None, weight=None, note=why, status='none', evidence=evidence(t), source='고용24 직업정보(되는 길)'))
missing = [r['title'] for r in rows if not r['jobCode']]
untouched = [t for t in cand if t not in G and t not in NONE]
json.dump(dict(generatedAt='2026-10-27', badgeOrder=['senior','degree','selection','license','experience'], rows=rows), open(SP + '/job-gates.draft.json', 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print('gated', len(G), 'none', len(NONE), 'missing codes', missing, 'untouched candidates', untouched)
print(Counter(b for g in G.values() for b in g['badges']))
print('check', sum(1 for g in G.values() if g['status']=='check'), '| light', sum(1 for g in G.values() if g['weight']=='light'))
