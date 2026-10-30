/**
 * 현장 확인 카드 규칙 (계획 1-4, 12-27): 지금 결과의 지표·결측에 연결한 **규칙형** 카드 — "이 결과가 보지 못한 것을 현장에서 무엇으로
 * 확인할지". 엔진 값은 그대로 인용하고(재계산 없음), 지표가 확인하지 않은 사실(예: "임대료가 비싸다")은 단정하지 않는다.
 * 규칙은 우선순위 순서이며 맞는 것 중 앞의 FIELD_CHECK_COUNT 개만 보인다. 문장은 테스트(content/fieldChecks.test.ts)가 고정한다.
 * 완료 체크·메모는 lib/fieldNotes(로컬 저장)에 두고 보관함(12-25)이 같은 키로 읽는다.
 */
import type { AnalyzeResponse } from '../api/schemas.ts'
import { demandIncludesWorkers, isRadiusPopulation, percent } from '../lib/evidence.ts'
import { formatDistance, formatRadius, type Indicator } from '../lib/format.ts'
import { isSchoolZoneWarning } from '../lib/warnings.ts'

export type FieldCheck = {
  id: string
  title: string
  /** 이 카드를 보이는 근거 — 결과의 엔진 값·결측을 그대로 인용한 한 줄 */
  because: string
  /** 현장에서 기록할 것 */
  record: readonly string[]
}

type Rule = {
  id: string
  when: (a: AnalyzeResponse) => boolean
  title: string
  because: (a: AnalyzeResponse) => string
  record: readonly string[]
}

export const FIELD_CHECK_COUNT = 3

const count = (n: number) => Math.round(n).toLocaleString('ko-KR')
const guLevel = (ind: Indicator) =>
  ind.score !== null && (ind.fallback === 'gugu' || ind.fallback === 'gugu_sobun' || ind.flags.includes('해상도_시군구'))
const indicators = (a: AnalyzeResponse) => {
  const [market, customer, competition, location, stability] = a.result.지표
  return { market, customer, competition, location, stability }
}
const rentExcluded = (a: AnalyzeResponse) => {
  const { stability } = indicators(a)
  const s4 = stability.breakdown.find((b) => b.key === 's4')
  return a.context.rent_area === null && stability.score !== null && s4 !== undefined && s4.score === null
}

export const FIELD_CHECK_RULES: readonly Rule[] = [
  {
    id: 'school-zone',
    when: (a) => isSchoolZoneWarning(a.result.경고[0]),
    title: '학교 주변 영업 가능 여부 확인',
    because: () => '학교 주변 영업 규제 업종이고 가까운 곳에 학교가 있다는 엔진 경고가 있습니다(상세 근거 · 주의할 점)',
    record: [
      '관할 교육지원청에 이 주소의 교육환경보호구역 해당 여부와 영업 가능 여부 문의',
      '가장 가까운 학교 정문까지 실제로 걸은 거리',
      '문의한 날짜·담당 부서·답변 내용',
    ],
  },
  {
    id: 'competitors',
    when: (a) => {
      const { competition } = indicators(a)
      return competition.score !== null && competition.raw.동종점포수 > 0
    },
    title: '가까운 같은 업종 점포 둘러보기',
    because: (a) => {
      const { competition } = indicators(a)
      const raw = competition.raw
      const demand =
        raw.점포당_잠재수요 !== null ? ` · 가게 한 곳당 주변 ${demandIncludesWorkers(competition) ? '주민·직장인' : '주민'} ${count(raw.점포당_잠재수요)}명` : ''
      return `반경 ${formatRadius(raw.반경m)} 안 ${a.result.meta.업종} ${raw.동종점포수.toLocaleString('ko-KR')}곳${demand} — 점포 목록은 주변 점포 탭`
    },
    record: [
      '가까운 5곳의 가격대·좌석(규모)·영업시간',
      '포장·배달 비중과 손님이 몰리는 시간대',
      '최근에 문 닫았거나 새로 연 가게',
    ],
  },
  {
    id: 'vacant',
    when: (a) => {
      const { competition } = indicators(a)
      return competition.score === null && competition.raw.동종점포수 === 0
    },
    title: '같은 업종이 없는 이유 확인',
    because: (a) => `반경 ${formatRadius(indicators(a).competition.raw.반경m)} 안에 같은 업종이 없어 경쟁성 점수를 내지 않았습니다`,
    record: [
      '예전에 같은 업종이 있었는지(폐업·이전) 주변 상인·부동산에 문의',
      '주민이 그 서비스를 지금 어디서 이용하는지(다른 동네·온라인)',
      '반경을 넓혀 다시 분석한 결과(반경별 비교 표)와 대조',
    ],
  },
  {
    id: 'rent',
    when: rentExcluded,
    title: '후보 점포의 임대 조건 확인',
    // D-015: 일반 좌표 요청은 rent_area 가 항상 null(상권 미연결)이며 조사 대상 밖인지 판정한 것이 아니다 — 연결되지 않았다는 사실만 쓴다(12-28-R3)
    because: () => '이 위치에는 임대료 조사 상권이 연결되지 않아 임대료를 점수에 반영하지 않았습니다',
    record: ['보증금·월세·관리비·권리금', '전용 면적·층·출입구 방향', '계약 기간과 인상 조건'],
  },
  {
    id: 'market-gu',
    when: (a) => guLevel(indicators(a).market),
    title: '실제 유동 인구 관찰',
    because: (a) => {
      const { market } = indicators(a)
      const inflow = market.raw.일평균_유입인구
      return `유입 인구는 ${a.context.gu_name} 구 단위 자료${inflow !== null ? `(하루 유입 ${count(inflow)}명)` : ''} — 이 자리의 유동은 담지 않습니다`
    },
    record: [
      '평일 점심·퇴근 시간, 주말 낮에 각 30분씩 지나가는 사람 수와 방향',
      '건널목·역 출구·버스정류장에서 가게 앞까지의 동선',
      '근처 큰 건물·학교·시장의 운영 시간',
    ],
  },
  {
    id: 'customer-radius',
    when: (a) => {
      const { customer } = indicators(a)
      return customer.score !== null && isRadiusPopulation(customer)
    },
    title: '주변 거주·직장 인구 확인',
    because: (a) => {
      const { customer } = indicators(a)
      const target = customer.raw.타겟연령_거주인구
      const share = customer.raw.타겟연령_비중
      return `반경 인구${target !== null ? ` ${count(target)}명` : ''}는 행정동 인구를 면적 비율로 나눈 추정값입니다${share !== null ? ` · 타겟 연령 비중 ${percent(share)}` : ''}`
    },
    record: [
      '반경 안 아파트 단지·오피스텔·주택가의 실제 분포',
      '큰 직장·관공서·학교처럼 낮 인구를 만드는 시설',
      '주민 연령대가 타겟 연령 비중과 맞는지',
    ],
  },
  {
    id: 'closure',
    when: (a) => indicators(a).stability.flags.includes('폐업률_높음'),
    title: '주변 폐업·공실 확인',
    because: (a) => {
      const rate = indicators(a).stability.raw.최근_폐업률
      return `${a.context.gu_name} ${a.result.meta.업종}의 최근 폐업률이 높다는 flag${rate !== null ? `(${percent(rate)})` : ''}가 있습니다`
    },
    record: [
      '가게 자리 주변의 공실·임대 안내문 수',
      '최근 1~2년 사이 바뀐 가게(부동산·상인 문의)',
      '폐업 이유로 들은 것(임대료·경쟁·상권 변화)',
    ],
  },
  {
    id: 'access',
    when: () => true,
    title: '접근 동선 확인',
    because: (a) => {
      const { 최근접역: station, 최근접역_거리m: distance } = indicators(a).location.raw
      return station && distance !== null ? `${station}역까지 직선거리 ${formatDistance(distance)} — 걷는 거리·시간은 다릅니다` : '가까운 역 정보가 없습니다'
    },
    record: [
      '역·버스정류장에서 걸어서 걸리는 실제 시간',
      '주차·정차 가능 여부, 건물 입구와 간판이 보이는 위치',
      '경사·계단·횡단보도처럼 걷기 불편한 구간',
    ],
  },
]

/** 지금 결과에 맞는 카드, 우선순위 순으로 FIELD_CHECK_COUNT 개 */
export function fieldChecks(a: AnalyzeResponse): FieldCheck[] {
  return FIELD_CHECK_RULES.filter((r) => r.when(a))
    .slice(0, FIELD_CHECK_COUNT)
    .map((r) => ({ id: r.id, title: r.title, because: r.because(a), record: r.record }))
}
