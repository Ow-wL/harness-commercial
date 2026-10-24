import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'

type Props = { children: ReactNode }
type State = { failed: boolean; attempt: number }

/**
 * 지도 영역 오류 격리 (2026-10-25 운영 무트래픽 검증 결함 후속). 지도(MapView)는 외부 SDK에 기대므로 렌더·effect·정리 중
 * 예상하지 못한 예외가 날 수 있다. 앱에 다른 오류 경계가 없어 그런 예외가 React 루트 전체를 내렸다 — 이 경계는 지도 칸만
 * 실패 안내로 바꾸고 분석 폼·결과·비교(패널)는 그대로 둔다. "지도 다시 불러오기"는 지도 컴포넌트를 새로 마운트한다.
 * 예외는 React가 콘솔에 알리고, 여기서도 지도 영역 오류로 한 번 더 남긴다(숨기지 않는다).
 * MapView 안의 알려진 실패(인증·로드·초기화)는 MapView 가 직접 안내·재시도한다 — 이 경계는 그 밖의 예외용이다.
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[map] 지도 영역에서 예외가 나 지도만 내렸습니다 — 분석·비교는 패널에서 계속할 수 있습니다', error, info.componentStack)
  }

  private retry = () => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))

  render() {
    if (this.state.failed) {
      return (
        <section className="map" aria-label="지도">
          <div className="map__state" role="alert">
            <Icon name="alert-triangle" size={20} />
            <p className="map__state-title">지도를 표시하지 못했습니다</p>
            <p className="map__state-body">분석·비교는 패널의 좌표 입력·주소로 찾기로 계속할 수 있습니다.</p>
            <button type="button" className="button-ghost map__retry" onClick={this.retry}>
              지도 다시 불러오기
            </button>
          </div>
        </section>
      )
    }
    // attempt 가 바뀌면 지도를 새로 마운트한다(이전 인스턴스의 상태·SDK 객체를 이어받지 않는다)
    return <MapAttempt key={this.state.attempt}>{this.props.children}</MapAttempt>
  }
}

function MapAttempt({ children }: { children: ReactNode }) {
  return <>{children}</>
}
