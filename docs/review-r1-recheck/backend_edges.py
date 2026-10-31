"""제품 소스를 바꾸지 않는 endpoint/오류 계약 검수. 외부 데이터 계산은 계수용 fake로 대체."""
import json
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.app import main as M
from fastapi import Response
from fastapi.testclient import TestClient

CTX = SimpleNamespace(lat=37.4894, lng=126.7246, gu_code='28237', gu_name='부평구', dong_name='부평1동')
VERSION = SimpleNamespace(health=lambda: {'version': 'test-version', 'as_of': {}})
request = M.RankRequest(lat=CTX.lat, lng=CTX.lng, radius_m=500)

class Service:
    def __init__(self, failure=False):
        self.calls = 0
        self.active = 0
        self.max_active = 0
        self.mutex = threading.Lock()
        self.first_started = threading.Event()
        self.release_first = threading.Event()
        self.second_started = threading.Event()
        self.release_second = threading.Event()
        self.third_started = threading.Event()
        self.failure = failure
        self.rt = SimpleNamespace(version=VERSION)
        self.cache = SimpleNamespace()

    def analyze(self, ctx, biz, **kwargs):
        with self.mutex:
            self.calls += 1
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            name = threading.current_thread().name
            if self.failure and biz == next(iter(M.C.CODE_NAME)):
                if name == 'first':
                    self.first_started.set()
                    assert self.release_first.wait(5)
                    raise RuntimeError('injected compute failure')
                if name == 'second':
                    self.second_started.set()
                    assert self.release_second.wait(5)
                if name == 'third':
                    self.third_started.set()
            time.sleep(.002)
            return {'종합': {'점수': 50, '병목_지표': None, '데이터_충족률': 1}, '지표': [],
                    'meta': {'업종': M.C.CODE_NAME[biz], '업종그룹': M.C.group_of(biz)}, '경고': []}
        finally:
            with self.mutex:
                self.active -= 1

def app_for(service):
    app = M.create_app(warm_biz=[])
    app.state.service = service
    app.state.context_builder = SimpleNamespace(build=lambda lat, lng: CTX)
    return app

def endpoint(app):
    return next(r.endpoint for r in app.routes if getattr(r, 'path', '') == '/rank')

normal = Service()
app = app_for(normal)
ep = endpoint(app)
out = []
threads = [threading.Thread(target=lambda: out.append(ep(request, Response()))) for _ in range(3)]
for t in threads: t.start()
for t in threads: t.join(5)
success = {'requests': len(out), 'analyze_calls': normal.calls, 'expected': len(M.C.CODE_NAME),
           'inflight_empty': app.state.rank_inflight == {}}

failure = Service(failure=True)
app = app_for(failure)
ep = endpoint(app)
statuses = {}
def run():
    name = threading.current_thread().name
    try:
        ep(request, Response())
        statuses[name] = 'success'
    except Exception as exc:
        statuses[name] = type(exc).__name__

first = threading.Thread(target=run, name='first')
second = threading.Thread(target=run, name='second')
third = threading.Thread(target=run, name='third')
first.start()
assert failure.first_started.wait(5)
second.start()
time.sleep(.1)  # second가 기존 key_lock을 얻어 대기하도록 한다
failure.release_first.set()
assert failure.second_started.wait(5)
missing_while_second_computes = not app.state.rank_inflight
third.start()
third_entered_before_second_finished = failure.third_started.wait(2)
failure.release_second.set()
for t in [first, second, third]: t.join(5)
exception = {'statuses': statuses, 'lock_missing_while_waiter_computes': missing_while_second_computes,
             'third_computes_while_second_blocked': third_entered_before_second_finished,
             'max_parallel_analyze': failure.max_active, 'analyze_calls': failure.calls,
             'single_success_plus_failure_expected': len(M.C.CODE_NAME) + 1}

old_build = M.build_insights
app = M.create_app(service=Service(), warm_biz=[])
with TestClient(app, raise_server_exceptions=False) as client:
    app.state.context_builder = SimpleNamespace(build=lambda lat, lng: CTX)
    def broken(*args): raise RuntimeError('private injected details')
    M.build_insights = broken
    response = client.post('/insights', json={'lat': CTX.lat, 'lng': CTX.lng, 'biz_code': 'R10406'})
    error = {'status': response.status_code, 'body': response.json(),
             'leaks_details': 'private injected details' in response.text}
M.build_insights = old_build
log = {'normal': success, 'failure_race': exception, 'insights_500': error}
Path(__file__).with_suffix('.json').write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(log, ensure_ascii=False, indent=2))
