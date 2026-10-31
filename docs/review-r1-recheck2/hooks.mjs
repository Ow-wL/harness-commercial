import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {JSDOM}=require('jsdom'),{window}=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'})
for(const k of ['window','document','navigator','HTMLElement','MutationObserver'])Object.defineProperty(globalThis,k,{configurable:true,value:k==='window'?window:window[k]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {renderHook,waitFor,cleanup}=require('@testing-library/react')
const {useRank,clearRankCache}=await import('../../frontend/src/lib/useRank.ts')
const {useInsights,clearInsightsCache}=await import('../../frontend/src/lib/useInsights.ts')
const payloads={rank:{lat:37.4894,lng:126.7246,radius_m:500,gu_name:'부평구',dong_name:'부평1동',count:1,items:[{biz_code:'R10406',name:'PC방',group:'목적방문형',overall:62.3,weakest:null,coverage:1,regulated:false,warnings:0}],engine_version:'mvp-0.5.1'},insights:{biz_code:'R10406',gu_code:'28237',gu_name:'부평구',engine_version:'mvp-0.5.1',inflow:null,hours_profile:null,hours_profile_note:null}}
const log=[]
for(const kind of ['rank','insights'])for(const mode of ['data-forward','data-reverse','engine-only']){
 cleanup();clearRankCache();clearInsightsCache();let calls=0,renders=0,matching=false
 const expected={engine:'mvp-0.5.1',data:mode==='data-reverse'?'2099-01':'2026-06'}
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({...payloads[kind],engine_version:!matching&&mode==='engine-only'?'mvp-0.5':expected.engine}),{status:200,headers:{'Content-Type':'application/json','X-Data-Version':matching?expected.data:mode==='data-forward'?'2099-01':'2026-06'}})}
 const use=kind==='rank'?useRank:useInsights,request=kind==='rank'?{lat:37.4894,lng:126.7246,radius_m:500}:{lat:37.4894,lng:126.7246,biz_code:'R10406'}
 const render=token=>renderHook(({token})=>{renders++;return use(request,{...expected},token)},{initialProps:{token}})
 const token={};let hook=render(token)
 await waitFor(()=>{if(hook.result.current.status!=='stale')throw Error('stale expected')})
 for(let i=0;i<15;i++)hook.rerender({token})
 await new Promise(r=>setTimeout(r,100))
 const afterRerenders=calls
 hook.unmount();hook=render(token)
 await waitFor(()=>{if(hook.result.current.status!=='stale'||calls!==2)throw Error('no stale cache')})
 hook.rerender({token:{}});await waitFor(()=>{if(hook.result.current.status!=='stale'||calls!==3)throw Error('token must retry')})
 matching=true;hook.rerender({token:{}});await waitFor(()=>{if(hook.result.current.status!=='success')throw Error('must recover')})
 const atRecovery=calls;hook.unmount();hook=render({});if(hook.result.current.status!=='success'||calls!==atRecovery)throw Error('matching cache expected')
 log.push({kind,mode,requestsAfter15SameTokenRerenders:afterRerenders,requestsAfterRemount:2,requestsAfterNewTokenStale:3,recovered:hook.result.current.status,totalRequests:calls,renders,matchingCacheReused:calls===4})
}
cleanup();fs.writeFileSync(new URL('hooks.json',import.meta.url),JSON.stringify(log,null,2));console.log(JSON.stringify(log,null,2))
