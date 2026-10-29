import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { searchPlaces, type ApiFailure } from '../api/client.ts'
import type { PlaceItem } from '../api/schemas.ts'
import type { LatLngPoint } from '../map/geocoder.ts'
import { INCHEON_SIDO } from '../lib/addressSearch.ts'
import { PLACE_EXAMPLES, PLACE_QUERY_MAX } from '../lib/placeSearch.ts'
import { Icon } from './Icon.tsx'
import './AddressSearch.css'

type Phase =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ok'; query: string; items: PlaceItem[] }
  | { status: 'empty'; query: string }
  | { status: 'error'; query: string; failure: ApiFailure }

/**
 * 장소 이름으로 찾기 (12-14, 계획 1-6, D-036): 역·건물·가게 이름을 backend `GET /places`(NAVER 검색 프록시)로 찾아 결과의 좌표를
 * `onSelect` 로 넘긴다 — 주소 검색(AddressSearch)과 같은 역할·같은 모양. 분석은 시작하지 않고, 분석 행정동은 backend 가 좌표로 판정한다.
 * 부모는 서버가 /health 로 기능을 광고할 때만 이 컴포넌트를 그린다. 제출 때만 1회 부르고 늦은 응답은 요청 번호로 버린다(취소 포함).
 * 인천 밖 결과도 고를 수 있다(분석이 location_outside 로 거른다) — 시·도만 표시로 알린다.
 */
export function PlaceSearch({
  disabled,
  onSelect,
  labelPrefix = '',
  embedded = false,
}: {
  disabled: boolean
  onSelect: (point: LatLngPoint) => void
  /** 버튼·라벨 앞에 붙는 말 (예: "B " → "B 장소 이름으로 찾기") */
  labelPrefix?: string
  /** 펼침 버튼 없이 폼을 늘 연다 — 위치 입력 방법 segmented 에서 "장소 이름"을 고른 동안 */
  embedded?: boolean
}) {
  const [openState, setOpen] = useState(false)
  const open = embedded || openState
  const [query, setQuery] = useState('')
  const [blank, setBlank] = useState(false)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const seq = useRef(0)
  const inflight = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const formId = useId()
  const inputId = useId()
  const errorId = useId()
  const listLabelId = useId()

  useEffect(() => () => inflight.current?.abort(), [])    // 언마운트: 진행 중 요청 취소

  useLayoutEffect(() => {
    if (phase.status === 'ok') listRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [phase])

  const invalidate = () => {
    seq.current += 1
    inflight.current?.abort()
    inflight.current = null
  }

  const toggle = () => {
    invalidate()
    setPhase({ status: 'idle' })
    setBlank(false)
    setOpen((v) => !v)
  }

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
    searchPlaces(q, ac.signal)
      .then((r) => {
        if (seq.current !== mine) return
        inflight.current = null
        if (!r.ok) setPhase({ status: 'error', query: q, failure: r.failure })
        else if (r.data.places.length === 0) setPhase({ status: 'empty', query: q })
        else setPhase({ status: 'ok', query: q, items: r.data.places })
      })
      .catch(() => {})                                     // 취소된 요청
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q === '') {
      setBlank(true)
      return
    }
    search(q.slice(0, PLACE_QUERY_MAX))
  }

  const example = (q: string) => {
    setQuery(q)
    search(q)
  }

  const select = (item: PlaceItem) => {
    invalidate()
    setOpen(false)
    setPhase({ status: 'idle' })
    onSelect({ lat: item.lat, lng: item.lng })             // 좌표 그대로 — 반올림·변환 없음
  }

  const items = phase.status === 'ok' ? phase.items : []
  const status =
    phase.status === 'loading'
      ? '장소를 찾는 중…'
      : phase.status === 'empty'
        ? `‘${phase.query}’에 맞는 장소를 찾지 못했습니다. 이름을 바꾸거나 주소로 찾아 보세요.`
        : phase.status === 'error'
          ? errorText(phase.failure)
          : phase.status === 'ok'
            ? `‘${phase.query}’ 검색 결과 ${items.length}건 — 고르면 그 좌표를 위치로 씁니다`
            : ''

  return (
    <div className="address-search place-search">
      {!embedded && (
        <button
          type="button"
          className="button-ghost button-ghost--small"
          aria-expanded={open}
          aria-controls={formId}
          disabled={disabled}
          onClick={toggle}
        >
          <span className="chevron" data-open={open}>
            <Icon name="chevron-right" />
          </span>
          {labelPrefix}장소 이름으로 찾기
        </button>
      )}
      {open && (
        <div id={formId} className="address-search__body">
          <form className="address-search__form" role="search" aria-label={`${labelPrefix}장소 이름 검색`} onSubmit={submit} noValidate>
            <div className="field address-search__field">
              <label className="field__label" htmlFor={inputId}>
                {labelPrefix}장소 이름
              </label>
              <input
                id={inputId}
                className="input"
                type="text"
                enterKeyHint="search"
                autoComplete="off"
                maxLength={PLACE_QUERY_MAX}
                placeholder="예: 부평역"
                value={query}
                disabled={disabled}
                aria-invalid={blank || undefined}
                aria-describedby={blank ? errorId : undefined}
                onChange={(e) => change(e.target.value)}
              />
              {blank && (
                <p id={errorId} className="field__error">
                  <Icon name="alert-triangle" size={14} />
                  검색할 장소 이름을 입력하세요
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
          <p className="address-search__hint">
            역·건물·가게 이름을 NAVER 검색으로 찾습니다. 결과는 좌표를 고르는 용도이며, 분석 행정동은 서버가 좌표로 판정합니다.
          </p>
          <p className="address-search__examples">
            <span className="address-search__examples-label">예시</span>
            {PLACE_EXAMPLES.map((q) => (
              <button key={q} type="button" className="button-ghost button-ghost--small" disabled={disabled} onClick={() => example(q)}>
                {q}
              </button>
            ))}
          </p>
          <p className="address-search__status" aria-live="polite" id={listLabelId}>
            {status}
          </p>
          {items.length > 0 && (
            <ol ref={listRef} className="address-search__results" aria-labelledby={listLabelId}>
              {items.map((item, i) => (
                <li key={`${i}:${item.lat},${item.lng}`}>
                  <PlaceButton item={item} disabled={disabled} onSelect={select} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

function errorText(f: ApiFailure): string {
  if (f.kind === 'api' && f.error.code === 'places_unavailable') return '이 서버에는 장소 이름 검색이 설정되어 있지 않습니다. 주소로 찾거나 지도에서 고르세요.'
  if (f.kind === 'api' && f.error.code === 'invalid_query') return '검색어는 1~60자여야 합니다.'
  return '장소 검색을 지금 쓸 수 없습니다. 잠시 뒤 다시 시도하거나 주소로 찾아 보세요.'
}

/** 결과 한 줄: 이름(분류) + 도로명(없으면 지번) 주소. 인천 밖은 주소 앞 시·도로 알 수 있다 */
function PlaceButton({ item, disabled, onSelect }: { item: PlaceItem; disabled: boolean; onSelect: (item: PlaceItem) => void }) {
  const address = item.road_address ?? item.jibun_address ?? `좌표 ${item.lat}, ${item.lng}`
  const outside = address.startsWith(INCHEON_SIDO) || address.startsWith('인천') ? null : '인천 밖일 수 있음'
  const category = item.category.split('>').pop()?.trim()
  return (
    <button type="button" className="address-result" disabled={disabled} onClick={() => onSelect(item)}>
      <span className="address-result__primary">
        {item.name}
        {category && <span className="address-result__sido"> · {category}</span>}
      </span>
      <span className="address-result__secondary">
        <span className="visually-hidden">, </span>
        {address}
      </span>
      {outside && (
        <span className="address-result__sido">
          <span className="visually-hidden">, </span>
          {outside}
        </span>
      )}
    </button>
  )
}
