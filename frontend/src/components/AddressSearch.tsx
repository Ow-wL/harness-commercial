import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { geocode, type GeocodeItem, type GeocoderErrorKind, type LatLngPoint } from '../map/geocoder.ts'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { INCHEON_SIDO, incheonFirst, SEARCH_COUNT, SEARCH_EXAMPLES, SEARCH_ORIGIN, SEARCH_VISIBLE } from '../lib/addressSearch.ts'
import { Icon } from './Icon.tsx'
import './AddressSearch.css'

type Phase =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ok'; query: string; items: GeocodeItem[] }
  | { status: 'empty'; query: string }
  | { status: 'error'; query: string; kind: GeocoderErrorKind }

/**
 * 주소로 찾기 (단일 위치 7-B4, 비교 B 위치 7-B5 — docs/ADDRESS_DESIGN.md §5.2 A, DESIGN.md §7.4).
 * 펼침 버튼 + 폼(보이는 라벨·입력·검색 버튼) + 상태 문구(aria-live) + 결과 목록. 고른 결과의 adapter lat/lng를 그대로
 * `onSelect`로 넘긴다 — 무엇을 할지(단일 위치 선택 / B 위치 선택)는 부르는 쪽이 정하고, 분석은 시작하지 않는다.
 * 포커스 이동도 부르는 쪽이 정한다(단일: 위치 요약, B: "B 분석하기").
 *
 * 요청 관리: 제출 때만 1회 부른다(입력 중 호출 없음). 제출마다 요청 번호를 올리고, 응답이 왔을 때 번호가 다르면 버린다.
 * 입력 변경·폼 닫기·`api` 변경·언마운트(= SDK 실패로 부모가 이 컴포넌트를 내림)도 번호를 올린다 — SDK 콜백은 취소할 수
 * 없으므로 결과 폐기로 취소를 대신한다. 부모는 Geocoder가 준비됐을 때만 이 컴포넌트를 그린다.
 */
export function AddressSearch({
  api,
  disabled,
  onSelect,
  onFocusLost,
  labelPrefix = '',
  embedded = false,
}: {
  api: NaverMapsApi
  disabled: boolean
  onSelect: (point: LatLngPoint) => void
  /** 포커스가 이 안에 있는 채로 언마운트될 때(예: SDK 인증 실패로 주소 기능이 꺼짐). 부모가 남은 조작으로 포커스를 옮긴다 */
  onFocusLost?: () => void
  /** 버튼·라벨·검색 영역 이름 앞에 붙는 말 (예: "B " → "B 주소로 찾기", "B 주소", "B 주소 검색") */
  labelPrefix?: string
  /** 펼침 버튼 없이 폼을 늘 연다 — 위치 입력 방법 segmented에서 "주소로 찾기"를 고른 동안 (P2·P3). 결과를 골라도 폼은 남고 목록만 닫힌다 */
  embedded?: boolean
}) {
  const [openState, setOpen] = useState(false)
  const open = embedded || openState
  const [query, setQuery] = useState('')
  const [blank, setBlank] = useState(false)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [showAll, setShowAll] = useState(false)
  const seq = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const focusItemRef = useRef<number | null>(null)
  const formId = useId()
  const inputId = useId()
  const errorId = useId()
  const listLabelId = useId()

  // api가 바뀌거나 언마운트되면 진행 중 응답을 버린다
  useEffect(() => {
    return () => {
      seq.current += 1
    }
  }, [api])

  // 포커스를 가진 채로 사라지면 부모에게 알린다(layout cleanup은 DOM이 아직 붙어 있을 때 돈다)
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

  // "더 보기"로 펼친 뒤 첫 새 항목으로 포커스 (눌렀던 버튼은 사라진다)
  useLayoutEffect(() => {
    if (focusItemRef.current === null) return
    listRef.current?.querySelectorAll<HTMLButtonElement>('button')[focusItemRef.current]?.focus()
    focusItemRef.current = null
  }, [showAll])

  const invalidate = () => {
    seq.current += 1
  }

  const toggle = () => {
    invalidate()                                           // 닫으면 진행 중 응답 폐기. 입력값은 남긴다
    setPhase({ status: 'idle' })
    setShowAll(false)
    setBlank(false)
    setOpen((v) => !v)
  }

  const change = (value: string) => {
    setQuery(value)
    if (blank && value.trim() !== '') setBlank(false)
    invalidate()                                           // 입력이 바뀌면 이전 요청의 응답은 쓰지 않는다
    setPhase((p) => (p.status === 'loading' ? { status: 'idle' } : p))
  }

  const search = (q: string) => {
    setBlank(false)
    setShowAll(false)
    const mine = ++seq.current
    setPhase({ status: 'loading', query: q })
    geocode(api, q, { coordinate: SEARCH_ORIGIN, count: SEARCH_COUNT }).then((r) => {
      if (seq.current !== mine) return                     // 입력 변경·재검색·닫기·SDK 실패 뒤 늦게 온 응답
      if (r.status === 'ok') setPhase({ status: 'ok', query: q, items: incheonFirst(r.items) })
      else if (r.status === 'empty') setPhase({ status: 'empty', query: q })
      else setPhase({ status: 'error', query: q, kind: r.kind })
    })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q === '') {
      setBlank(true)                                       // 공백만: 호출하지 않는다
      return
    }
    search(q)
  }

  /** 예시 주소(12-21): 입력란에 넣고 바로 검색한다 — 제출과 같은 경로(요청 1회, 늦은 응답 폐기) */
  const example = (q: string) => {
    setQuery(q)
    search(q)
  }

  const select = (item: GeocodeItem) => {
    invalidate()
    setOpen(false)
    setPhase({ status: 'idle' })
    setShowAll(false)
    onSelect({ lat: item.lat, lng: item.lng })             // adapter 좌표 그대로 — 반올림·변환 없음
  }

  const more = () => {
    focusItemRef.current = SEARCH_VISIBLE
    setShowAll(true)
  }

  const items = phase.status === 'ok' ? phase.items : []
  const visible = showAll ? items : items.slice(0, SEARCH_VISIBLE)
  const status =
    phase.status === 'loading'
      ? '주소를 찾는 중…'
      : phase.status === 'empty'
        ? `‘${phase.query}’에 맞는 주소를 찾지 못했습니다. 역·건물 이름이 아니라 도로명·번지로 적어 보세요(예: ${SEARCH_EXAMPLES[0]}).`
        : phase.status === 'error'
          ? phase.kind === 'invalid'
            ? '검색어를 확인해 주세요. 도로명·번지까지 적어 보세요.'
            : '주소 검색을 지금 쓸 수 없습니다. 지도에서 고르거나 좌표를 입력하세요.'
          : phase.status === 'ok'
            ? `‘${phase.query}’ 검색 결과 ${items.length}건`
            : ''

  return (
    <div ref={rootRef} className="address-search">
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
          {labelPrefix}주소로 찾기
        </button>
      )}
      {open && (
        <div id={formId} className="address-search__body">
          <form className="address-search__form" role="search" aria-label={`${labelPrefix}주소 검색`} onSubmit={submit} noValidate>
            <div className="field address-search__field">
              <label className="field__label" htmlFor={inputId}>
                {labelPrefix}주소
              </label>
              <input
                id={inputId}
                className="input"
                type="text"
                enterKeyHint="search"
                autoComplete="off"
                placeholder="예: 부평대로 1"
                value={query}
                disabled={disabled}
                aria-invalid={blank || undefined}
                aria-describedby={blank ? errorId : undefined}
                onChange={(e) => change(e.target.value)}
              />
              {blank && (
                <p id={errorId} className="field__error">
                  <Icon name="alert-triangle" size={14} />
                  검색할 주소를 입력하세요
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
          {/* 지원 범위 안내 + 검증된 예시 (12-21, 계획 0-7): 장소 이름 검색은 1차(12-14)에서 */}
          <p className="address-search__hint">도로명·지번 주소만 찾습니다. 역·건물·가게 이름은 아직 되지 않습니다.</p>
          <p className="address-search__examples">
            <span className="address-search__examples-label">예시</span>
            {SEARCH_EXAMPLES.map((q) => (
              <button key={q} type="button" className="button-ghost button-ghost--small" disabled={disabled} onClick={() => example(q)}>
                {q}
              </button>
            ))}
          </p>
          <p className="address-search__status" aria-live="polite" id={listLabelId}>
            {status}
          </p>
          {visible.length > 0 && (
            <ol ref={listRef} className="address-search__results" aria-labelledby={listLabelId}>
              {visible.map((item, i) => (
                <li key={`${i}:${item.lat},${item.lng}`}>
                  <ResultButton item={item} disabled={disabled} onSelect={select} />
                </li>
              ))}
            </ol>
          )}
          {!showAll && items.length > SEARCH_VISIBLE && (
            <button type="button" className="button-ghost button-ghost--small" onClick={more}>
              더 보기 ({items.length - SEARCH_VISIBLE}건)
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** 결과 한 줄: 도로명주소(없으면 지번) + 보조로 지번. 인천 밖 시·도는 이름만 caption으로(선택은 막지 않는다) */
function ResultButton({ item, disabled, onSelect }: { item: GeocodeItem; disabled: boolean; onSelect: (item: GeocodeItem) => void }) {
  const primary = item.roadAddress ?? item.jibunAddress ?? `좌표 ${item.lat}, ${item.lng}`
  const secondary = item.roadAddress && item.jibunAddress ? item.jibunAddress : null
  const otherSido = item.sido && item.sido !== INCHEON_SIDO ? item.sido : null
  return (
    <button type="button" className="address-result" disabled={disabled} onClick={() => onSelect(item)}>
      <span className="address-result__primary">{primary}</span>
      {secondary && (
        <span className="address-result__secondary">
          <span className="visually-hidden">, </span>지번 {secondary}
        </span>
      )}
      {otherSido && (
        <span className="address-result__sido">
          <span className="visually-hidden">, </span>
          {otherSido}
        </span>
      )}
    </button>
  )
}
