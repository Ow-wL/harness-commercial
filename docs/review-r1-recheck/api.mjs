import fs from 'node:fs'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {readTime} from '../../frontend/src/lib/timeInsights.ts'
import {conclusion} from '../../frontend/src/lib/conclusion.ts'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const ts=require('typescript')
const out=new URL('./',import.meta.url)
const base='http://127.0.0.1:8000'
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),version:r.headers.get('x-data-version')}}
const point={lat:37.4894,lng:126.7246}
const rank=await post('/rank',{...point,radius_m:500})
const rows=[]
for(const item of rank.data.items){
 const body={...point,biz_code:item.biz_code}
 const a=await post('/analyze',{...body,radius_m:500}),ins=await post('/insights',body)
 const m=a.data.result.지표[0]
 const reading=readTime(ins.data,item.name,{fit:m.raw.시간대_적합도,flags:m.flags})
 const expected=m.flags.includes('영업시간대_유입_집중')?'high':m.flags.includes('영업시간대_유입_엇갈림')?'low':m.raw.시간대_적합도===null?null:m.raw.시간대_적합도>1.2?'high':m.raw.시간대_적합도<.85?'low':'normal'
 rows.push({biz:item.name,fit:m.raw.시간대_적합도,flags:m.flags,expected,actual:reading?.level,lines:reading?.lines,match:expected===reading?.level})
}
const errors=[]
for(const [label,body] of [['missing',{}],['invalid_biz',{...point,biz_code:'BAD'}],['outside',{lat:37.5663,lng:126.9779,biz_code:'R10406'}],['invalid_lat',{lat:'37.4894',lng:126.7246,biz_code:'R10406'}],['no_data',{lat:37.3669,lng:126.4157,biz_code:'R10406'}]])errors.push({label,...await post('/insights',body)})
const a=await post('/analyze',{...point,biz_code:'R10406',radius_m:500})
const old=execFileSync('git',['show','c9a2f08:frontend/src/api/schemas.ts'],{encoding:'utf8',cwd:new URL('../../',import.meta.url)})
const js=ts.transpile(old,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}).replace("from 'zod'",`from '${pathToFileURL(require.resolve('zod')).href}'`)
const {AnalyzeResponseSchema}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
const parsed=AnalyzeResponseSchema.safeParse(a.data)
const conclusions=[]
for(const scores of [[24,20,15,10,5],[35,34,33,32,31],[62,55,30,50,45],[55,50,24,48,42],[null,72,null,null,null],[40,40,40,40,40],[70,50,40,60,50]]){
 const input=structuredClone(a.data)
 input.result.지표.forEach((ind,i)=>ind.score=scores[i]);const sorted=input.result.지표.filter(i=>i.score!==null).sort((x,y)=>y.score-x.score)
 input.result.종합.최고_지표=sorted[0].key;input.result.종합.병목_지표=sorted.at(-1).key
 conclusions.push({scores,...conclusion(input)})
}
const log={rows,mismatches:rows.filter(x=>!x.match).length,errors,oldSchema:{keys:Object.keys(a.data),success:parsed.success,issues:parsed.success?[]:parsed.error.issues},conclusions}
fs.writeFileSync(new URL('api.json',out),JSON.stringify(log,null,2))
console.log(JSON.stringify({count:rows.length,mismatches:log.mismatches,pc:rows.find(x=>x.biz==='PC방'),errors:errors.map(x=>({label:x.label,status:x.status,code:x.data.error?.code})),oldSchema:log.oldSchema,conclusions:conclusions.map(x=>({scores:x.scores,rule:x.rule,text:x.text}))},null,2))
