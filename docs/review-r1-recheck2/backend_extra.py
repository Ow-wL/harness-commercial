import importlib.util
import json
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from backend.app import main as M
from fastapi import Response

def ctx(lat,lng): return SimpleNamespace(lat=lat,lng=lng,gu_name='부평구',dong_name='부평1동')
class Service:
    def __init__(self,fail=False):
        self.fail=fail;self.calls=self.active=self.max_active=0;self.mutex=threading.Lock()
        self.events={k:threading.Event() for k in ['a','b']};self.release=threading.Event()
    def analyze(self,context,biz,**kwargs):
        with self.mutex:self.calls+=1;self.active+=1;self.max_active=max(self.active,self.max_active)
        try:
            if biz==next(iter(M.C.CODE_NAME)):
                name=threading.current_thread().name
                if name in self.events:self.events[name].set();assert self.release.wait(5)
            if self.fail:raise RuntimeError('injected repeated failure')
            time.sleep(.001)
            return {'종합':{'점수':50,'병목_지표':None,'데이터_충족률':1},'지표':[],'meta':{'업종':M.C.CODE_NAME[biz],'업종그룹':M.C.group_of(biz)},'경고':[]}
        finally:
            with self.mutex:self.active-=1
def setup(svc):
    app=M.create_app(warm_biz=[]);app.state.service=svc;app.state.context_builder=SimpleNamespace(build=ctx)
    ep=next(r.endpoint for r in app.routes if getattr(r,'path','')=='/rank')
    def call(lat=37.4894):return ep(M.RankRequest(lat=lat,lng=126.7246,radius_m=500),Response())
    return app,call
svc=Service();app,call=setup(svc)
results=[]
a=threading.Thread(name='a',target=lambda:results.append(call()))
b=threading.Thread(name='b',target=lambda:results.append(call(37.49)))
a.start();assert svc.events['a'].wait(5);b.start();overlap=svc.events['b'].wait(2);svc.release.set();a.join(5);b.join(5)
different={'bothEnteredBeforeRelease':overlap,'maxParallel':svc.max_active,'calls':svc.calls,'cacheSize':len(app.state.rank_cache),'inflightEmpty':not app.state.rank_inflight}
svc=Service(fail=True);svc.release.set();app,call=setup(svc);errors=[]
def bad():
    try:call()
    except RuntimeError:errors.append('RuntimeError')
threads=[threading.Thread(target=bad) for _ in range(5)]
for t in threads:t.start()
for t in threads:t.join(5)
exception={'errors':len(errors),'calls':svc.calls,'inflightEmpty':not app.state.rank_inflight,'cacheSize':len(app.state.rank_cache)}
svc.fail=False;call();exception.update(recoveredCalls=svc.calls,inflightEmptyAfterRecovery=not app.state.rank_inflight)
svc=Service();svc.release.set();app,call=setup(svc);original=M.rank_items
def broken_items(results):raise ValueError('injected response build failure')
M.rank_items=broken_items
try:
    try:call()
    except ValueError:pass
    build_failure={'calls':svc.calls,'inflightEmpty':not app.state.rank_inflight,'cacheSize':len(app.state.rank_cache)}
finally:M.rank_items=original
call();build_failure.update(recoveredCalls=svc.calls,inflightEmptyAfterRecovery=not app.state.rank_inflight)
log={'differentKeys':different,'allFailThenRecover':exception,'responseBuildFailure':build_failure}
Path(__file__).with_suffix('.json').write_text(json.dumps(log,indent=2),encoding='utf-8');print(json.dumps(log,indent=2))
