import {createRequire} from 'node:module'
import fs from 'node:fs'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {chromium}=require('@playwright/test'),ts=require('typescript')
const source=fs.readFileSync(new URL('../../frontend/e2e/fakeNaverSdk.ts',import.meta.url),'utf8')
const {fakeNaverSdk}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'))
const out=new URL('./',import.meta.url),root=new URL('../../',import.meta.url)
const browser=await chromium.launch({headless:true,channel:'chrome'})
const url='http://127.0.0.1:5173/?lat=37.4894&lng=126.7246&biz=R10406&r=500'
const log={errors:[]}
async function open(width,height){const p=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});p.setDefaultTimeout(30000);p.on('pageerror',e=>log.errors.push(e.message));await p.route('https://oapi.map.naver.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:fakeNaverSdk('working')}));return p}
const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}}
for(const width of [640,768,958]){
 const p=await open(width,800);await p.goto(url);await p.locator('.score-card').waitFor();await p.waitForTimeout(200)
 const hit=await p.locator('.bar button').evaluateAll(es=>es.filter(e=>['300m','500m','1km'].includes(e.textContent)||/모드로 전환|보관함/.test(e.getAttribute('aria-label')||e.textContent)).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.textContent,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}))
 await p.locator('.bar').getByRole('button',{name:'300m',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.result__eyebrow')?.textContent.includes('300m'))
 await p.locator('.bar').getByRole('button',{name:'500m',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.result__eyebrow')?.textContent.includes('500m'))
 await p.getByRole('button',{name:'다크 모드로 전환'}).click();const dark=await p.locator('html').getAttribute('data-theme')
 await p.getByRole('button',{name:'라이트 모드로 전환'}).click()
 await p.locator('.bar').getByRole('button',{name:/^보관함/}).click();const saved=await p.getByRole('dialog',{name:'후보 보관함'}).isVisible();await p.keyboard.press('Escape')
 log['tablet'+width]={hit,radiusClicks:true,dark,saved};await p.screenshot({path:new URL(`tablet-${width}.png`,out).pathname.slice(1)});await p.close()
}
const p=await open(1366,768);await p.goto(url);await p.locator('.score-card').waitFor();await p.locator('.rank-item').first().waitFor();await p.locator('.time-card').waitFor()
log.desktop=await p.evaluate(()=>{const panel=document.querySelector('.workspace__panel').getBoundingClientRect();return {panelBottom:panel.bottom,rows:[...document.querySelectorAll('.perspective')].map(e=>({key:e.dataset.key,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,fullyVisible:e.getBoundingClientRect().bottom<=panel.bottom&&e.getBoundingClientRect().top>=panel.top}))}})
await p.screenshot({path:new URL('desktop.png',out).pathname.slice(1)})
log.keyboard=[]
for(const key of ['Enter','Space']){await p.locator('#map-card-expand').focus();await p.keyboard.press(key);const expanded=await p.evaluate(()=>document.activeElement.id);await p.keyboard.press('Tab');const tab=await p.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName}));await p.locator('#map-card-collapse').focus();await p.keyboard.press(key);const returned=await p.evaluate(()=>document.activeElement.id);log.keyboard.push({key,expanded,tab,returned})}
await p.locator('.workspace__panel').evaluate(e=>e.scrollTop=600);await p.locator('#map-card-pill').waitFor();const scrollBefore=await p.locator('.workspace__panel').evaluate(e=>e.scrollTop)
await p.locator('#map-card-pill').focus();await p.keyboard.press('Enter');await p.locator('#map-card-collapse').focus();await p.keyboard.press('Space');log.scrolledFocus={before:scrollBefore,after:await p.locator('.workspace__panel').evaluate(e=>e.scrollTop),active:await p.evaluate(()=>document.activeElement.id)}
await p.locator('.workspace__panel').evaluate(e=>e.scrollTop=0)
await p.emulateMedia({media:'print'})
log.print=await p.evaluate(()=>({evidence:[...document.querySelectorAll('.perspective__evidence')].map(e=>({display:getComputedStyle(e).display,text:e.textContent})),headPaddingRight:getComputedStyle(document.querySelector('.result__head')).paddingRight,headMinHeight:getComputedStyle(document.querySelector('.result__head')).minHeight,order:getComputedStyle(document.querySelector('.result__order')).display,rankToggle:getComputedStyle(document.querySelector('.rank-card__toggle')).display}))
fs.mkdirSync(new URL('output/pdf/',root),{recursive:true})
await p.pdf({path:new URL('output/pdf/r1-v010-recheck.pdf',root).pathname.slice(1),format:'A4',printBackground:true,preferCSSPageSize:true})
await p.emulateMedia({media:'screen'});await p.close()
const m=await open(375,812);await m.goto(url);await m.locator('.score-card').waitFor();log.mobile=await m.evaluate(()=>({firstRow:document.querySelector('.perspective').getBoundingClientRect().top,radar:document.querySelector('.radar').getBoundingClientRect().top,listBeforeRadar:!!(document.querySelector('.perspectives').compareDocumentPosition(document.querySelector('.radar'))&Node.DOCUMENT_POSITION_FOLLOWING)}));await m.screenshot({path:new URL('mobile.png',out).pathname.slice(1)});await m.close()
const old=await open(1366,768);await old.route('**/insights',r=>r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({detail:'Not Found'})}));await old.goto(url);await old.locator('.score-card').waitFor();await old.waitForTimeout(400);log.oldServer={score:await old.locator('.overall__number').innerText(),timeCards:await old.locator('.time-card').count(),hasAnalysis:await old.locator('.result').count()};await old.close()
const retry=await open(1366,768);let attempts=0;await retry.route('**/rank',r=>++attempts===1?r.abort('failed'):r.continue());await retry.goto(url);await retry.locator('.rank-card__retry').waitFor();await retry.locator('.rank-card__retry').evaluate(e=>{e.click();e.click()});await retry.locator('.rank-item').first().waitFor();log.retry={attempts,items:await retry.locator('.rank-item').count()};await retry.close()
const mixed=await open(1366,768);const versions=[];for(const endpoint of ['rank','insights'])await mixed.route('**/'+endpoint,async r=>{const response=await r.fetch();versions.push({endpoint,original:response.headers()['x-data-version'],injected:'2099-01'});await r.fulfill({response,headers:{...response.headers(),'x-data-version':'2099-01'}})});await mixed.goto(url);await mixed.locator('.score-card').waitFor();await mixed.locator('.rank-item').first().waitFor();await mixed.locator('.time-card').waitFor();log.versionMismatch={versions,analysisLabel:await mixed.locator('.result__eyebrow').innerText(),rankShown:await mixed.locator('.rank-item').count(),timeShown:await mixed.locator('.time-card').count()};await mixed.close()
fs.writeFileSync(new URL('browser.json',out),JSON.stringify(log,null,2));console.log(JSON.stringify(log,null,2));await browser.close()
