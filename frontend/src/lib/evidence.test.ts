import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from '../fixtures/bupyeong-pcbang.json'
import nail from '../fixtures/bupyeong-nailshop.json'
import songdo from '../fixtures/compare-songdo-pcbang.json'
import ganghwa from '../fixtures/compare-ganghwa-pcbang.json'
import { AnalyzeResponseSchema, EngineResultSchema, type EngineResult } from '../api/schemas.ts'
import { evidenceLine } from './evidence.ts'
import { formatDistance, formatRadius, type Indicator } from './format.ts'

/** 8-C1b 근거 줄 (docs/UX_REDESIGN.md 2.5) — 실제 응답 fixture + golden v0.3 29개 */
const res = (fx: unknown) => AnalyzeResponseSchema.parse(fx)
const lines = (fx: unknown) => {
  const r = res(fx)
  return Object.fromEntries(r.result.지표.map((i) => [i.key, evidenceLine(i, r.context.gu_name, r.result.meta.업종)]))
}
const FORBIDDEN = /순위|상위\s*\d+\s*%|하위\s*\d+\s*%|백분위|확률|추천|가장|높음|낮음/

describe('evidenceLine — 실제 응답 fixture', () => {
  it('부평역 PC방: 다섯 관점 근거 줄 — 공간 단위는 줄에 쓰지 않는다(12-18부터 자료 단위 칩이 맡는다)', () => {
    expect(lines(pc)).toEqual({
      market: '부평구 하루 유입 679,748명',
      customer: '타겟 연령 거주 5,290명 · 비중 15.4%',
      competition: '반경 500m PC방 12곳 · 점포당 잠재수요 4,433명',
      location: '부평역까지 직선거리 85m',
      stability: '3년 생존율 52.3%',
    })
  })

  it('부평역 네일숍: 미산출 안정성은 근거 줄 없음(null — 기존 미산출 안내 자리)', () => {
    const l = lines(nail)
    expect(l.competition).toBe('반경 500m 네일숍 125곳 · 점포당 잠재수요 426명')
    expect(l.stability).toBeNull()
  })

  it('송도2동 PC방: 동종 0곳으로 미산출인 경쟁성은 null, 강화읍 직선거리 16,152m는 m 그대로(천 단위 구분)', () => {
    expect(lines(songdo).competition).toBeNull()
    const station = res(ganghwa).result.지표[3].raw.최근접역
    expect(lines(ganghwa).location).toBe(`${station}역까지 직선거리 16,152m`)
  })

  it('반경 1km 응답이면 경쟁성 근거 줄도 그 반경', () => {
    const r = res(pc)
    const c = structuredClone(r.result.지표[2]) as Indicator & { raw: { 반경m: number } }
    c.raw.반경m = 1000                                                   // 표시 테스트 전용
    expect(evidenceLine(c, '부평구', 'PC방')).toMatch(/^반경 1km PC방 /)
  })
})

describe('evidenceLine — golden v0.3 29개: raw 값 포맷만(재계산 없음)', () => {
  // jsdom 환경의 import.meta.url은 file URL이 아니라 vitest 실행 위치(frontend/)를 기준으로 한다(layout.test.ts와 같은 방식)
  const GOLDEN_DIR = join(process.cwd(), '..', 'tests', 'golden', 'v0.3', 'json')
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'))
  const golden = files.map((f) => [f, EngineResultSchema.parse(JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf-8')))] as const)

  /** 이 관점 raw 값을 근거 줄과 같은 방식으로 포맷한 숫자 문자열들(쉼표 포함) — 줄에 나오는 숫자는 이 안에만 있어야 한다 */
  function allowedNumbers(ind: Indicator): Set<string> {
    const nums = new Set<string>()
    const add = (v: number | null | undefined, kind: 'count' | 'percent' | 'distance' | 'radius') => {
      if (v === null || v === undefined) return
      if (kind === 'count') nums.add(Math.round(v).toLocaleString('ko-KR'))
      if (kind === 'percent') nums.add((v * 100).toFixed(1))
      if (kind === 'distance') nums.add(formatDistance(v).replace(/m$/, ''))
      if (kind === 'radius') nums.add(formatRadius(v).replace(/k?m$/, ''))
    }
    const raw = ind.raw as Record<string, number | null>
    switch (ind.key) {
      case 'market':
        add(raw.일평균_유입인구, 'count')
        break
      case 'customer':
        add(raw.타겟연령_거주인구, 'count')
        add(raw.타겟연령_비중, 'percent')
        break
      case 'competition':
        add(raw.반경m, 'radius')
        add(raw.동종점포수, 'count')
        add(raw.점포당_잠재수요, 'count')
        break
      case 'location':
        add(raw.최근접역_거리m, 'distance')
        break
      case 'stability':
        add(raw['3년_생존율'], 'percent')                          // 기준선(인천_업종평균_3년생존율)은 근거 줄에 쓰지 않는다 (12-16)
        break
    }
    return nums
  }

  it('golden JSON 29개를 읽는다', () => {
    expect(golden).toHaveLength(29)
  })

  it.each(golden)('%s — 산출 관점마다 근거 줄이 있고, 숫자는 그 관점 raw 값의 포맷뿐이다', (_, result: EngineResult) => {
    for (const ind of result.지표) {
      const line = evidenceLine(ind, '부평구', result.meta.업종)
      if (ind.score === null) {
        expect(line).toBeNull()
        continue
      }
      expect(line, `${ind.key}`).not.toBeNull()
      const allowed = allowedNumbers(ind)
      // 고정 라벨("3년 생존율")과 업종 이름(숫자가 들어갈 수 있음)은 빼고 값 숫자만 본다
      const numbers = line!.replace(result.meta.업종, '').replace('3년 생존율', '생존율').match(/\d[\d,]*(?:\.\d+)?/g) ?? []
      for (const n of numbers) expect(allowed, `${ind.key}: ${line}`).toContain(n)
      expect(line).not.toMatch(FORBIDDEN)
      expect(line).not.toContain('단위')                               // 공간 단위는 칩(unitChipLabel)이 맡는다 (12-18)
    }
  })
})
