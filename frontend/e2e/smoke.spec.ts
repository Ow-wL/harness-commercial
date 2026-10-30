/**
 * 자동 E2E smoke (TASKS 5-3 B, D-035) — 배포 때 사람이 브라우저로 보던 흐름 중 실제 지도가 없어도 되는 것.
 * production build + 실제 backend(엔진 v0.5.1, 데이터 2026-06) + 가짜 NAVER SDK(e2e/fakeNaverSdk.ts).
 * 기대값은 운영 검증과 같은 부평역 PC방(500m 62.3, 1km 64.8)·학교 50m PC방(500m 67.2).
 */
import { expect, test, type Page } from '@playwright/test'
import { fakeNaverSdk, type FakeSdkMode } from './fakeNaverSdk.ts'

const BUPYEONG = { lat: '37.4894', lng: '126.7246' }
const SCHOOL_50M = { lat: '37.502726', lng: '126.727619' }

/** 가짜 SDK 를 끼우고 앱을 연다. 잡히지 않은 예외(pageerror)를 모아 돌려준다 — 콘솔 오류([map] …)는 의도된 기록이라 따로 본다 */
async function openApp(page: Page, mode: FakeSdkMode): Promise<string[]> {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.route('https://oapi.map.naver.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeNaverSdk(mode) }),
  )
  await page.goto('/')
  // 화면 크기와 무관하게 보이는 조건 바 버튼으로 준비를 확인한다(모바일 첫 화면은 지도·시트라 패널이 숨어 있다)
  await expect(page.getByRole('button', { name: /모드로 전환/ })).toBeVisible()
  return pageErrors
}

async function chooseCoordinates(page: Page, { lat, lng }: { lat: string; lng: string }) {
  await page.getByRole('button', { name: '좌표 입력' }).filter({ visible: true }).first().click()
  await page.getByPlaceholder('예: 37.4894').fill(lat)
  await page.getByPlaceholder('예: 126.7246').fill(lng)
  await page.getByPlaceholder('예: 126.7246').press('Enter')
}

async function analyzePcBang(page: Page) {
  const biz = page.getByRole('combobox', { name: '업종' })
  await expect(biz).toBeEnabled()                                       // 업종 목록(GET /businesses)을 받은 뒤
  await biz.selectOption('R10406')
  await page.getByRole('button', { name: '분석하기' }).click()
}

const overall = (page: Page) => page.getByRole('region', { name: '종합 적합도' })
const themeButton = (page: Page) => page.getByRole('button', { name: /모드로 전환/ })

test('단일 분석·반경 변경·데이터 기준일·테마 전환·업데이트 내역 (지도 SDK 동작)', async ({ page }) => {
  test.setTimeout(300_000)
  const pageErrors = await openApp(page, 'working')
  await expect(page.locator('.fake-naver-map')).toHaveCount(1)
  await chooseCoordinates(page, BUPYEONG)
  await analyzePcBang(page)
  await expect(page.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeVisible()
  await expect(overall(page)).toContainText('62.3')
  await expect(page.locator('.result__eyebrow')).toContainText('반경 500m · 데이터 묶음 2026-06')

  await page.locator('.bar').getByRole('button', { name: '1km', exact: true }).click()   // 결과 위 조건 바의 반경
  // 막 시작한 backend 의 첫 1km 분석은 면적 가중치 계산 때문에 약 1분 걸린다(docs/ENGINE_V0_5.md 8장) — 이 단계만 길게 기다린다
  await expect(page.locator('.result__eyebrow')).toContainText('반경 1km', { timeout: 180_000 })
  await expect(overall(page)).toContainText('64.8')

  for (let i = 0; i < 4; i++) {
    await themeButton(page).click()
    await expect(page.locator('.fake-naver-map')).toHaveCount(1)        // 지도는 하나로 다시 만들어진다
  }
  await expect(overall(page)).toContainText('64.8')                     // 결과 유지

  const updates = page.getByRole('button', { name: '업데이트 내역' })
  await updates.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '업데이트 내역' })
  await expect(dialog).toBeFocused()
  await expect(dialog).toContainText('지금 보고 있는 화면은')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(updates).toBeFocused()
  expect(pageErrors).toEqual([])
})

test('A/B 비교 — A 부평역, B 학교 50m (같은 데이터 버전)', async ({ page }) => {
  const pageErrors = await openApp(page, 'working')
  await chooseCoordinates(page, BUPYEONG)
  await analyzePcBang(page)
  await expect(overall(page)).toContainText('62.3')
  await page.getByRole('button', { name: '다른 위치와 비교' }).filter({ visible: true }).first().click()
  const bCard = page.getByRole('region', { name: 'B 비교 위치' })
  await bCard.getByLabel('B 위도').fill(SCHOOL_50M.lat)
  await bCard.getByLabel('B 경도').fill(SCHOOL_50M.lng)
  await bCard.getByRole('button', { name: 'B 위치로 선택' }).click()
  await bCard.getByRole('button', { name: 'B 분석하기' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '두 위치 비교 · PC방' })).toBeVisible()
  const head = page.locator('.compare .result__head')
  await expect(head).toContainText('62.3')
  await expect(head).toContainText('67.2')
  await expect(head).toContainText('규제 확인 필요')                          // 13-1: B(학교 50m)는 비교 머리에도 규제 배지
  await expect(head).toContainText('데이터 묶음 2026-06')
  expect(pageErrors).toEqual([])
})

test('모바일 375 — 분석 전 시트의 참고 주소는 보이고, 결과 시트에서는 숨긴다(production CSS)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const pageErrors = await openApp(page, 'working')
  await chooseCoordinates(page, BUPYEONG)
  const sheetAddress = page.locator('.map-sheet .reference-address')
  await expect(sheetAddress).toHaveCount(1)
  await expect(sheetAddress).toHaveCSS('display', 'block')
  await analyzePcBang(page)
  await page.getByRole('button', { name: '지도 보기' }).click()
  await expect(page.locator('.map-sheet__value')).toHaveText('62.3')
  await expect(sheetAddress).toHaveCSS('display', 'none')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  expect(pageErrors).toEqual([])
})

test('지도 인증 실패 — 테마 반복 전환에도 앱이 유지되고, 분석·비교·다시 불러오기가 된다 (D-030)', async ({ page }) => {
  const pageErrors = await openApp(page, 'auth-fail')
  const alert = page.locator('.map [role=alert]')
  await expect(alert).toContainText('지도 인증에 실패했습니다')
  for (let i = 0; i < 4; i++) await themeButton(page).click()
  await expect(alert).toContainText('지도 인증에 실패했습니다')
  await expect(page.getByRole('button', { name: '업데이트 내역' })).toBeVisible()

  await chooseCoordinates(page, BUPYEONG)
  await analyzePcBang(page)
  await expect(overall(page)).toContainText('62.3')
  await themeButton(page).click()
  await expect(overall(page)).toContainText('62.3')

  await page.getByRole('button', { name: '지도 다시 불러오기' }).click()
  await expect(alert).toContainText('지도 인증에 실패했습니다')
  await expect(overall(page)).toContainText('62.3')
  // 재시도는 SDK 경로 script 를 걷어 내고 새로 받는다 — 쌓이지 않는다(11-5)
  expect(await page.locator('script[src^="https://oapi.map.naver.com/openapi/v3/"]').count()).toBeLessThanOrEqual(1)
  expect(pageErrors).toEqual([])
})

test('1차 활용 — 공유 링크로 열기 · 반경별 표 · 현장 확인 탭 · 보관함 · 인쇄 버튼 · 장소 이름(키 없음) (12-3·26·27·25·15·14)', async ({ page }) => {
  test.setTimeout(300_000)
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.route('https://oapi.map.naver.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeNaverSdk('working') }),
  )
  // 공유 링크: 조건만 싣고 같은 조건으로 다시 분석한다(점수 없음). 첫 분석은 warm 전이라 길 수 있다
  await page.goto(`/?lat=${BUPYEONG.lat}&lng=${BUPYEONG.lng}&biz=R10406&r=500`)
  await expect(page.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('.share-notice')).toContainText('공유 링크의 조건으로 다시 분석했습니다')
  await expect(overall(page)).toContainText('62.3')
  await expect(page).toHaveURL(/\?lat=37\.4894&lng=126\.7246&biz=R10406&r=500&data=2026-06&engine=mvp-0\.5\.1$/)
  // 13-2(팀 A2): 결과 있는 링크 첫 로드에서 지도가 선택 지점·반경에 맞춰진다 — 중심 = 지점, zoom은 반경 원 기준(최소 zoom 6·100km가 아님)
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const m = (window as unknown as { __fakeMap?: { getCenter(): { lat(): number; lng(): number }; getZoom(): number } }).__fakeMap
        return m ? { lat: m.getCenter().lat(), lng: m.getCenter().lng(), zoom: m.getZoom() } : null
      }),
    )
    .toEqual({ lat: 37.4894, lng: 126.7246, zoom: expect.any(Number) })
  expect(await page.evaluate(() => (window as unknown as { __fakeMap: { getZoom(): number } }).__fakeMap.getZoom())).toBeGreaterThanOrEqual(13)
  await expect(overall(page)).toContainText('보통')                           // 13-4 등급 글자(62.3 → 보통)
  await expect(page.getByRole('button', { name: '링크 복사' })).toBeVisible()
  await expect(page.getByRole('button', { name: '인쇄' })).toBeVisible()      // 인쇄 대화상자는 열지 않는다

  // 반경별 비교 표: 지금 반경만 채워지고 나머지는 "분석하기"
  const table = page.getByRole('table', { name: /반경별 종합/ })
  await expect(table).toContainText('500m · 지금62.3')
  await expect(table.getByRole('button', { name: '300m 분석하기' })).toBeVisible()
  await expect(table.getByRole('button', { name: '1km 분석하기' })).toBeVisible()

  // 현장 확인 탭: 카드 3장, 확인함 → 이 브라우저에 저장
  await page.getByRole('tab', { name: /현장 확인/ }).click()
  await expect(page.locator('.field-check')).toHaveCount(3)
  await page.getByRole('checkbox', { name: '확인함' }).first().check()

  // 보관함: 저장 당시 결과 라벨, 현장 확인 진행
  await page.getByRole('button', { name: '보관', exact: true }).click()
  await expect(page.getByRole('button', { name: '보관함 1곳' })).toBeVisible()
  await page.getByRole('button', { name: '보관함 1곳' }).click()
  const dialog = page.getByRole('dialog', { name: '후보 보관함' })
  await expect(dialog).toContainText('저장 당시 결과')
  await expect(dialog).toContainText('데이터 묶음 2026-06 · 엔진 mvp-0.5.1')
  await expect(dialog).toContainText('현장 확인 1/3 확인함')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // 장소 이름 검색: 이 backend 에는 검색 키가 없다 → /health 가 끔을 광고하고 입력 방법에 없다, /places 는 503
  const health = await (await page.request.get('/health')).json()
  expect(health.places).toEqual({ enabled: false })
  expect((await page.request.post('/places', { data: { q: '부평역' } })).status()).toBe(503)
  await page.getByRole('button', { name: /바꾸기/ }).click()
  await expect(page.getByRole('group', { name: '위치 입력 방법' }).first()).toBeVisible()
  await expect(page.getByRole('group', { name: '위치 입력 방법' }).first()).not.toContainText('장소 이름')
  await expect(page).toHaveURL(/\/$/)                                      // 결과가 없으면 쿼리도 없다
  expect(pageErrors).toEqual([])
})
