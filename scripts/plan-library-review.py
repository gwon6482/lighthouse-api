# 검토 페이지 만들기(2026-11-13) — data/plan-library 의 JSON 을 review/template.html 에 끼워 한 파일짜리 HTML 로 낸다.
#   python3 scripts/plan-library-review.py <나올 파일.html>
# 나온 파일은 레포에 넣지 않는다(데이터 사본이라 금방 낡는다). Claude 의 Artifact 로 게시해서 본다 — 같은 주소로 다시 올리면 링크가 유지된다.
# 틀(template.html)은 문서 뼈대 없이 <title>·<style>·본문·<script> 만 있다(게시 도구가 뼈대를 씌운다). 브라우저로 바로 열어 볼 때는 --standalone
import json, glob, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / 'data/plan-library'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args: sys.exit('쓰는 법: python3 scripts/plan-library-review.py <나올 파일.html> [--standalone]')
data = {
    'taxonomy': json.loads((D / 'taxonomy.json').read_text()),
    'common': json.loads((D / 'common-projects.json').read_text())['items'],
    'priority': json.loads((D / 'priority-jobs.json').read_text())['jobs'],
    'plans': [json.loads(pathlib.Path(f).read_text()) for f in sorted(glob.glob(str(D / 'plans/*.json')))],
}
tpl = (D / 'review/template.html').read_text()
assert tpl.count('__DATA__') == 1, '틀에 __DATA__ 자리가 하나여야 한다'
# </ 를 <\/ 로 바꿔 JSON 안의 글자가 <script> 를 닫지 못하게 한다
html = tpl.replace('__DATA__', json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/'))
if '--standalone' in sys.argv:
    html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + html.replace('<header class="top">', '</head><body><header class="top">', 1) + '</body></html>'
pathlib.Path(args[0]).write_text(html)
print(f"만듦 {args[0]} — {len(html.encode()) // 1024}KB · 계획 {len(data['plans'])}개 · 보편 프로젝트 {len(data['common'])}개")
