import {createRequire} from 'node:module'
import fs from 'node:fs'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {JSDOM}=require('jsdom'),{window}=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'})
for(const key of ['window','document','navigator','HTMLElement','MutationObserver'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {act,renderHook,waitFor,cleanup}=require('@testing-library/react')
const {useRank,clearRankCache}=await import('../../frontend/src/lib/useRank.ts')
const {SideCache}=await import('../../frontend/src/lib/useSideRequest.ts')
const rank=lat=>({lat,lng:126.7246,radius_m:500,gu_name:'부평구',dong_name:'부평1동',count:1,items:[{biz_code:'R10406',name:'PC방',group:'목적방문형',overall:62.3,weakest:null,coverage:1,regulated:false,warnings:0}]})
const response=lat=>new Response(JSON.stringify(rank(lat)),{status:200,headers:{'Content-Type':'application/json','X-Data-Version':'2026-06'}})
const log={}
const cache=new SideCache(32);for(let i=0;i<32;i++)cache.set(''+i,i);cache.get('0');cache.set('32',32);log.lru={size:cache.size,touchedSurvives:cache.has('0'),oldestEvicted:!cache.has('1')}
const pending=[]
globalThis.fetch=(url,init)=>new Promise(resolve=>pending.push({lat:JSON.parse(init.body).lat,signal:init.signal,resolve}))
const hook=renderHook(({lat})=>useRank({lat,lng:126.7246,radius_m:500},'v1'),{initialProps:{lat:1}})
await waitFor(()=>{if(pending.length!==1)throw Error('await first')})
hook.rerender({lat:2});await waitFor(()=>{if(pending.length!==2)throw Error('await second')})
await act(async()=>pending[1].resolve(response(2)))
await act(async()=>pending[0].resolve(response(1)))
log.lateResponse={firstAborted:pending[0].signal.aborted,status:hook.result.current.status,shownLat:hook.result.current.data?.lat}
hook.unmount();clearRankCache()
let count=0
globalThis.fetch=async()=>{count++;if(count===1)throw new TypeError('injected offline');return response(1)}
const retry=renderHook(({token,version})=>useRank({lat:1,lng:126.7246,radius_m:500},version,token),{initialProps:{token:{},version:'v1'}})
await waitFor(()=>{if(retry.result.current.status!=='error')throw Error('await error')})
act(()=>{retry.result.current.retry();retry.result.current.retry()})
await waitFor(()=>{if(retry.result.current.status!=='success')throw Error('await recovery')})
log.retry={requests:count,status:retry.result.current.status}
retry.rerender({token:{},version:'v2'});await waitFor(()=>{if(count!==3)throw Error('await version')})
log.versionKey={requests:count};retry.unmount();clearRankCache()
count=0;globalThis.fetch=async()=>{count++;if(count===1)throw new TypeError('offline');return response(1)}
const token=renderHook(({token})=>useRank({lat:1,lng:126.7246},'v1',token),{initialProps:{token:{}}})
await waitFor(()=>{if(token.result.current.status!=='error')throw Error('await error')});token.rerender({token:{}})
await waitFor(()=>{if(token.result.current.status!=='success')throw Error('await token')});log.newToken={requests:count,status:token.result.current.status}
cleanup();clearRankCache();fs.writeFileSync(new URL('hooks.json',import.meta.url),JSON.stringify(log,null,2));console.log(JSON.stringify(log,null,2))
