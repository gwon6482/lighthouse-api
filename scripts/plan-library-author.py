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
