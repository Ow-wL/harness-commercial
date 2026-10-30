import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  AnalyzeResponseSchema,
  EngineResultSchema,
  isAreaWeightedEngine,
  NearbyStoresResponseSchema,
  type AnalyzeResponse,
} from '../api/schemas.ts'
import { DataSources } from '../components/DataSources.tsx'
import { NearbyStores } from '../components/NearbyStores.tsx'
import { OverallScore } from '../components/OverallScore.tsx'
import { RADIUS_HELP, RADIUS_HELP_V05, RadiusControl } from '../components/RadiusControl.tsx'
import { ScoreReadingGuide } from '../components/ScoreGuide.tsx'
import { WarningPanel } from '../components/WarningPanel.tsx'
import { fillDataDates, PERSPECTIVE_GUIDE, perspectiveGuide } from '../content/scoreGuide.ts'
import pcV05Fixture from '../fixtures/bupyeong-pcbang-v05.json'
import schoolFixture from '../fixtures/school-zone-pcbang-v05.json'
import nearbyFixture from '../fixtures/bupyeong-pcbang-nearby.json'
import { singleBand } from './attentionBand.ts'
import { sameAreaNotice, sharedPerspectives } from './compare.ts'
import { effectiveSameCount, evidenceLine } from './evidence.ts'
import { calcUnitLabel, flagItems } from './flags.ts'
import { ResultCache } from './resultCache.ts'
import { SCORE_HELP, SCORE_HELP_V05_BASIS, SCORE_HELP_WHAT, SCORE_HELP_WHAT_V05, scoreHelp } from './scoreHelp.ts'
import { displayWarnings, isSchoolZoneWarning } from './warnings.ts'

/**
 * 엔진 v0.5(D-028) 화면 의미 — 실제 API 응답 fixture(v0.5 서버, 웹 경로 rent=null)
 *  - 부평역 PC방: 반경 인구·정확/실효 동종 수
 *  - 부평고등학교 북쪽 50m PC방: 학교구역 경고(엔진 경고[0])
 */
const PC = AnalyzeResponseSchema.parse(pcV05Fixture)
const SCHOOL = AnalyzeResponseSchema.parse(schoolFixture)
const NEARBY = NearbyStoresResponseSchema.parse(nearbyFixture)
const line = (r: AnalyzeResponse, key: string) => {
  const ind = r.result.지표.find((i) => i.key === key)!
  return evidenceLine(ind, r.context.gu_name, r.result.meta.업종, r.result.meta.분석반경_m)
}

describe('v0.5 근거 줄·계산 단위 — 고객성 인구와 경쟁성 잠재수요의 반경·기준', () => {
  it('부평역 PC방: 고객성은 반경 인구, 경쟁성은 정확 일치 수 + 실효 수 + 잠재수요 기준(거주+종사자)', () => {
    expect(PC.result.meta).toMatchObject({ 엔진버전: 'mvp-0.5', 분석반경_m: 500 })
    expect(line(PC, 'customer')).toBe('반경 500m 타겟 연령 거주 3,207명 · 비중 14.6%')
    expect(line(PC, 'competition')).toBe('반경 500m PC방 12곳 · 비슷한 가게까지 치면 약 15.6곳 · 가게 한 곳당 주변 주민·직장인 1,925명')
  })

  it('계산 단위: 고객성도 지점 반경(행정동 경계 면적 배분) — v0.3 응답은 그대로 "행정동 단위"', () => {
    expect(calcUnitLabel(PC.result.지표[1], 500)).toBe('지점 반경 500m (행정동 경계 면적 배분, 1인 세대 비중은 행정동 값)')
    expect(calcUnitLabel(PC.result.지표[1], 1000)).toContain('지점 반경 1km')
    const legacy = { ...PC.result.지표[1], raw: { ...PC.result.지표[1].raw, 인구_기준: undefined } }
    expect(calcUnitLabel(legacy, 500)).toBe('행정동 단위')
  })

  it('실효 동종 수는 정확 일치 수와 다를 때만 값(v0.3 응답·같을 때 undefined)', () => {
    expect(effectiveSameCount(PC.result.지표[2])).toBe(15.6)
    const raw = { ...PC.result.지표[2].raw, '동종점포수_실효(대체업종_포함)': 12 }
    expect(effectiveSameCount({ ...PC.result.지표[2], raw } as typeof PC.result.지표[2])).toBeUndefined()
  })

  it('지도 점포 목록 안내: 목록은 정확 일치 12곳, 실효 수는 계산에만 쓴다고 구분한다', () => {
    render(
      <NearbyStores
        state={{ status: 'success', data: NEARBY }}
        bizName="PC방"
        radiusM={500}
        expectedCount={PC.result.지표[2].raw.동종점포수}
        effectiveCount={effectiveSameCount(PC.result.지표[2])}
        show
        onShowChange={() => {}}
        activeId={null}
        onSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    expect(NEARBY.count).toBe(PC.result.지표[2].raw.동종점포수)
    expect(screen.getByText(/목록·지도에는 업종이 정확히 같은 점포 12곳만 보입니다/)).toHaveTextContent('약 15.6곳')
    expect(screen.queryByText(/목록 수.*다릅니다/)).toBeNull()               // 불일치 경고 없음(정확 일치끼리 비교)
  })
})

describe('v0.5 경고 — 엔진 순서대로 모두, 학교구역 경고를 맨 앞·강조', () => {
  it('fixture: 엔진이 학교구역 경고를 경고[0]에 둔다', () => {
    expect(isSchoolZoneWarning(SCHOOL.result.경고[0])).toBe(true)
    expect(SCHOOL.result.초보자_접근성.학교구역_200m_학교수).toBe(2)
    expect(flagItems(SCHOOL.result.지표[3]).map((f) => f.flag)).toContain('학교구역_학교_가점제외')
  })

  it('displayWarnings: 학교구역 경고 원문을 맨 앞에 그대로, 그 뒤 병목 경고만 구조화 문장으로 바꾼다', () => {
    expect(displayWarnings(SCHOOL)).toEqual(SCHOOL.result.경고)                 // 병목 없음 → 원문·순서 그대로
    const withBottleneck: AnalyzeResponse = structuredClone(SCHOOL)
    withBottleneck.result.지표[2].score = 20.1
    withBottleneck.result.종합.병목_지표 = 'competition'
    withBottleneck.result.경고.splice(1, 0, '경쟁성이(가) 인천 하위 20%로, 종합점수와 별개로 단일 병목입니다.')
    const shown = displayWarnings(withBottleneck)
    expect(shown[0]).toBe(SCHOOL.result.경고[0])
    expect(shown[1]).toMatch(/^경쟁성 점수가 20\.1점으로 주의 기준\(25점 미만\)/)
    expect(shown.slice(2)).toEqual(SCHOOL.result.경고.slice(1))
    expect(shown).toHaveLength(withBottleneck.result.경고.length)
  })

  it('주의할 점: 모든 엔진 경고를 엔진 순서로, 첫 항목은 "학교구역 주의" 강조 + 원문 + 확정하지 않는 안내', () => {
    render(<WarningPanel analysis={SCHOOL} />)
    const items = within(screen.getByRole('region', { name: '주의할 점' })).getAllByRole('listitem')
    expect(items.length).toBeGreaterThanOrEqual(SCHOOL.result.경고.length)
    expect(items[0]).toHaveClass('warnings__item--priority')
    expect(items[0]).toHaveTextContent('학교구역 주의 · 먼저 확인')
    expect(items[0]).toHaveTextContent(SCHOOL.result.경고[0]!)
    expect(items[0]).toHaveTextContent('이 안내가 허가 여부를 정하지 않습니다')
    SCHOOL.result.경고.slice(1).forEach((w, i) => expect(items[i + 1]).toHaveTextContent(w))
  })

  it('주의 요약 띠: 학교구역 줄이 첫 줄(위험 강조), 같은 엔진 경고를 "추가 확인"으로 다시 올리지 않는다', () => {
    const lines = singleBand(SCHOOL)
    expect(lines[0]).toMatchObject({ kind: 'school-zone', tone: 'warning', target: 'warnings' })
    expect(lines[0]!.text).toBe(
      '학교 200m 안 초·중·고 2곳 · 학교 주변 영업 규제 업종 — 점수와 별개로 영업 가능 여부를 먼저 확인하세요',
    )
    expect(lines.filter((l) => l.kind === 'other').some((l) => l.text.startsWith('⚠'))).toBe(false)
    expect(lines.map((l) => l.kind)).toContain('school')                     // 300m 학교 줄은 그대로
    expect(singleBand(PC).some((l) => l.kind === 'school-zone')).toBe(false)
  })
})

describe('v0.5 비교 기준·한계 문구', () => {
  it("[이 점수는?]: 첫 줄은 '무엇인지'(13-5), v0.5 는 158개 행정동 중심점 기준 한 줄을 더한다(v0.3·v0.4 는 기존 3항목)", () => {
    expect(scoreHelp('mvp-0.5')).toEqual([SCORE_HELP_WHAT_V05, SCORE_HELP[0], SCORE_HELP[1], SCORE_HELP_V05_BASIS, SCORE_HELP[2]])
    expect(scoreHelp('mvp-0.4')).toEqual([SCORE_HELP_WHAT, SCORE_HELP[0], SCORE_HELP[1], SCORE_HELP[2]])
    expect(SCORE_HELP_WHAT_V05).toMatch(/^인천의 동네 158곳 평균 지점과 비교해/)       // '무엇인지'로 시작(부정형 아님)
    render(<OverallScore summary={PC.result.종합} engineVersion="mvp-0.5" />)
    fireEvent.click(screen.getByRole('button', { name: '이 점수는?' }))
    const items = within(screen.getByRole('list', { name: '이 점수는?' })).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(scoreHelp('mvp-0.5'))
  })

  it('데이터 출처: 158개 행정동 중심점 대비·상업지 후보지 순위 아님, 고객성 반경 인구, 인구 배분 경계 2025년 2분기', () => {
    render(<DataSources meta={PC.result.meta} disclaimer={PC.result.면책} />)
    expect(screen.getByText(/상업지 후보지끼리의 순위가 아닙니다/)).toBeInTheDocument()
    expect(screen.getByText('지점 반경 500m 인구(행정동 경계 면적 배분), 1인 세대 비중은 행정동 값')).toBeInTheDocument()
    expect(screen.getByText('지점 반경 500m (잠재수요 = 거주인구 + 종사자)')).toBeInTheDocument()
    expect(screen.getByText('2025년 2분기')).toBeInTheDocument()
    expect(screen.getByText(`엔진 비교 기준 원문: ${PC.result.meta.정규화_기준}`)).toBeInTheDocument()
  })

  it('경쟁성 한계 첫 줄은 지정 문구 그대로, 집적도 백분위는 우수성·성공 가능성 순위가 아니라고 쓴다', () => {
    const g = perspectiveGuide('competition', 'mvp-0.5')
    expect(g.limits[0]).toBe(
      '번화가·신도시 상업지는 외부 방문객이 많아, 거주인구와 종사자를 기준으로 계산한 경쟁성(점포당 잠재수요)이 실제 수요를 충분히 반영하지 못할 수 있습니다.',
    )
    expect(g.limits.join(' ')).toContain('상권의 우수성이나 성공 가능성의 순위가 아닙니다')
    // 엔진 v0.4 는 기본 설명, v0.5 도 시장성은 기본 설명(사용 데이터 문장의 기준일 자리만 채운다, 9-C4)
    const base = (key: 'competition' | 'market') => ({ ...PERSPECTIVE_GUIDE[key], data: fillDataDates(PERSPECTIVE_GUIDE[key].data, null) })
    expect(perspectiveGuide('competition', 'mvp-0.4')).toEqual(base('competition'))
    expect(perspectiveGuide('market', 'mvp-0.5')).toEqual(base('market'))
  })

  it('반경 안내: v0.5 는 고객성도 반경을 따른다고 쓴다(v0.4 문구 "고객성은 바뀌지 않습니다"를 쓰지 않는다)', () => {
    const props = { options: [300, 500, 1000], value: 500, disabled: false, onChange: () => {} }
    const { unmount } = render(<RadiusControl {...props} engineVersion="mvp-0.5" />)
    expect(screen.getByText(RADIUS_HELP_V05)).toBeInTheDocument()
    expect(RADIUS_HELP_V05).toContain('고객성(반경 안 인구)')
    expect(RADIUS_HELP_V05).not.toContain('고객성·안정성·입지성은 바뀌지 않습니다')
    unmount()
    render(<RadiusControl {...props} engineVersion="mvp-0.4" />)
    expect(screen.getByText(RADIUS_HELP)).toBeInTheDocument()
  })

  it('엔진버전이 mvp-0.4 → mvp-0.5 로 바뀌면 결과 캐시를 모두 버린다', () => {
    const c = new ResultCache()
    const req = { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500 }
    const v04: AnalyzeResponse = structuredClone(PC)
    v04.result.meta.엔진버전 = 'mvp-0.4'
    c.putAnalyze({ ...req, lat: 37.5 }, v04)
    c.putAnalyze(req, PC)
    expect(c.engineVersion).toBe('mvp-0.5')
    expect(c.get({ ...req, lat: 37.5 })).toBeUndefined()
    expect(c.get(req)).toBeDefined()
  })
})

describe('v0.5 두 위치 비교 — 같은 행정동이어도 고객성은 위치마다 다르다(반경 인구)', () => {
  it('같은 동 A·B: 공유 관점은 시장성·안정성(구)뿐, 안내는 고객성·경쟁성·입지성 차이를 말한다', () => {
    const b: AnalyzeResponse = structuredClone(PC)
    b.context = { ...b.context, lat: 37.4901, lng: 126.7252 }
    expect(sharedPerspectives(PC, b).map((s) => [s.key, s.unit])).toEqual([
      ['market', '구'],
      ['stability', '구'],
    ])
    expect(sameAreaNotice(PC, b)).toContain('위치 차이는 고객성·경쟁성(반경 500m)과 입지성(좌표)에 나타납니다')
    expect(sameAreaNotice(PC, b)).not.toContain('고객성은 행정동 단위')
  })
})

describe('점수 읽는 법 — 1인 세대 민감도 설명은 엔진 버전에 맞게(v0.5 는 음수 민감도로 방향이 반대인 업종이 있다)', () => {
  const open = (version: string) => {
    const meta = { ...PC.result.meta, 엔진버전: version } as typeof PC.result.meta
    render(<ScoreReadingGuide summary={PC.result.종합} meta={meta} indicators={PC.result.지표} />)
    fireEvent.click(screen.getByRole('button', { name: '점수 읽는 법' }))
    return screen.getByRole('region', { name: '점수 읽는 법' }).textContent ?? ''
  }

  it.each(['mvp-0.5', 'mvp-0.5.1'])('%s: 가족형 업종은 1인 세대 비중이 높을수록 50점 아래, 종사자도 민감도만큼', (v) => {
    const text = open(v)
    expect(text).toContain('민감도가 음수인 가족형 업종(입시·교과학원·슈퍼마켓 등)은 방향이 반대라 1인 세대 비중이 높을수록 50점 아래로 내려갑니다')
    expect(text).toContain('종사자 수 점수도 업종 민감도만큼 50점 쪽으로 당긴 값')
    expect(text).not.toContain('1인 세대 비중은 업종에 따라 50점 쪽으로 당긴 값,')
  })

  it('v0.3·v0.4: 기존 문장 그대로', () => {
    const text = open('mvp-0.4')
    expect(text).toContain('1인 세대 비중은 업종에 따라 50점 쪽으로 당긴 값, 유인시설 근접도는 시설 종류별 점수의 평균입니다.')
    expect(text).not.toContain('가족형')
  })
})

describe('mvp-0.5.1(분동 배분 수정, D-029)은 v0.5와 같은 응답 형태·같은 화면 규칙', () => {
  it('schema: v0.5 필드를 가진 mvp-0.5.1 응답을 받고, v0.5 계열 판정은 0.5·0.5.1 만', () => {
    const r = structuredClone(PC.result)
    r.meta.엔진버전 = 'mvp-0.5.1'
    expect(EngineResultSchema.safeParse(r).success).toBe(true)
    expect(['mvp-0.3', 'mvp-0.4', 'mvp-0.5', 'mvp-0.5.1'].map(isAreaWeightedEngine)).toEqual([false, false, true, true])
    expect(scoreHelp('mvp-0.5.1')).toEqual(scoreHelp('mvp-0.5'))
    expect(perspectiveGuide('competition', 'mvp-0.5.1')).toEqual(perspectiveGuide('competition', 'mvp-0.5'))
    render(<DataSources meta={r.meta} disclaimer={r.면책} />)
    expect(screen.getByText('2025년 2분기')).toBeInTheDocument()
  })
})

describe('공개 화면에 지오비전 퍼즐 수치·원자료를 넣지 않는다', () => {
  const SRC = join(process.cwd(), 'src')
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (/\.(ts|tsx|json|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(join(d, e.name))
    }
  }
  walk(SRC)
  // 파일은 수집 단계에서 한 번만 읽는다 — 첫 케이스 안에서 읽으면 다른 테스트 파일과 동시에 돌 때 5초 제한을
  // 넘길 수 있었다(2026-10-28 배포 후보 전체 check, 기계 부하 중 2회 재현). 검사 대상·금지어는 그대로다
  const contents = files.map((f) => [f, readFileSync(f, 'utf-8')] as const)

  it.each(['지오비전', '퍼즐', 'SKT', '3~5배', '1/3~1/5', '18명', '외부방문자'])('"%s" 가 화면 소스·fixture 에 없다', (word) => {
    const hits = contents.filter(([, text]) => text.includes(word)).map(([f]) => f)
    expect(hits).toEqual([])
  })
})
