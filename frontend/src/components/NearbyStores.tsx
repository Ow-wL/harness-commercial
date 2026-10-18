import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ApiFailure } from '../api/client.ts'
import type { NearbyStoresResponse } from '../api/schemas.ts'
import { formatDistance, formatRadius, storeAddress, storeName } from '../lib/format.ts'
import { Icon } from './Icon.tsx'
import './NearbyStores.css'

export type NearbyState =
  | { status: 'loading' }
  | { status: 'success'; data: NearbyStoresResponse }
  | { status: 'error'; failure: ApiFailure }

/** 처음에 보이는 목록 수. 나머지는 "모두 보기"로 연다 (DESIGN.md §8.14) */
export const NEARBY_PREVIEW = 5

/**
 * 반경 안 같은 업종 점포 (4차, DESIGN.md §8.14). 분석과 별도 요청이라 실패해도 분석 결과는 그대로다.
 * 목록 항목은 버튼 — 누르면 지도 마커를 강조하고 정보창을 연다(지도 마커를 누르는 것과 같은 기능, 키보드 대안).
 * 목록 영역에서 Escape를 누르면 선택과 정보창을 닫는다.
 */
export function NearbyStores({
  state,
  bizName,
  radiusM,
  expectedCount,
  show,
  onShowChange,
  activeId,
  onSelect,
  onRetry,
  place,
  sideSwitch,
}: {
  state: NearbyState
  bizName: string
  radiusM: number
  /** 같은 분석의 경쟁성.raw.동종점포수 — 목록 수와 같아야 한다 */
  expectedCount: number
  show: boolean
  onShowChange: (show: boolean) => void
  activeId: string | null
  /** 점포 선택(id) · 선택 해제(null, Escape) */
  onSelect: (id: string | null) => void
  onRetry: () => void
  /** 두 위치 비교 중 기준 위치(예: "B 남동구 구월3동") — 제목·개수 안내·목록 이름에 붙인다 (5차-B5) */
  place?: string
  /** 두 위치 비교 요약의 점포 기준 A/B 전환 (제목 아래) */
  sideSwitch?: ReactNode
}) {
  const listId = useId()
  const stores = state.status === 'success' ? state.data.stores : []
  // 지도에서 고른 점포가 접힌 뒤쪽에 있으면, 선택이 바뀔 때 목록을 펼쳐 선택 상태가 보이게 한다
  // (렌더 중 상태 조정 — 사용자가 다시 접으면 그대로 접힌다)
  const [seenActive, setSeenActive] = useState(activeId)
  const [all, setAll] = useState(() => stores.findIndex((s) => s.id === activeId) >= NEARBY_PREVIEW)
  if (activeId !== seenActive) {
    setSeenActive(activeId)
    if (stores.findIndex((s) => s.id === activeId) >= NEARBY_PREVIEW) setAll(true)
  }
  const expanded = all
  const visible = expanded ? stores : stores.slice(0, NEARBY_PREVIEW)

  // 목록 영역에서 Escape → 선택·정보창 닫기. 포커스는 누른 자리(목록 항목 등)에 그대로 남는다
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || activeId === null) return
    e.preventDefault()
    onSelect(null)
  }

  return (
    <section className="result-section" aria-labelledby="nearby-title" onKeyDown={onKeyDown}>
      <div className="result-section__head">
        <h2 id="nearby-title" className="result-section__title">
          반경 {formatRadius(radiusM)} 안 같은 업종 점포
          {/* 구분자는 span 밖 텍스트로 — span 안 앞 공백은 접근 가능한 이름에서 사라진다 */}
          {place && (
            <>
              {' · '}
              <span className="nearby__place">{place}</span>
            </>
          )}
        </h2>
        {state.status === 'success' && state.data.count > 0 && (
          <label className="nearby__toggle">
            <input type="checkbox" checked={show} onChange={(e) => onShowChange(e.target.checked)} />
            지도에 표시
          </label>
        )}
      </div>
      {sideSwitch}

      {state.status === 'loading' && (
        <p className="result-section__note" aria-live="polite">
          점포 목록을 불러오는 중…
        </p>
      )}

      {state.status === 'error' && (
        <div className="nearby__error" role="status">
          <p>
            <Icon name="alert-triangle" /> 점포 목록을 불러오지 못했습니다. 분석 결과는 그대로입니다.
          </p>
          <button type="button" className="button-ghost" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}

      {state.status === 'success' && (
        <>
          <p className="result-section__note">
            {place && `${place} · `}
            {bizName} {state.data.count}곳 · {state.data.count > 0 && '가까운 순 · 분석 지점에서 직선거리 · '}
            상가정보 {state.data.as_of} 기준(이후 개업·폐업 미반영)
          </p>
          {state.data.count !== expectedCount && (
            <p className="nearby__mismatch" role="status">
              <Icon name="alert-triangle" /> 목록 수({state.data.count}곳)가 분석의 동종 점포 수({expectedCount}곳)와
              다릅니다.
            </p>
          )}
          {state.data.count === 0 ? (
            <p className="result-section__empty">반경 {formatRadius(radiusM)} 안에 같은 업종 점포가 없습니다.</p>
          ) : (
            <>
              <DistanceStrip stores={stores} radiusM={radiusM} activeId={activeId} />
              <ol id={listId} className="nearby__list" aria-label={`${place ? `${place} ` : ''}${bizName} 점포 목록`}>
                {visible.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="nearby__item"
                      aria-pressed={s.id === activeId}
                      onClick={() => onSelect(s.id)}
                    >
                      <span className="nearby__name">{storeName(s)}</span>
                      <span className="nearby__address">{storeAddress(s)}</span>
                      <span className="nearby__distance">직선거리 {formatDistance(s.distance_m)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {stores.length > NEARBY_PREVIEW && (
                <button
                  type="button"
                  className="button-ghost button-ghost--small"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  onClick={() => setAll(!expanded)}
                >
                  {expanded ? `가까운 ${NEARBY_PREVIEW}곳만 보기` : `모두 보기 (${stores.length}곳)`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

/** 거리 띠의 텍스트 구간 (P7): 반경보다 짧은 구간만 — 반경 전체 수는 위 안내 문구가 이미 말한다 */
const STRIP_BANDS = [100, 300] as const

/**
 * 점포 거리 띠 (P7, DESIGN.md §8.14 · A3 시안 .strip): 목록 위 0~반경 가로 축에 점포 1개 = 점 1개(지도 점포 점과 같은 색),
 * 선택한 점포 점은 강조. 점은 장식(aria-hidden)이고 같은 정보를 아래 텍스트("100m 안 N곳 · 300m 안 N곳")로 준다.
 * 거리는 API distance_m 그대로(반올림·보정 없음), 축 밖으로 나가지 않게 0~100%로만 자른다.
 */
function DistanceStrip({
  stores,
  radiusM,
  activeId,
}: {
  stores: NearbyStoresResponse['stores']
  radiusM: number
  activeId: string | null
}) {
  const bands = STRIP_BANDS.filter((m) => m < radiusM)
  return (
    <div className="nearby__strip-wrap">
      <div className="nearby__strip" aria-hidden="true">
        {stores.map((s) => (
          <i
            key={s.id}
            className="nearby__dot"
            data-active={s.id === activeId || undefined}
            style={{ left: `${Math.min(100, Math.max(0, (s.distance_m / radiusM) * 100))}%` }}
          />
        ))}
      </div>
      <p className="nearby__axis" aria-hidden="true">
        <span>분석 지점</span>
        <span>{formatRadius(radiusM / 2)}</span>
        <span>{formatRadius(radiusM)}</span>
      </p>
      {bands.length > 0 && (
        <p className="nearby__bands">
          {bands.map((m) => `${formatRadius(m)} 안 ${stores.filter((s) => s.distance_m <= m).length}곳`).join(' · ')}
        </p>
      )}
    </div>
  )
}
