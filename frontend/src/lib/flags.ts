/**
 * 8-C1d 한글화 (docs/UX_REDESIGN.md 2.4·2.5): 상세 근거의 "특이사항"(엔진 flags)과 "계산 단위"(엔진 fallback)를 화면 말로.
 * 원문은 바꾸지 않는다 — 원시값 보기(§8.10)에 flags·fallback 원문을 그대로 둔다. 모르는 flag는 지어내지 않고 원문 그대로 보인다.
 * 해상도 flag는 근거 줄 끝 "· 구 단위"(8-C1b)와 같은 뜻이라 특이사항에서는 빼고, 계산 단위 줄이 맡는다.
 */
import { formatRadius, type Indicator } from './format.ts'

export type FlagText = { label: string; note: string }

/**
 * 엔진이 내는 flag 전체(scoring_engine/v0_3·v0_5/scoring.py `flags.append`, service.py MARKET_FLAG)와 화면 라벨·한 줄 설명.
 * 키 집합은 테스트가 엔진 원본 문자열과 대조한다(lib/flags.test.ts). v0.5 는 학교구역 flag 하나가 더 있다(D-028)
 */
export const FLAG_TEXT: Readonly<Record<string, FlagText | null>> = {
  영업시간대_유입_집중: { label: '영업시간대 유입 집중', note: '24시간 균등 기준(1.0) 대비 값이라 인천 대부분 구에서 붙습니다' },
  영업시간대_유입_엇갈림: { label: '영업시간대 유입 엇갈림', note: '영업시간대와 유입이 많은 시간대가 어긋납니다' },
  모수는_크나_타겟농도_낮음: { label: '인구는 많지만 타겟 비중 낮음', note: '타겟 연령 거주 인구와 비중 점수의 차이' },
  타겟농도_높으나_모수_작음: { label: '타겟 비중은 높지만 인구 적음', note: '타겟 연령 거주 인구와 비중 점수의 차이' },
  미개척_동종점포_0개: { label: '반경 안 같은 업종 없음', note: '같은 업종 점포가 없어 경쟁성을 내지 않았습니다' },
  동종업종_과밀: { label: '같은 업종 비중 15% 초과', note: '반경 안 전체 점포 대비' },
  신규진입_증가중: { label: '최근 1년 순증', note: '같은 업종 점포가 최근 1년 사이 늘었습니다' },
  '역세권_300m내': { label: '역 300m 안', note: '최근접역까지 직선거리 기준' },
  역세권_벗어남: { label: '역 1km 밖', note: '최근접역까지 직선거리 기준' },
  폐업률_높음: { label: '최근 폐업률 20% 초과', note: '구 × 업종 값' },
  커버리지_부족_미산출: { label: '세부지표 부족으로 미산출', note: '계산된 세부지표가 기준(50%)에 못 미칩니다' },
  // v0.5 입지성: 학교 주변 영업 규제 업종은 학교 200m 안 초·중·고를 유인시설 가점에서 뺀다(200~500m 는 그대로)
  학교구역_학교_가점제외: {
    label: '학교 200m 안 학교는 가점 제외',
    note: '학교 주변 영업 규제 업종이라 200m 안 초·중·고를 유인시설 가점에 넣지 않았습니다',
  },
  // 해상도 flag: 근거 줄 "· 구 단위"·계산 단위 줄과 같은 뜻 → 특이사항에서는 중복 표시하지 않는다
  해상도_시군구: null,
  해상도_저하__gugu_sobun: null,
  해상도_저하__dong_jung: null,
  해상도_저하__incheon_avg: null,
}

export type FlagItem = { kind: 'known'; flag: string; text: FlagText } | { kind: 'raw'; flag: string }

/** 특이사항에 보일 항목: 알려진 flag는 라벨·설명, 해상도 flag는 뺀다, 모르는 flag는 원문(raw) */
export function flagItems(ind: Indicator): FlagItem[] {
  return ind.flags.flatMap((flag): FlagItem[] => {
    if (!(flag in FLAG_TEXT)) return [{ kind: 'raw' as const, flag }]
    const text = FLAG_TEXT[flag]
    return text ? [{ kind: 'known' as const, flag, text }] : []
  })
}

/**
 * 계산 단위 (2.4·2.5): 엔진 fallback 원문(`gugu_sobun` 등) 대신 화면 말. 관점마다 실제로 쓰는 공간 단위가 다르다 —
 * 경쟁성은 분석 반경, 입지성은 지점 좌표(엔진 fallback 기본값 dong_sobun은 이 둘의 단위가 아니다).
 * 안정성 incheon_avg는 웹 경로에서 S1~S3 값이 공급되지 않아 항상 미산출이다(감사 4장) — "인천 평균으로 계산"이라고 쓰지 않는다.
 */
/**
 * 요약 행의 자료 단위 칩(12-18, 계획 0-3): 산출된 관점마다 "이 점수의 자료가 어느 공간 단위인지"를 짧게 상시 표시한다 —
 * 지도의 정밀한 핀과 소수 1자리 점수가 모든 자료가 지점 단위처럼 보이지 않게. calcUnitLabel(상세 근거 "계산 단위")의 짧은 판.
 * 미산출 관점은 null(그 자리는 미산출 안내). 반경을 모르면(radiusM undefined) "반경"만.
 */
export function unitChipLabel(ind: Indicator, radiusM?: number): string | null {
  if (ind.score === null) return null
  const radius = radiusM === undefined ? '반경' : `반경 ${formatRadius(radiusM)}`
  if (ind.key === 'customer' && ind.raw.인구_기준?.startsWith('반경')) return `${radius} 추정`   // v0.5 면적 배분 인구
  switch (ind.key) {
    case 'competition':
      return radius
    case 'location':
      return '지점 좌표'
    default:
      return (
        {
          dong_sobun: '행정동 단위',
          dong_jung: '업종 중분류 단위',
          gugu_sobun: '구 단위',
          gugu: '구 단위',
          incheon_avg: '인천 전체 단위',
        } as const
      )[ind.fallback]
  }
}

export function calcUnitLabel(ind: Indicator, radiusM: number): string {
  if (ind.score === null) {
    return ind.fallback === 'incheon_avg' ? '구 표본 30건 미만 → 산출하지 않음' : '산출하지 않음'
  }
  // v0.5: 고객성 인구도 경쟁성과 같은 반경으로 행정동 경계 면적 비율 배분(raw.인구_기준). 1인 세대 비중만 행정동 값
  if (ind.key === 'customer' && ind.raw.인구_기준?.startsWith('반경')) {
    return `지점 반경 ${formatRadius(radiusM)} (행정동 경계 면적 배분, 1인 세대 비중은 행정동 값)`
  }
  switch (ind.key) {
    case 'competition':
      return `지점 반경 ${formatRadius(radiusM)}`
    case 'location':
      return '지점 좌표'
    default:
      return (
        {
          dong_sobun: '행정동 단위',
          dong_jung: '행정동 · 업종 중분류 단위',
          gugu_sobun: ind.key === 'stability' ? '구 × 업종 단위' : '구 단위',
          gugu: '구 단위',
          incheon_avg: '인천 전체 업종평균 단위',
        } as const
      )[ind.fallback]
  }
}
