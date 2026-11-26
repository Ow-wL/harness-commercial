import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { searchPlaces } from '../api/client.ts'
import type { PlaceItem } from '../api/schemas.ts'
import { geocode, type GeocodeItem, type LatLngPoint } from '../map/geocoder.ts'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { incheonFirst, SEARCH_COUNT, SEARCH_ORIGIN } from '../lib/addressSearch.ts'
import { LOCATION_SEARCH_ADDRESS_VISIBLE, LOCATION_SEARCH_EXAMPLES } from '../lib/locationSearch.ts'
import { PLACE_QUERY_MAX } from '../lib/placeSearch.ts'
import { ResultButton } from './AddressSearch.tsx'
import { PlaceButton } from './PlaceSearch.tsx'
import { Icon } from './Icon.tsx'
import './AddressSearch.css'

type Found = { query: string; addresses: GeocodeItem[]; places: PlaceItem[]; addressFailed: boolean; placesFailed: boolean }
type Phase = { status: 'idle' } | { status: 'loading'; query: string } | ({ status: 'done' } & Found)

/**
 * 검색으로 찾기 (13-52, D-050): 주소와 장소 이름을 **검색창 하나**로 찾는다 — 무엇이 주소이고 무엇이 장소 이름인지 사용자가 가리지 않아도 된다.
 * 제출하면 주소(NAVER Geocoder, 브라우저)와 장소 이름(backend `/places`)을 함께 1회씩 부르고, 둘이 모두 끝나면 한 목록으로 보인다
 * (주소 결과 먼저, 그다음 장소). 고른 결과의 좌표를 그대로 `onSelect` 로 넘긴다 — 분석은 시작하지 않고, 분석 행정동은 backend 가 좌표로 판정한다.
 * - 주소·장소 검색이 둘 다 준비된 서버에서만 부모가 그린다. 하나만 있으면 기존 AddressSearch·PlaceSearch 를 그대로 쓴다.
 * - 한쪽이 실패해도 다른 쪽 결과는 보이고, 실패한 쪽을 한 줄로 알린다. 늦은 응답은 요청 번호로 버린다(입력 변경·재검색·언마운트).
 * - 인천 밖 결과도 고를 수 있다(분석이 거른다) — 표시로만 알린다(AddressSearch·PlaceSearch 와 같은 규칙).
 */
export function LocationSearch({
  api,
  disabled,
  onSelect,
  onFocusLost,
}: {
  api: NaverMapsApi
  disabled: boolean
  onSelect: (point: LatLngPoint) => void
  /** 포커스가 이 안에 있는 채로 언마운트될 때(SDK 인증 실패로 주소 기능이 꺼짐) — 부모가 남은 조작으로 포커스를 옮긴다 */
  onFocusLost?: () => void
}) {
  const [query, setQuery] = useState('')
  const [blank, setBlank] = useState(false)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const seq = useRef(0)
  const inflight = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const inputId = useId()
  const errorId = useId()
  const listLabelId = useId()

  const invalidate = () => {
    seq.current += 1
    inflight.current?.abort()
    inflight.current = null
  }

  // api 가 바뀌거나 언마운트되면 진행 중 응답을 버린다
  useEffect(() => invalidate, [api])

  const focusLostRef = useRef(onFocusLost)
  useLayoutEffect(() => {
    focusLostRef.current = onFocusLost
  })
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(root.ownerDocument.activeElement)) focusLostRef.current?.()
    }
  }, [])

  // 결과가 오면 첫 결과로 포커스 — 키보드로 바로 고를 수 있게
  useLayoutEffect(() => {
    if (phase.status === 'done') listRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [phase])

  const change = (value: string) => {
    setQuery(value)
    if (blank && value.trim() !== '') setBlank(false)
    invalidate()
    setPhase((p) => (p.status === 'loading' ? { status: 'idle' } : p))
  }

  const search = (q: string) => {
    invalidate()
    setBlank(false)
    const mine = ++seq.current
    const ac = new AbortController()
    inflight.current = ac
    setPhase({ status: 'loading', query: q })
    const addressJob = geocode(api, q, { coordinate: SEARCH_ORIGIN, count: SEARCH_COUNT }).then(
      (r) => ({ items: r.status === 'ok' ? incheonFirst(r.items).slice(0, LOCATION_SEARCH_ADDRESS_VISIBLE) : [], failed: r.status === 'error' && r.kind !== 'invalid' }),
      () => ({ items: [] as GeocodeItem[], failed: true }),
    )
    const placeJob = searchPlaces(q.slice(0, PLACE_QUERY_MAX), ac.signal).then(
      (r) => ({ items: r.ok ? r.data.places : [], failed: !r.ok }),
      () => ({ items: [] as PlaceItem[], failed: true }),
    )
    void Promise.all([addressJob, placeJob]).then(([a, p]) => {
      if (seq.current !== mine) return
      inflight.current = null
      setPhase({ status: 'done', query: q, addresses: a.items, places: p.items, addressFailed: a.failed, placesFailed: p.failed })
    })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q === '') {
      setBlank(true)
      return
    }
    search(q)
  }

  const example = (q: string) => {
    setQuery(q)
    search(q)
  }

  const select = (point: LatLngPoint) => {
    invalidate()
    setPhase({ status: 'idle' })
    onSelect({ lat: point.lat, lng: point.lng })           // 좌표 그대로 — 반올림·변환 없음
  }

  const done = phase.status === 'done' ? phase : null
  const total = done ? done.addresses.length + done.places.length : 0
  const status =
    phase.status === 'loading'
      ? '찾는 중…'
      : !done
        ? ''
        : total > 0
          ? `‘${done.query}’ 검색 결과 ${total}건 — 고르면 그 자리를 위치로 씁니다`
          : done.addressFailed && done.placesFailed
            ? '검색을 지금 쓸 수 없습니다. 지도에서 고르거나 좌표를 입력하세요.'
            : `‘${done.query}’에 맞는 곳을 찾지 못했습니다. 이름을 바꾸거나 도로명·번지로 적어 보세요.`
  const partial =
    done && total > 0 && (done.addressFailed || done.placesFailed)
      ? done.addressFailed
        ? '주소 검색은 지금 쓸 수 없어 장소 이름 결과만 보입니다.'
        : '장소 이름 검색은 지금 쓸 수 없어 주소 결과만 보입니다.'
      : null

  return (
    <div ref={rootRef} className="address-search location-search">
      <div className="address-search__body">
        <form className="address-search__form" role="search" aria-label="위치 검색" onSubmit={submit} noValidate>
          <div className="field address-search__field">
            <label className="field__label" htmlFor={inputId}>
              주소 또는 장소 이름
            </label>
            <input
              id={inputId}
              className="input"
              type="text"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="예: 부평역, 부평대로 1"
              value={query}
              disabled={disabled}
              aria-invalid={blank || undefined}
              aria-describedby={blank ? errorId : undefined}
              onChange={(e) => change(e.target.value)}
            />
            {blank && (
              <p id={errorId} className="field__error">
                <Icon name="alert-triangle" size={14} />
                찾을 주소나 장소 이름을 입력하세요
              </p>
            )}
          </div>
          <button
            type="submit"
            className="button button--secondary address-search__submit"
            disabled={disabled}
            aria-busy={phase.status === 'loading' || undefined}
          >
            {phase.status === 'loading' && <span className="spinner" aria-hidden="true" />}
            검색
          </button>
        </form>
        <p className="address-search__examples">
          <span className="address-search__examples-label">예시</span>
          {LOCATION_SEARCH_EXAMPLES.map((q) => (
            <button key={q} type="button" className="button-ghost button-ghost--small" disabled={disabled} onClick={() => example(q)}>
              {q}
            </button>
          ))}
        </p>
        <p className="address-search__status" aria-live="polite" id={listLabelId}>
          {status}
        </p>
        {partial && <p className="address-search__hint">{partial}</p>}
        {done && total > 0 && (
          <ol ref={listRef} className="address-search__results" aria-labelledby={listLabelId}>
            {done.addresses.map((item, i) => (
              <li key={`a${i}:${item.lat},${item.lng}`}>
                <ResultButton item={item} disabled={disabled} onSelect={select} />
              </li>
            ))}
            {done.places.map((item, i) => (
              <li key={`p${i}:${item.lat},${item.lng}`}>
                <PlaceButton item={item} disabled={disabled} onSelect={select} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
