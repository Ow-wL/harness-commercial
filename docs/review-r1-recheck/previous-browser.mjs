import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {chromium}=require('@playwright/test'),ts=require('typescript')
const src=fs.readFileSync(new URL('../../frontend/e2e/fakeNaverSdk.ts',import.meta.url),'utf8')
const {fakeNaverSdk}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'))
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1366,height:768}})
const errors=[],responses=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(180000)
await page.route('https://oapi.map.naver.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:fakeNaverSdk('working')}))
await page.route(/http:\/\/127\.0\.0\.1:5173\/(health|businesses|analyze|nearby-stores|rank|insights|stations|places)(\?|$)/,async r=>{const response=await r.fetch({url:r.request().url().replace(':5173/',':8001/'),timeout:180000});responses.push({endpoint:new URL(r.request().url()).pathname,status:response.status()});await r.fulfill({response})})
await page.goto('http://127.0.0.1:5173/?lat=37.4894&lng=126.7246&biz=R10406&r=500');await page.locator('.score-card').waitFor();await page.waitForTimeout(300)
const log={backendSource:'c9a2f08 main.py, in-memory module; current unchanged engine',score:await page.locator('.overall__number').innerText(),timeCards:await page.locator('.time-card').count(),responses,errors}
fs.writeFileSync(new URL('previous-browser.json',import.meta.url),JSON.stringify(log,null,2));console.log(JSON.stringify(log,null,2));await browser.close()
