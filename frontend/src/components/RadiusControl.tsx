import { useId } from 'react'
import { formatRadius } from '../lib/format.ts'
import './RadiusControl.css'

/** 반경이 무엇에 영향을 주는지 (docs/UX_REDESIGN.md 4.2 사용자 문구) */
export const RADIUS_HELP =
  '반경은 경쟁성과 주변 점포에만 영향을 줍니다. 반경마다 비교 대상(같은 업종이 있는 지점)도 달라집니다. 시장성·고객성·안정성·입지성은 바뀌지 않습니다.'

/**
 * 분석 반경 선택 (8-D3, D-024, docs/UX_REDESIGN.md 4.2·4.4). 서버가 반경을 2개 이상 광고할 때만 App이 그린다
 * (구버전 서버 = engine 없음, 새 v0.3 서버 = [500] → 그리지 않는다, 4.6).
 * 분석 중(A 또는 B)에는 누를 수 없다(S15). 이전 반경 결과로 돌아갈 수 있으면 "이전 반경으로"(S8)를 보인다.
 */
export function RadiusControl({
  options,
  value,
  disabled,
  onChange,
  status,
  narrowHint,
  back,
}: {
  options: readonly number[]
  value: number
  disabled: boolean
  onChange: (radius: number) => void
  /** 지금 상태 한 줄 (예: "두 위치를 반경 1km로 다시 분석 중") — 스크린리더에 알린다 */
  status?: string | null
  /** 이 반경에서 경쟁성을 내지 못했을 때 넓은 반경 안내 (4.2) */
  narrowHint?: string | null
  /** 실패 뒤 이전 반경으로 돌아가기 (S8) */
  back?: { radius: number; onBack: () => void } | null
}) {
  const labelId = useId()
  return (
    <section className="radius-control" aria-label="분석 반경">
      <div className="radius-control__row">
        <span className="radius-control__label" id={labelId}>
          분석 반경
        </span>
        <div className="radius-control__group" role="group" aria-labelledby={labelId}>
          {options.map((r) => (
            <button
              key={r}
              type="button"
              className="radius-control__button"
              aria-pressed={r === value}
              disabled={disabled}
              onClick={() => r !== value && onChange(r)}
            >
              {formatRadius(r)}
            </button>
          ))}
        </div>
        {back && (
          <button type="button" className="button-ghost" disabled={disabled} onClick={back.onBack}>
            이전 반경({formatRadius(back.radius)})으로 돌아가기
          </button>
        )}
      </div>
      <p className="radius-control__help">{RADIUS_HELP}</p>
      {narrowHint && <p className="radius-control__help">{narrowHint}</p>}
      <p className="radius-control__status" role="status">
        {status ?? ''}
      </p>
    </section>
  )
}
