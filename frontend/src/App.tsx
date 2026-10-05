import { AnalysisResult } from './components/AnalysisResult.tsx'
import { ContextBar } from './components/ContextBar.tsx'
import { MapPlaceholder } from './components/MapPlaceholder.tsx'
import { FIXED_ANALYSIS } from './fixtures/fixedAnalysis.ts'
import './App.css'

function App() {
  const analysis = FIXED_ANALYSIS

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-header__title">우리동네 상권분석 매니저</span>
        <ContextBar context={analysis.context} meta={analysis.result.meta} />
        <a className="app-header__link" href="#data-sources">
          데이터 출처
        </a>
      </header>
      <div className="workspace">
        <main className="workspace__panel">
          <AnalysisResult analysis={analysis} />
        </main>
        <div className="workspace__map">
          <MapPlaceholder context={analysis.context} />
        </div>
      </div>
    </div>
  )
}

export default App
