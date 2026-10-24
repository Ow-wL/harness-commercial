// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EngineResultSchema, type EngineResult } from '../api/schemas.ts'
import { calcUnitLabel, FLAG_TEXT, flagItems } from './flags.ts'

/** 8-C1d flags·계산 단위 한글화 (docs/UX_REDESIGN.md 2.4·2.5) */
const ROOT = join(process.cwd(), '..')
const scoringPy = (v: string) => readFileSync(join(ROOT, 'scoring_engine', v, 'scoring.py'), 'utf-8')

/** 엔진이 내는 flag 문자열 전체: scoring.py의 flags.append("…") + 해상도_저하__{FALLBACK_LADDER 레벨} + service.py MARKET_FLAG */
function engineFlags(v: string): Set<string> {
  const src = scoringPy(v)
  const literal = [...src.matchAll(/flags\.append\("([^"{}]+)"\)/g)].map((m) => m[1]!)
  const ladder = src.slice(src.indexOf('FALLBACK_LADDER = ['), src.indexOf(']', src.indexOf('FALLBACK_LADDER = [')))
  const levels = [...ladder.matchAll(/\("([a-z_]+)",/g)].map((m) => m[1]!)
  // 엔진은 가장 세밀한 레벨(dong_sobun)이면 해상도 flag를 붙이지 않는다 — 이 조건이 바뀌면 테스트가 알린다
  expect(src).toMatch(/if level != "dong_sobun":\s+flags\.append\(f"해상도_저하__\{level\}"\)/)
  const service = readFileSync(join(ROOT, 'scoring_engine', 'service.py'), 'utf-8')
  const market = service.match(/MARKET_FLAG = "([^"]+)"/)![1]!
  return new Set([...literal, ...levels.filter((l) => l !== 'dong_sobun').map((l) => `해상도_저하__${l}`), market])
}

describe('FLAG_TEXT — 엔진 flag 문자열과 일치', () => {
  it('엔진 v0_3·v0_4·v0_5가 낼 수 있는 flag 전체의 합집합과 키 집합이 같다(빠짐·지어낸 키 없음)', () => {
    const all = new Set(['v0_3', 'v0_4', 'v0_5'].flatMap((v) => [...engineFlags(v)]))
    expect(new Set(Object.keys(FLAG_TEXT))).toEqual(all)
  })

  it('v0_3·v0_4는 같은 flag, v0_5는 학교구역 flag 하나만 더 낸다(D-028)', () => {
    expect(engineFlags('v0_4')).toEqual(engineFlags('v0_3'))
    const added = [...engineFlags('v0_5')].filter((f) => !engineFlags('v0_3').has(f))
    expect(added).toEqual(['학교구역_학교_가점제외'])
    expect([...engineFlags('v0_3')].every((f) => engineFlags('v0_5').has(f))).toBe(true)
  })

  it('해상도 flag는 특이사항에서 뺀다(근거 줄 "· 구 단위"·계산 단위 줄과 중복), 나머지는 라벨·설명이 있다', () => {
    for (const [flag, text] of Object.entries(FLAG_TEXT)) {
      if (flag.startsWith('해상도_')) expect(text).toBeNull()
      else expect(text?.label.length).toBeGreaterThan(0)
    }
  })
})

describe('flagItems · calcUnitLabel — golden v0.3 29개', () => {
  const dir = join(ROOT, 'tests', 'golden', 'v0.3', 'json')
  const golden: EngineResult[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => EngineResultSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf-8'))))

  it('알려진 flag는 라벨, 모르는 flag는 원문 그대로(지어내지 않음)', () => {
    const ind = { ...golden[0]!.지표[0], flags: ['영업시간대_유입_집중', '해상도_시군구', '새로운_flag'] }
    expect(flagItems(ind)).toEqual([
      { kind: 'known', flag: '영업시간대_유입_집중', text: FLAG_TEXT['영업시간대_유입_집중'] },
      { kind: 'raw', flag: '새로운_flag' },
    ])
  })

  it('golden 응답의 모든 flag는 알려진 flag다(원문으로 떨어지는 것 없음)', () => {
    for (const r of golden) for (const ind of r.지표) expect(flagItems(ind).every((i) => i.kind === 'known')).toBe(true)
  })

  it('계산 단위는 엔진 원문(gugu_sobun 등) 대신 화면 말, 경쟁성·입지성은 반경·좌표, incheon_avg 미산출은 "구 표본 30건 미만"', () => {
    const seen = new Map<string, string>()
    for (const r of golden) for (const ind of r.지표) seen.set(`${ind.key}:${ind.fallback}:${ind.score === null}`, calcUnitLabel(ind, 500))
    expect(Object.fromEntries(seen)).toEqual({
      'market:gugu:false': '구 단위',
      'customer:dong_sobun:false': '행정동 단위',
      'competition:dong_sobun:false': '지점 반경 500m',
      'location:dong_sobun:false': '지점 좌표',
      'stability:gugu_sobun:false': '구 × 업종 단위',
      'stability:gugu_sobun:true': '산출하지 않음',
      'stability:incheon_avg:true': '구 표본 30건 미만 → 산출하지 않음',
    })
    for (const label of seen.values()) expect(label).not.toMatch(/[a-z_]{4,}/)      // 엔진 원문 코드가 화면에 나오지 않는다
  })
})
