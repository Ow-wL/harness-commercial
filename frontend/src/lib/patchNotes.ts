/**
 * 업데이트 내역(패치노트, D-031). 기준 파일은 `content/patchNotes.json` 하나 — 형식·커밋 연결 검사는
 * `scripts/patch_notes.py`. 앱 버전은 점수 엔진 버전과 따로 매긴다. 날짜는 한국 시간 기준 YYYY-MM-DD.
 */
import raw from '../content/patchNotes.json'

export type ChangeType = 'added' | 'improved' | 'fixed'

export type Release = {
  version: string
  date: string
  date_from?: string
  title: string
  changes: { type: ChangeType; text: string }[]
  engine?: string
  work?: string[]
  commits: string[]
}

export type Deployment = {
  id: string
  date: string
  kind: 'production' | 'verification' | 'rollback'
  result: string
  app_version: string
  source_commit: string
  engine?: string
  note: string
}

type PatchNotes = { renumbered_until: string; releases: Release[]; deployments: Deployment[] }

// 형식은 scripts/patch_notes.py 가 검사한다(전체 check 단계 "patch notes")
const data = raw as PatchNotes

/** 최신순 */
export const RELEASES: readonly Release[] = data.releases
export const DEPLOYMENTS: readonly Deployment[] = data.deployments
/** 이 빌드의 앱 버전 = 기준 파일의 최신 버전 */
export const APP_VERSION = RELEASES[0]!.version
/** 이 버전까지는 기존 변경 이력을 정리하며 나중에 부여한 번호다 */
export const RENUMBERED_UNTIL = data.renumbered_until

export const CHANGE_LABEL: Record<ChangeType, string> = { added: '추가', improved: '개선', fixed: '수정' }

export function versionKey(v: string): number {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : -1
}

/** 2026-10-19 → 2026.10.19, 범위는 2026.10.05~10.08 (같은 해) */
export function formatReleaseDate(r: Pick<Release, 'date' | 'date_from'>): string {
  const dot = (d: string) => d.replaceAll('-', '.')
  if (!r.date_from || r.date_from === r.date) return dot(r.date)
  return r.date_from.slice(0, 4) === r.date.slice(0, 4)
    ? `${dot(r.date_from)}~${dot(r.date.slice(5))}`
    : `${dot(r.date_from)}~${dot(r.date)}`
}

/**
 * 운영 반영일: 이 버전 이상을 담은 첫 운영 전환(production · done) 기록. 무트래픽 검증은 운영 반영이 아니다.
 * 기록은 이 화면을 빌드한 시점까지의 것이다 — 없으면 "아직 기록 없음"이지 "미반영 확정"이 아니다.
 */
export function productionOf(version: string, deployments: readonly Deployment[] = DEPLOYMENTS): Deployment | null {
  const v = versionKey(version)
  return deployments.find((d) => d.kind === 'production' && d.result === 'done' && versionKey(d.app_version) >= v) ?? null
}

const KIND_LABEL: Record<Deployment['kind'], string> = {
  production: '운영 전환',
  verification: '무트래픽 검증',
  rollback: '복구 전환',
}

const RESULT_LABEL: Record<string, string> = {
  done: '완료',
  failed: '실패',
  held: '보류',
  passed: '통과',
  'issue-found': '결함 발견',
}

export function deploymentLabel(d: Deployment): string {
  return `${d.date.replaceAll('-', '.')} ${KIND_LABEL[d.kind]} ${RESULT_LABEL[d.result] ?? d.result}`
}
