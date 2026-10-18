import { render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import { WarningPanel } from '../components/WarningPanel.tsx'
import ganghwaFixture from '../fixtures/compare-ganghwa-pcbang.json'
import guwolFixture from '../fixtures/compare-guwol-pcbang.json'
import songdoFixture from '../fixtures/compare-songdo-pcbang.json'
import { dataLimits, displayWarnings } from './warnings.ts'

const GUWOL = AnalyzeResponseSchema.parse(guwolFixture)      // 병목 경쟁성 24.4 < 25 + 학교 경고
const GANGHWA = AnalyzeResponseSchema.parse(ganghwaFixture)  // 안정성 미산출
const SONGDO = AnalyzeResponseSchema.parse(songdoFixture)    // 경쟁성 미산출(동종 점포 0곳)

describe('lib/warnings — WarningPanel에서 옮긴 규칙 (동작 그대로, 비교에서 위치별로 재사용)', () => {
  it('병목 경고(경고[0])만 구조화된 문장으로 바꾸고, 나머지 엔진 경고는 원문 그대로 둔다', () => {
    const warnings = displayWarnings(GUWOL)
    expect(GUWOL.result.경고[0]).toMatch(/^경쟁성이\(가\) 인천 하위 /)
    expect(warnings[0]).toBe(
      '경쟁성 점수가 24.4점으로 병목 기준(25점 미만)에 해당합니다. 종합 점수와 별개로 이 관점이 실제 위험 요인일 수 있습니다.',
    )
    expect(warnings.slice(1)).toEqual(GUWOL.result.경고.slice(1))       // 학교 주변 경고 원문
  })

  it('데이터 한계: 신뢰도 낮음·임대료 제외를 위치의 실제 값으로 만든다 — 해상도 줄은 8-C1b부터 근거 줄 끝 "· 구 단위"', () => {
    const s4 = SONGDO.result.지표[4].breakdown.find((b) => b.key === 's4')!
    expect(dataLimits(SONGDO).map((n) => [n.tone, n.text])).toEqual([
      ['warning', '경쟁성: 신뢰도 낮음'],
      ['info', `이 위치는 임대료 조사 상권이 지정되지 않아 안정성의 '${s4.label}' 지표를 제외하고 계산했습니다.`],
    ])
    for (const analysis of [GUWOL, GANGHWA, SONGDO]) {
      expect(dataLimits(analysis).some((n) => n.text.includes('단위 데이터로 계산했습니다'))).toBe(false)
    }
  })

  it('WarningPanel은 이 함수들의 결과를 그대로 보인다', () => {
    for (const analysis of [GUWOL, GANGHWA, SONGDO]) {
      const { unmount } = render(createElement(WarningPanel, { analysis }))
      const lists = within(screen.getByRole('region', { name: '주의할 점' })).getAllByRole('list')
      const shown = lists.flatMap((l) => within(l).getAllByRole('listitem').map((li) => li.textContent))
      expect(shown).toEqual([...displayWarnings(analysis), ...dataLimits(analysis).map((n) => n.text)])
      unmount()
    }
  })
})
