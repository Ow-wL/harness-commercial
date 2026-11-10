// 운영 사이트에서 AI 요약 카드·지원사업 카드를 카드 맨 위가 보이게 다시 캡처
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const OUT = path.join(__dirname, "shots-prod");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "https://harness-commercial.web.app";
const A = "lat=37.4894&lng=126.7246&biz=I21201&r=500";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); localStorage.setItem("onboarding", "done"); localStorage.setItem("onboarding.result", "done"); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?${A}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-layout="dashboard"]', { timeout: 60000 });
  await page.waitForTimeout(16000); // AI 요약 생성·지원사업 로드 대기
  const headings = await page.locator("h1,h2,h3,h4").allInnerTexts();
  console.log("headings:", headings.filter((t) => /AI 요약|지원사업|시간대|업종/.test(t)));
  async function top(sel, name) {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) { console.log("not found", sel); return; }
    await loc.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => { const sc = document.querySelector('[data-layout="dashboard"] [class*="sheet"]'); if (sc) sc.scrollBy(0, -16); });
    await page.waitForTimeout(900);
    const p = path.join(OUT, name + ".png");
    await page.screenshot({ path: p });
    console.log("saved", p);
  }
  await top("h2:has-text('AI 요약'), h3:has-text('AI 요약')", "result-dark-ai");
  await top("h2:has-text('조건에 맞는 지원사업'), h3:has-text('조건에 맞는 지원사업')", "result-dark-support");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
