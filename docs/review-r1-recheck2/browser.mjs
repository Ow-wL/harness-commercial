import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {chromium}=require('@playwright/test'),ts=require('typescript')
const src=fs.readFileSync(new URL('../../frontend/e2e/fakeNaverSdk.ts',import.meta.url),'utf8')
const {fakeNaverSdk}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'))
const browser=await chromium.launch({headless:true,channel:'chrome'})
const url='http://127.0.0.1:5173/?lat=37.4894&lng=126.7246&biz=R10406&r=500'
const log={cases:[],errors:[]}
async function open(){const p=await browser.newPage({viewport:{width:1366,height:768}});p.setDefaultTimeout(180000);p.on('pageerror',e=>log.errors.push(e.message));await p.route('https://oapi.map.naver.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:fakeNaverSdk('working')}));return p}
for(const mode of ['data-forward','data-reverse','engine-only']){
 const p=await open();let injecting=true;const calls={analyze:0,rank:0,insights:0}
 await p.route('**/analyze',async r=>{calls.analyze++;const response=await r.fetch({timeout:180000});await r.fulfill({response,headers:{...response.headers(),...(injecting&&mode==='data-reverse'?{'x-data-version':'2099-01'}:{})}})})
 for(const endpoint of ['rank','insights'])await p.route('**/'+endpoint,async r=>{calls[endpoint]++;const response=await r.fetch({timeout:180000});const headers={...response.headers()};let body=await response.text();if(injecting){if(mode==='data-forward')headers['x-data-version']='2099-01';if(mode==='engine-only'){const data=JSON.parse(body);data.engine_version='mvp-0.5';body=JSON.stringify(data)}}await r.fulfill({response,headers,body})})
 await p.goto(url);await p.locator('.score-card').waitFor();await p.locator('.rank-card').getByRole('button',{name:'다시 분석',exact:true}).waitFor()
 const stale={analysis:await p.locator('.result__eyebrow').innerText(),rankItems:await p.locator('.rank-item').count(),timeCards:await p.locator('.time-card').count(),notice:await p.locator('.rank-card__status').innerText(),calls:{...calls}}
 await p.waitForTimeout(400);stale.callsAfterWait={...calls}
 await p.locator('.rank-card').scrollIntoViewIfNeeded();await p.screenshot({path:new URL(mode+'.png',import.meta.url).pathname.slice(1)})
 injecting=false;await p.locator('.rank-card').getByRole('button',{name:'다시 분석',exact:true}).click();await p.locator('.rank-item').first().waitFor();await p.locator('.time-card').waitFor()
 log.cases.push({mode,stale,recovered:{score:await p.locator('.overall__number').innerText(),rankItems:await p.locator('.rank-item').count(),timeCards:await p.locator('.time-card').count(),calls:{...calls}}});await p.close()
}
const p=await open();for(const endpoint of ['rank','insights'])await p.route('**/'+endpoint,r=>r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({detail:'Not Found'})}));await p.goto(url);await p.locator('.score-card').waitFor();await p.locator('.rank-card__retry').waitFor();log.previous404={score:await p.locator('.overall__number').innerText(),rankItems:await p.locator('.rank-item').count(),timeCards:await p.locator('.time-card').count()};await p.close()
fs.writeFileSync(new URL('browser.json',import.meta.url),JSON.stringify(log,null,2));console.log(JSON.stringify(log,null,2));await browser.close()
