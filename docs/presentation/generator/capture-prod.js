// 다크 테마 화면 캡처 (실제 NAVER 지도, 로컬 dev 서버) — Playwright chromium
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const OUT = path.join(__dirname, process.env.OUT || "shots-prod");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || "https://harness-commercial.web.app";
const A = "lat=37.4894&lng=126.7246&biz=I21201&r=500"; // 부평역 카페
const B = "blat=37.3915&blng=126.6397"; // 송도2동 부근

async function prep(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("onboarding", "done");
      localStorage.setItem("onboarding.result", "done");
    } catch {}
  });
}
async function waitMap(page, ms = 9000) {
  // 지도 타일·GL 스타일이 뜰 시간
  await page.waitForTimeout(ms);
}
async function shot(page, name) {
  const p = path.join(OUT, name + ".png");
  await page.screenshot({ path: p, type: "png" });
  console.log("saved", p);
}

(async () => {
  const browser = await chromium.launch();
  // ---- 데스크톱 1440×900 ----
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await prep(ctx);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 160)); });

  // 1) 시작 화면
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await waitMap(page);
  await shot(page, "start-dark");

  // 2) 결과 대시보드 — 시트 올림
  await page.goto(`${BASE}/?${A}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-layout="dashboard"]', { timeout: 60000 }).catch(() => console.log("no dashboard layout"));
  await waitMap(page, 10000);
  await shot(page, "result-dark-up");

  // 3) 결과 — 시트 내림(지도 크게 보기)
  const down = page.getByRole("button", { name: "지도 크게 보기" });
  if (await down.count()) {
    await down.first().click();
    await page.waitForTimeout(1500);
    await shot(page, "result-dark-down");
    const up = page.getByRole("button", { name: "대시보드 올리기" });
    if (await up.count()) { await up.first().click(); await page.waitForTimeout(800); }
  } else console.log("no sheet handle button");

  // 4) 두 위치 비교
  await page.goto(`${BASE}/?${A}&${B}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(12000);
  await shot(page, "compare-dark");

  // 5) 결과 아래쪽(업종 순위·탭) — 시트 안을 스크롤
  await page.goto(`${BASE}/?${A}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(9000);
  const rank = page.getByText("점수가 높은 업종").first();
  if (await rank.count()) { await rank.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); await shot(page, "result-dark-rank"); }
  await page.waitForTimeout(12000); // AI 요약 생성 대기
  const ai = page.getByText("AI 요약", { exact: true }).first();
  if (await ai.count()) { await ai.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); await shot(page, "result-dark-ai"); } else console.log("no AI card");
  const sup = page.getByText("조건에 맞는 지원사업").first();
  if (await sup.count()) { await sup.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); await shot(page, "result-dark-support"); } else console.log("no support card");
  await ctx.close();

  // ---- 모바일 390×844 ----
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await prep(m);
  const mp = await m.newPage();
  await mp.goto(`${BASE}/?${A}`, { waitUntil: "networkidle" });
  await mp.waitForTimeout(10000);
  await shot(mp, "mobile-dark");
  await m.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
