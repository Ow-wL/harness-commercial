import importlib.util
import json
import sys
import urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('review_smoke',ROOT/'scripts/smoke_api.py')
S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
cache={}
def live(path,body=None):
    key=(path,json.dumps(body,sort_keys=True))
    if key not in cache:
        req=urllib.request.Request('http://127.0.0.1:8000'+path,data=json.dumps(body).encode() if body else None,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=180) as r:cache[key]=(r.status,dict((k.lower(),v) for k,v in r.headers.items()),r.read(),.01)
    return cache[key]
health=json.loads(live('/health')[2]);engine=health['engine']['version'];data=health['data']['version']
rows=[]
for mode in ['matching','data-forward','data-reverse','engine-only','missing-data','missing-engine']:
    def fetch(path,body=None):
        status,headers,raw,t=live(path,body);headers=dict(headers)
        if path in ['/rank','/insights']:
            obj=json.loads(raw)
            if mode=='data-forward':headers['x-data-version']='2099-01'
            if mode=='missing-data':headers.pop('x-data-version',None)
            if mode=='engine-only':obj['engine_version']='mvp-0.5'
            if mode=='missing-engine':obj.pop('engine_version',None)
            raw=json.dumps(obj).encode()
        return status,headers,raw,t
    expected_data='2099-01' if mode=='data-reverse' else data
    rank_fails,_=S.check_rank(fetch,{},engine,expected_data)
    insights_fails,_=S.check_insights(fetch,engine,expected_data)
    rows.append({'mode':mode,'rankFails':rank_fails,'insightsFails':insights_fails})
    assert bool(rank_fails)==(mode!='matching') and bool(insights_fails)==(mode!='matching')
Path(__file__).with_suffix('.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(rows,ensure_ascii=False,indent=2))
