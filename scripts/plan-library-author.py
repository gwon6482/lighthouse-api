# 직업 계획 작성 도우미(2026-11-13) — 계획을 파이썬으로 짧게 적어 JSON 으로 내보낸다. 정본은 data/plan-library/*.json 이다.
#   쓰는 법: 레포 루트에서 `python3 - <<'EOF'` 안에 `exec(open('scripts/plan-library-author.py').read())` 한 뒤 save(...) 호출
#   Pj = 직업 전용 프로젝트, It = 계획 항목(ref·순서·전공자 필요 여부), C = 보편 프로젝트 추가, promote = 직업 전용 → 보편으로 올리기
import json, pathlib
D = pathlib.Path('data/plan-library')
_load = lambda f: json.loads((D / f).read_text())
_dump = lambda f, o: (D / f).write_text(json.dumps(o, ensure_ascii=False, indent=1))
PR = {j['title']: j for j in _load('priority-jobs.json')['jobs']}
def _ph(phases): return [dict(weeks=w, title=t, items=i) for w, t, i in phases]
def Pj(id, name, type, sub, cat, method, level, days, mins, goal, phases, basis='practice', **x):
    return dict(id=id, name=name, type=type, subtype=sub, category=cat, method=method, level=level, daysPerWeek=days, minutesPerSession=mins, goal=goal, phases=_ph(phases), basis=basis, **x)
def It(ref, step, major=True, skip=None, note=None, optional=False):
    d = dict(ref=ref, step=step, major=major)
    if skip: d['skip'] = skip
    if note: d['note'] = note
    if optional: d['optional'] = True
    return d
def C(id, name, type, sub, scope, fams, cat, method, level, days, mins, goal, phases, **x):
    c = _load('common-projects.json'); assert all(i['id'] != id for i in c['items']), id
    c['items'].append(dict(id=id, name=name, type=type, subtype=sub, scope=scope, families=fams, category=cat, method=method, level=level, daysPerWeek=days, minutesPerSession=mins, goal=goal, phases=_ph(phases), **x))
    _dump('common-projects.json', c)
def promote(jobCode, pid, cid, fams, name=None):
    """직업 전용 프로젝트를 보편 프로젝트로 올리고 그 직업 계획의 ref 를 바꾼다"""
    plan = _load(f'plans/{jobCode}.json'); p = next(x for x in plan['projects'] if x['id'] == pid)
    plan['projects'] = [x for x in plan['projects'] if x['id'] != pid]
    for items in [plan['common'], *plan['byTrack'].values()]:
        for it in items:
            if it['ref'] == pid: it['ref'] = cid
    c = _load('common-projects.json'); assert all(i['id'] != cid for i in c['items']), cid
    q = {k: v for k, v in p.items() if k not in ('id', 'basis')}
    c['items'].append(dict(id=cid, **{**q, 'name': name or q['name']}, scope='family', families=fams, promotedFrom=f'{jobCode}:{pid}'))
    _dump('common-projects.json', c); _dump(f'plans/{jobCode}.json', plan)
def save(title, summary, gate, projects, common, byTrack, verify=None):
    j = PR[title]
    assert set(byTrack) == {t['id'] for t in j['tracks']}, (title, set(byTrack) ^ {t['id'] for t in j['tracks']})
    out = dict(jobCode=j['jobCode'], title=j['title'], displayName=j['displayName'], family=j['family'], status='draft', updatedAt='2026-11-13',
               source='Claude 가 직업정보·공식 자격 목록·일반 지식으로 쓴 초안. 채용공고 분석 근거는 아직 없다(API 크레딧 뒤 보강)',
               summary=summary, gate=gate, tracks=j['tracks'], covers=j['covers'], projects=projects, common=common, byTrack=byTrack)
    if verify: out['verify'] = verify
    _dump(f"plans/{j['jobCode']}.json", out)
    # 계열 공통 보편 프로젝트를 다른 계열의 계획이 쓰면 그 계열도 families 에 넣는다(검사 스크립트가 어긋남을 오류로 본다)
    refs = {i['ref'] for i in common + [x for v in byTrack.values() for x in v]}
    c = _load('common-projects.json'); grew = [x['id'] for x in c['items'] if x['id'] in refs and x['scope'] == 'family' and j['family'] not in x['families']]
    if grew:
        for x in c['items']:
            if x['id'] in grew: x['families'].append(j['family'])
        _dump('common-projects.json', c)
    print('저장', j['jobCode'], j['displayName'], '| 전용', len(projects), '| 공통', len(common), '|', {k: len(v) for k, v in byTrack.items()})
def relink(jobCode, pid, cid):
    """이미 보편에 있는 프로젝트와 같은 직업 전용 프로젝트를 지우고 ref 만 바꾼다"""
    plan = _load(f'plans/{jobCode}.json')
    plan['projects'] = [x for x in plan['projects'] if x['id'] != pid]
    for items in [plan['common'], *plan['byTrack'].values()]:
        for it in items:
            if it['ref'] == pid: it['ref'] = cid
    _dump(f'plans/{jobCode}.json', plan)

def adopt(title, tracks=()):
    """backlog.json 의 묶음을 priority-jobs.json 으로 옮긴다(계획을 쓰기 직전에 부른다). tracks = [(id, 이름, 설명), ...]"""
    global PR
    bl = _load('backlog.json'); pri = _load('priority-jobs.json')
    b = next(x for w in bl['waves'] for x in w['bundles'] if x['title'] == title)
    assert not b['done'], title
    b['done'] = True
    pri['jobs'].append(dict(no=len(pri['jobs']) + 1, tier=None, wave=b['wave'], batch=b['batch'], jobCode=b['jobCode'], title=b['title'], displayName=b['displayName'],
        family=b['family'], group=b['group'], groupName=b['groupName'], work24Postings=None,
        tracks=[dict(id=i, name=n, desc=d) for i, n, d in tracks], covers=[dict(jobCode=c['jobCode'], title=c['title'], track=c.get('track')) for c in b['covers']]))
    _dump('backlog.json', bl); _dump('priority-jobs.json', pri)
    PR = {j['title']: j for j in pri['jobs']}
def next_batch():
    """아직 안 만든 첫 묶음의 계획 목록을 찍는다"""
    left = [x for w in _load('backlog.json')['waves'] for x in w['bundles'] if not x['done']]
    if not left: print('남은 계획 없음'); return
    for x in [y for y in left if y['batch'] == left[0]['batch']]: print(x['batch'], '|', x['title'], '|', x['displayName'], '|', x['family'], '|', ', '.join(c['title'] for c in x['covers']))

# ── 2차용 줄임 도우미(2026-11-13) ──
def cert(id, name, sub, goal, phases, method='book', level='중급', days=5, mins=90, **x): return Pj(id, name, 'cert', sub, 'qualification', method, level, days, mins, goal, phases, **x)
def know(id, name, goal, phases, method='book', level='입문', days=3, mins=60, sub='major', **x): return Pj(id, name, 'edu', sub, 'knowledge', method, level, days, mins, goal, phases, **x)
def skl(id, name, goal, phases, method='practice', level='입문', days=3, mins=90, sub='field', **x): return Pj(id, name, 'skill', sub, 'skill', method, level, days, mins, goal, phases, **x)
def out(id, name, goal, phases, method='personal_project', level='중급', days=3, mins=120, sub='portfolio', **x): return Pj(id, name, 'output', sub, 'portfolio', method, level, days, mins, goal, phases, **x)
def exp(id, name, goal, phases, method='parttime', level='입문', days=5, mins=480, sub='work', **x): return Pj(id, name, 'activity', sub, 'experience', method, level, days, mins, goal, phases, **x)
END = lambda n=90: [It('cp.resume', n), It('cp.interview', n + 1)]
def mk(title, summary, gate, projects, common, byTrack=None, tracks=(), verify=None):
    adopt(title, tracks); save(title, summary, gate, projects, common, byTrack or {}, verify)
def pro(title, summary, gate, s1, s2, train, english=True, w1=24, w2=32, src='시험 공고', extra=()):
    """전문자격 시험형: 1차 → 2차 → 수습"""
    dn = next(x for w in _load('backlog.json')['waves'] for x in w['bundles'] if x['title'] == title)['displayName']
    P = [cert('p.first', f'{dn} 1차 시험', 'national-license', '1차 시험에 합격한다.', [(w1 * 2 // 3, '기본 이론', s1), (w1 - w1 * 2 // 3, '문제 풀이', ['객관식 기출 회독', '과락 과목 보강', '모의고사'])], method='lecture', level='심화', days=6, mins=240, basis='law'),
         cert('p.second', f'{dn} 2차 시험', 'national-license', '2차 시험에 합격한다.', [(w2 // 2, '심화 이론', s2), (w2 - w2 // 2, '답안 연습', ['서술형 답안 작성', '기출 회독', '모의고사'])], method='lecture', level='심화', days=6, mins=300, basis='law'),
         exp('p.train', f'{dn} 실무 수습과 등록', '수습·연수를 마치고 등록한다.', [(2, '준비', ['수습 기관 찾기', '면접']), (24, '수습', train)], method='field_practice', level='중급', basis='law', verify='수습 기간과 방식은 자격별 협회 안내 확인')]
    C0 = ([It('cp.toeic', 1, note='공인 영어 성적이 응시 요건(기준 점수는 공고 확인)')] if english else []) + [It('p.first', 2), It('p.second', 3), It('p.train', 4)] + list(extra) + END()
    mk(title, summary, gate, P, C0, verify=f'시험 과목·응시 요건은 {src}가 정본. 과목 구성은 바뀔 수 있다')
def lic(title, summary, gate, dept, exam, projects=(), extra=(), tracks=(), byTrack=None, hospital=True, verify=None):
    """면허형: 학과 진학 → 성적 → 실습 → 국가시험"""
    C0 = [It('cp.dept-admission', 1, False, f'이미 {dept}에 다니고 있다', note=dept), It('cp.major-grades', 2), It('cp.volunteer', 3, note='분야 관련 봉사', optional=True), It('cp.clinical-practice', 4, note='학과가 정한 실습'), It('cp.license-exam', 6, note=exam)]
    if hospital: C0.append(It('cp.hospital-apply', 7, note='병·의원 채용 준비'))
    mk(title, summary, gate, list(projects), C0 + list(extra) + END(), byTrack, tracks, verify)
def civil(title, summary, gate, major, subjects, fitness=False, extra=(), tracks=(), byTrack=None, common9=True, verify='시험 과목·응시 요건은 채용 공고가 정본. 과목은 직렬·연도에 따라 바뀐다'):
    """공무원 시험형"""
    assert isinstance(subjects, list), title
    P = [Pj('p.major', major, 'hiring', 'civil', 'qualification', 'lecture', '중급', 6, 180, '전문과목에서 합격선 점수를 받는다.', [(10, '기본 이론', subjects), (8, '기출 회독', ['기출 3회독', '법령·판례 정리', '오답 노트']), (6, '실전', ['모의고사', '시간 배분'])], basis='law')]
    C0 = [It('cp.civil-pick', 1)] + ([It('cp.civil9-common', 2)] if common9 else []) + [It('p.major', 3)] + ([It('cp.fitness-test', 5)] if fitness else []) + list(extra) + [It('cp.civil-interview', 9)]
    mk(title, summary, gate, P, C0, byTrack, tracks, verify)
def eng(title, summary, major, certnote, projects=(), extra=(), tracks=(), byTrack=None, gate='법정 요건은 없으나 채용 공고가 관련 전공과 기사 자격을 요구·우대한다', certopt=False, verify=None):
    """공학 기술직형: 전공 → 기사 → 실습 → 채용"""
    C0 = [It('cp.job-research', 1), It('cp.eng-major', 2, False, '전공 과목에서 배운다', note=major), It('cp.engineer-cert', 3, note=certnote, optional=certopt)] + list(extra) + [It('cp.eng-field', 80, optional=True), It('cp.speaking', 81, note='대기업 지원 시', optional=True), It('cp.aptitude', 82, optional=True)] + END()
    mk(title, summary, gate, list(projects), C0, byTrack, tracks, verify)
def tech(title, summary, certnote, projects=(), extra=(), work='관련 업체', gate=None, tracks=(), byTrack=None, certopt=False, train=True, verify=None):
    """기능직형: 훈련 → 기능사 → 현장"""
    C0 = [It('cp.job-research', 1)] + ([It('cp.training-course', 2, note='국비·폴리텍 과정', optional=True)] if train else []) + ([It('cp.craftsman-cert', 4, note=certnote, optional=certopt)] if certnote else []) + list(extra) + [It('cp.shop-work', 80, note=work), It('cp.interview', 91)]
    mk(title, summary, gate, list(projects), C0, byTrack, tracks, verify)
def covtrack(title, mapping):
    """함께 덮는 직업을 세부 카테고리에 잇는다. mapping = {덮는 직업 이름: 카테고리 id}"""
    pri = _load('priority-jobs.json'); j = next(x for x in pri['jobs'] if x['title'] == title)
    tids = {t['id'] for t in j['tracks']}
    nz = lambda s: s.replace(' ', '').replace('‧', '·')
    mp = {nz(k): v for k, v in mapping.items()}
    for c in j['covers']:
        if nz(c['title']) in mp: assert mp[nz(c['title'])] in tids, (title, mapping); c['track'] = mp[nz(c['title'])]
    assert set(mp) <= {nz(c['title']) for c in j['covers']}, (title, set(mp) - {nz(c['title']) for c in j['covers']})
    _dump('priority-jobs.json', pri)
    pl = _load(f"plans/{j['jobCode']}.json"); pl['covers'] = j['covers']; _dump(f"plans/{j['jobCode']}.json", pl)

# ── 갈래 나누기(2026-11-14) ──
def split(code, tracks, by=None, move=None, drop=(), projects=(), covers=None):
    """이미 있는 계획을 세부 카테고리로 나누거나 카테고리를 더한다.
    tracks = [(id, 이름, 설명)] 전체 목록(기존 포함) · by = {카테고리: [It...]} 더할 항목
    move = {공통 항목(ref 또는 프로젝트 이름): {카테고리: True|메모|{고칠 값}}} 공통에서 빼서 적힌 카테고리에만 넣는다('*' = 나머지 전부)
    drop = 공통에서 지울 항목 · projects = 새 직업 전용 프로젝트 · covers = {함께 덮는 직업: 카테고리}"""
    pri = _load('priority-jobs.json'); j = next(x for x in pri['jobs'] if x['jobCode'] == code)
    plan = _load(f'plans/{code}.json')
    j['tracks'] = [dict(id=i, name=n, desc=d) for i, n, d in tracks]; tids = [t['id'] for t in j['tracks']]
    assert set(plan['byTrack']) <= set(tids), (code, set(plan['byTrack']) - set(tids))
    bt = {t: list(plan['byTrack'].get(t, [])) for t in tids}
    have = {q['id'] for q in plan['projects']}
    for q in projects: assert q['id'] not in have, (code, q['id']); have.add(q['id'])
    plan['projects'] += list(projects)
    def rid(k):
        if k.startswith(('cp.', 'p.')): return k
        return next(q['id'] for q in plan['projects'] if q['name'] == k)
    for k, spec in (move or {}).items():
        r = rid(k); it = next(i for i in plan['common'] if i['ref'] == r); plan['common'].remove(it)
        for t in tids:
            v = spec.get(t, spec.get('*', False))
            if v is False: continue
            d = dict(it)
            if isinstance(v, str): d['note'] = v
            elif isinstance(v, dict):
                for kk, vv in v.items():
                    if vv is None or vv is False: d.pop(kk, None)
                    else: d[kk] = vv
            bt[t].append(d)
    for k in drop:
        r = rid(k); n = len(plan['common']); plan['common'] = [i for i in plan['common'] if i['ref'] != r]; assert len(plan['common']) < n, (code, k)
    for t, items in (by or {}).items(): bt[t] += [dict(i, ref=rid(i['ref'])) for i in items]
    cs = {i['step'] for i in plan['common']}
    for t in tids:
        seen = set(cs)
        for i in bt[t]:
            while i['step'] in seen: i['step'] = round(i['step'] + 0.01, 2)
            seen.add(i['step'])
    assert sum(1 for v in bt.values() if not v) <= 1, (code, {k: len(v) for k, v in bt.items()})
    used = {i['ref'] for i in plan['common']} | {i['ref'] for v in bt.values() for i in v}
    plan['projects'] = [q for q in plan['projects'] if q['id'] in used]
    if covers:
        nz = lambda s: s.replace(' ', '').replace('‧', '·'); mp = {nz(k): v for k, v in covers.items()}
        for c in j['covers']:
            if nz(c['title']) in mp: assert mp[nz(c['title'])] in tids, (code, c['title']); c['track'] = mp[nz(c['title'])]
        assert set(mp) <= {nz(c['title']) for c in j['covers']}, (code, set(mp) - {nz(c['title']) for c in j['covers']})
    plan.update(tracks=j['tracks'], covers=j['covers'], byTrack=bt, updatedAt='2026-11-14')
    c = _load('common-projects.json'); grew = False
    for x in c['items']:
        if x['id'] in used and x['scope'] == 'family' and plan['family'] not in x['families']: x['families'].append(plan['family']); grew = True
    if grew: _dump('common-projects.json', c)
    _dump('priority-jobs.json', pri); _dump(f'plans/{code}.json', plan)
    print('나눔', code, plan['displayName'], {k: len(v) for k, v in bt.items()})
Op = lambda ref, step, note=None: It(ref, step, note=note, optional=True)
HI = lambda id, name, goal, phases, **x: Pj(id, name, 'hiring', 'interview', 'skill', 'practice', x.pop('level', '중급'), x.pop('days', 2), x.pop('mins', 90), goal, phases, **x)
LAW = lambda s, n, at='2026-11-14': dict(at=at, level='law', source=s, note=n)
def major(id, name, subjects, **x):
    """공무원 전문과목 프로젝트"""
    return Pj(id, name, 'hiring', 'civil', 'qualification', 'lecture', '중급', 6, 180, '전문과목에서 합격선 점수를 받는다.', [(10, '기본 이론', subjects), (8, '기출 회독', ['기출 3회독', '법령·판례 정리', '오답 노트']), (6, '실전', ['모의고사', '시간 배분'])], basis='law', **x)
