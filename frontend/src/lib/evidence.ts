/**
 * 관점 근거 줄 (8-C1b, docs/UX_REDESIGN.md 2.5, 승인 초안 §6 "근거 줄 규칙").
 * 그 관점 raw 값을 엔진 값 그대로 **포맷만** 해 1줄로 만든다 — 재계산·비교·순위 표현 없음.
 * - 미산출 관점은 근거 줄을 만들지 않는다(null) — 그 자리는 기존 미산출 안내(notComputedText)다.
 * - 공간 단위는 근거 줄에 쓰지 않는다(12-18부터): 산출된 관점마다 자료 단위 칩(lib/flags.unitChipLabel)이 줄 끝에 상시 붙는다.
 *   (8-C1b~12-17은 해상도 flag가 있을 때만 "· 구 단위"를 줄 끝에 썼다.)
 * - raw 값이 없는(null) 조각은 빼고, 남는 조각이 없으면 null.
 * - 엔진 v0.5(D-028): 고객성 인구는 반경 면적 배분 값이라 "반경 {r} 타겟 연령 거주"로, 경쟁성은 정확 일치 동종 수 옆에
 *   대체업종을 포함한 실효 수("비슷한 업종 포함 약 N곳")와 잠재수요 기준(거주+종사자)을 함께 쓴다 — 두 수를 섞지 않는다.
 */
import { formatDistance, formatRadius, type Indicator } from './format.ts'

/** 정수 표기(천 단위 구분). 인구처럼 소수가 붙어 오는 값은 정수로만 맞춘다 */
const count = (n: number) => Math.round(n).toLocaleString('ko-KR')
/** 0–1 비율 → 소수 1자리 % (3년 생존율 0.523 → 52.3%) */
export const percent = (r: number) => `${(r * 100).toFixed(1)}%`
/** 실효 동종 수(소수 1자리일 수 있음) — 엔진 값 그대로, 천 단위 구분만 */
export const decimal = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })

/**
 * v0.5 경쟁성 실효 동종 수(대체업종 × 계수 포함). 정확 일치 수(raw.동종점포수 — 지도 점포 목록과 같은 수)와 다를 때만 값,
 * v0.3·v0.4·0곳 경로·같을 때는 undefined. 화면은 두 수를 따로 이름 붙여 보인다(섞지 않는다)
 */
export function effectiveSameCount(ind: Indicator): number | undefined {
  if (ind.key !== 'competition' || !('동종점포수_실효(대체업종_포함)' in ind.raw)) return undefined
  const n = ind.raw['동종점포수_실효(대체업종_포함)']
  return n !== undefined && n !== ind.raw.동종점포수 ? n : undefined
}

/** v0.5 고객성 raw.인구_기준 이 반경 배분인지 ("반경 500m 배분") */
export const isRadiusPopulation = (ind: Indicator) =>
  ind.key === 'customer' && (ind.raw.인구_기준 ?? '').startsWith('반경')

/** v0.5 경쟁성 잠재수요 구성에 종사자가 들어가는지 ({"총인구":1,"종사자수":1}) */
export const demandIncludesWorkers = (ind: Indicator) =>
  ind.key === 'competition' && '잠재수요_구성' in ind.raw && Object.hasOwn(ind.raw.잠재수요_구성 ?? {}, '종사자수')

/** 근거 줄 조각(단위 제외). 관점별 raw 키는 schemas.ts 그대로 */
function parts(ind: Indicator, guName: string, business: string, radiusM: number | undefined): string[] {
  const out: string[] = []
  switch (ind.key) {
    case 'market': {
      const { 일평균_유입인구: inflow } = ind.raw
      if (inflow !== null) out.push(`${guName} 하루 유입 ${count(inflow)}명`)
      break
    }
    case 'customer': {
      const { 타겟연령_거주인구: target, 타겟연령_비중: share } = ind.raw
      const where = isRadiusPopulation(ind) && radiusM !== undefined ? `반경 ${formatRadius(radiusM)} ` : ''
      if (target !== null) out.push(`${where}타겟 연령 거주 ${count(target)}명`)
      if (share !== null) out.push(`비중 ${percent(share)}`)
      break
    }
    case 'competition': {
      const raw = ind.raw
      out.push(`반경 ${formatRadius(raw.반경m)} ${business} ${raw.동종점포수.toLocaleString('ko-KR')}곳`)
      const effective = effectiveSameCount(ind)
      if (effective !== undefined) out.push(`비슷한 업종 포함 약 ${decimal(effective)}곳`)
      if (raw.점포당_잠재수요 !== null) {
        out.push(`점포당 잠재수요${demandIncludesWorkers(ind) ? '(거주+종사자)' : ''} ${count(raw.점포당_잠재수요)}명`)
      }
      break
    }
    case 'location': {
      const { 최근접역: station, 최근접역_거리m: distance } = ind.raw
      // 엔진은 역 이름에서 "역"을 떼어 둔다 → 붙여 쓴다(format.nearestStation과 같은 규칙). 직선거리다(도보 아님)
      if (station && distance !== null) out.push(`${station}역까지 직선거리 ${formatDistance(distance)}`)
      break
    }
    case 'stability': {
      const { '3년_생존율': survival } = ind.raw
      // raw.인천_업종평균_3년생존율 은 업종 구분 없는 고정 기준선(엔진 C_BASELINE_SURVIVAL_3Y, 2021년 인천 소상공인통계)이라
      // "같은 업종 평균"으로 읽히는 근거 줄에는 쓰지 않는다(12-16). 상세 근거의 계산 기준에서 출처·한계와 함께 보인다
      if (survival !== null) out.push(`3년 생존율 ${percent(survival)}`)
      break
    }
  }
  return out
}

/** 관점 근거 줄. 미산출·조각 없음이면 null */
export function evidenceLine(ind: Indicator, guName: string, business: string, radiusM?: number): string | null {
  if (ind.score === null) return null
  const body = parts(ind, guName, business, radiusM)
  return body.length === 0 ? null : body.join(' · ')
}
