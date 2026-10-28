/**
 * 데이터 버전 (9-C4, D-033, docs/DATA_VERSIONING.md §4·§6).
 *
 * - backend 는 /analyze·/nearby-stores 성공 응답 헤더 `X-Data-Version` 에 그 결과를 계산한 데이터 버전 id 를 싣는다.
 *   응답 본문(Zod strict 스키마)은 그대로 두고, API 클라이언트가 파싱한 응답 객체에 버전을 붙여 둔다 — 캐시·화면 상태가
 *   같은 객체를 들고 다니므로 결과마다 데이터 버전을 알 수 있다.
 * - GET /health 의 data = {version, as_of: {역할 키: 자료 기준일}} 은 화면의 데이터 출처·설명 날짜에 쓴다(DataInfoContext).
 * - 헤더가 없는 서버(9-C4 이전)·테스트 응답은 버전 null — null 끼리는 같은 버전으로 본다(지금과 같은 동작).
 */
import { createContext, useContext } from 'react'

export const DATA_VERSION_HEADER = 'X-Data-Version'

const versions = new WeakMap<object, string>()

/** 파싱한 응답 객체에 데이터 버전을 붙인다(헤더 값이 없으면 그대로) */
export function stampDataVersion<T>(data: T, version: string | null): T {
  if (version && typeof data === 'object' && data !== null) versions.set(data, version)
  return data
}

/** 응답을 계산한 데이터 버전 (모르면 null) */
export function dataVersionOf(data: object): string | null {
  return versions.get(data) ?? null
}

/**
 * 화면 표기 "데이터 묶음 2026-06" (12-19). 버전 id 는 묶음 이름이지 모든 자료의 기준월이 아니다 — 상가 2026-06-30·인구 2026-08·
 * 인허가 2026-09·SGIS 2024처럼 자료마다 기준일이 다르므로 "데이터 2026-06 기준"처럼 읽히지 않게 쓴다. 자료별 기준일은 데이터 출처 표
 */
export const dataVersionLabel = (version: string): string => `데이터 묶음 ${version}`

/** 역할별 자료 기준일 화면 표기: 분기 "2026Q2" → "2026년 2분기", 그 밖(YYYY-MM-DD·YYYY-MM)은 그대로 */
export function formatAsOf(value: string): string {
  const quarter = /^(\d{4})Q([1-4])$/.exec(value)
  return quarter ? `${quarter[1]}년 ${quarter[2]}분기` : value
}

/** GET /health 의 데이터 메타 (역할 키: shops·panel·market_panel·stability_pc·stability_food·stations·schools·rent) */
export type DataInfo = { version: string; as_of: Readonly<Record<string, string>> }

/** 서버가 알린 데이터 메타. 구버전 서버·조회 실패면 null — 화면은 기준일을 비워 둔다(정적 날짜로 채우지 않는다) */
export const DataInfoContext = createContext<DataInfo | null>(null)

/**
 * 이 결과에 맞는 역할별 기준일. 결과의 데이터 버전을 알고 서버 메타 버전과 다르면(전환 직후 등) 맞지 않는 날짜를
 * 보이지 않도록 null.
 */
export function asOfFor(info: DataInfo | null, resultVersion: string | null): DataInfo['as_of'] | null {
  if (!info) return null
  if (resultVersion !== null && resultVersion !== info.version) return null
  return info.as_of
}

/** 결과 화면(단일·비교)이 내려 주는 "이 결과의 데이터 버전" — 데이터 출처 표·관점 설명이 쓴다 */
export const ResultDataVersionContext = createContext<string | null>(null)

/** 지금 보이는 결과에 맞는 역할별 기준일 (모르면 null) */
export function useResultAsOf(): DataInfo['as_of'] | null {
  return asOfFor(useContext(DataInfoContext), useContext(ResultDataVersionContext))
}
