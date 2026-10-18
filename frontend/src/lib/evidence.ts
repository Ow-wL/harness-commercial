/**
 * 관점 근거 줄 (8-C1b, docs/UX_REDESIGN.md 2.5, 승인 초안 §6 "근거 줄 규칙").
 * 그 관점 raw 값을 엔진 값 그대로 **포맷만** 해 1줄로 만든다 — 재계산·비교·순위 표현 없음.
 * - 미산출 관점은 근거 줄을 만들지 않는다(null) — 그 자리는 기존 미산출 안내(notComputedText)다.
 * - 공간 단위는 엔진 해상도 flag가 있을 때만 줄 끝에 한 번 쓴다("· 구 단위"). 행 chip "시군구 단위 데이터"와
 *   주의할 점의 "…단위로 계산했습니다" 줄을 이것으로 합친다.
 * - raw 값이 없는(null) 조각은 빼고, 남는 조각이 없으면 null.
 */
import { formatDistance, formatRadius, type Indicator } from './format.ts'

/** 정수 표기(천 단위 구분). 인구처럼 소수가 붙어 오는 값은 정수로만 맞춘다 */
const count = (n: number) => Math.round(n).toLocaleString('ko-KR')
/** 0–1 비율 → 소수 1자리 % (3년 생존율 0.523 → 52.3%) */
const percent = (r: number) => `${(r * 100).toFixed(1)}%`

/**
 * 해상도 flag → 근거 줄 끝 단위. 점수가 산출된 관점만(미산출 관점의 폴백 flag는 "그 단위로 계산했다"는 뜻이 아니다,
 * docs/SCORE_EXPLANATION_AUDIT.md 4장). incheon_avg·dong_jung은 웹 경로에서 산출과 함께 오지 않지만(2.4) 오면 그대로 밝힌다
 */
export function evidenceUnit(ind: Indicator): string | null {
  if (ind.score === null) return null
  const { flags } = ind
  if (flags.includes('해상도_시군구') || flags.includes('해상도_저하__gugu_sobun')) return '구 단위'
  if (flags.includes('해상도_저하__incheon_avg')) return '인천 전체 업종평균 단위'
  if (flags.includes('해상도_저하__dong_jung')) return '업종 중분류 단위'
  return null
}

/** 근거 줄 조각(단위 제외). 관점별 raw 키는 schemas.ts 그대로 */
function parts(ind: Indicator, guName: string, business: string): string[] {
  const out: string[] = []
  switch (ind.key) {
    case 'market': {
      const { 일평균_유입인구: inflow } = ind.raw
      if (inflow !== null) out.push(`${guName} 하루 유입 ${count(inflow)}명`)
      break
    }
    case 'customer': {
      const { 타겟연령_거주인구: target, 타겟연령_비중: share } = ind.raw
      if (target !== null) out.push(`타겟 연령 거주 ${count(target)}명`)
      if (share !== null) out.push(`비중 ${percent(share)}`)
      break
    }
    case 'competition': {
      const raw = ind.raw
      out.push(`반경 ${formatRadius(raw.반경m)} ${business} ${raw.동종점포수.toLocaleString('ko-KR')}곳`)
      if (raw.점포당_잠재수요 !== null) out.push(`점포당 잠재수요 ${count(raw.점포당_잠재수요)}명`)
      break
    }
    case 'location': {
      const { 최근접역: station, 최근접역_거리m: distance } = ind.raw
      // 엔진은 역 이름에서 "역"을 떼어 둔다 → 붙여 쓴다(format.nearestStation과 같은 규칙). 직선거리다(도보 아님)
      if (station && distance !== null) out.push(`${station}역까지 직선거리 ${formatDistance(distance)}`)
      break
    }
    case 'stability': {
      const { '3년_생존율': survival, 인천_업종평균_3년생존율: incheon } = ind.raw
      // 인천 업종평균은 같은 업종의 비교 기준값(엔진 raw) — 생존율이 있을 때만 함께 쓴다
      if (survival !== null) out.push(`3년 생존율 ${percent(survival)}`, `인천 업종평균 ${percent(incheon)}`)
      break
    }
  }
  return out
}

/** 관점 근거 줄. 미산출·조각 없음이면 null */
export function evidenceLine(ind: Indicator, guName: string, business: string): string | null {
  if (ind.score === null) return null
  const body = parts(ind, guName, business)
  if (body.length === 0) return null
  const unit = evidenceUnit(ind)
  return [...body, ...(unit ? [unit] : [])].join(' · ')
}
