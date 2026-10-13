(async () => { try {
  const S = window.__spike, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !S.map; i++) await wait(100)
  await wait(2000)
  const api = S.api, LL = (p) => new api.LatLng(p.lat, p.lng)
  const out = {}
  const reset = async () => { S.call('reset', () => { S.map.setZoom(15, false); S.map.setCenter(LL(S.BUPYEONG)) }); await wait(500) }
  const summarize = (name) => {
    const ev = S.eventsOf(name), seq = []
    for (const e of ev) { const t = e.split('@')[0]; if (seq[seq.length - 1] !== t) seq.push(t) }
    return { count: ev.length, sequence: seq.slice(0, 12), first: ev[0] || null, last: ev[ev.length - 1] || null }
  }
  await reset()
  S.call('panTo', () => S.map.panTo(LL(S.GUWOL))); await wait(1500); out.panTo = summarize('panTo')
  S.call('panToDuration0', () => S.map.panTo(LL(S.BUPYEONG), { duration: 0 })); await wait(800); out.panToDuration0 = summarize('panToDuration0')
  S.call('setZoom', () => S.map.setZoom(16)); await wait(800); out.setZoom = summarize('setZoom')
  S.call('setZoomFalse', () => S.map.setZoom(15, false)); await wait(800); out.setZoomFalse = summarize('setZoomFalse')
  S.call('setCenter', () => S.map.setCenter(LL(S.BUPYEONG))); await wait(800); out.setCenter = summarize('setCenter')
  S.call('panBy', () => S.map.panBy(new api.Point(40, 30))); await wait(800); out.panBy = summarize('panBy')
  const c = S.circle('A', S.BUPYEONG, 500)
  S.call('fitBounds', () => S.map.fitBounds(c.getBounds(), S.usable().margin)); await wait(800); out.fitBounds = summarize('fitBounds')
  S.call('fitBoundsAgain', () => S.map.fitBounds(c.getBounds(), S.usable().margin)); await wait(800); out.fitBoundsSameTarget = summarize('fitBoundsAgain')
  await reset()
  S.call('panThenFit', () => S.map.panTo(LL(S.GUWOL))); await wait(200)
  S.call('fitDuringPan', () => S.map.fitBounds(S.circle('B', S.GUWOL, 500).getBounds(), S.usable().margin))
  const afterFit = S.map.getCenter(); await wait(1500); const fin = S.map.getCenter()
  out.fitDuringPanTo = { centerRightAfterFit: [afterFit.lat(), afterFit.lng()].map((v) => +v.toFixed(4)), centerFinal: [fin.lat(), fin.lng()].map((v) => +v.toFixed(4)), zoom: S.map.getZoom() }
  await reset()
  S.call('panThenZoom', () => S.map.panTo(LL(S.GUWOL))); await wait(200)
  S.call('setZoomDuringPan', () => S.map.setZoom(16, false)); await wait(1500)
  const f2 = S.map.getCenter()
  out.setZoomDuringPanTo = { panTarget: [S.GUWOL.lat, S.GUWOL.lng], centerFinal: [f2.lat(), f2.lng()].map((v) => +v.toFixed(4)), zoom: S.map.getZoom() }
  if (S.circles.B) S.circles.B.setMap(null)
  await reset()
  const mapRect = document.getElementById('map').getBoundingClientRect()
  const px = mapRect.left + mapRect.width / 2, py = mapRect.top + mapRect.height / 2
  const target = document.elementFromPoint(px, py)
  S.call('syntheticWheel', () => {})
  target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: px, clientY: py, deltaY: -120 }))
  target.dispatchEvent(new WheelEvent('mousewheel', { bubbles: true, cancelable: true, clientX: px, clientY: py, deltaY: -120 }))
  await wait(1200); out.syntheticWheel = summarize('syntheticWheel')
  S.call('syntheticDrag', () => {})
  const fire = (type, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }))
  const firePtr = (type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
  firePtr('pointerdown', px, py); fire('mousedown', px, py)
  for (let i = 1; i <= 6; i++) {
    firePtr('pointermove', px + i * 10, py + i * 5); fire('mousemove', px + i * 10, py + i * 5)
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: px + i * 10, clientY: py + i * 5, buttons: 1 }))
    await wait(16)
  }
  firePtr('pointerup', px + 60, py + 30); fire('mouseup', px + 60, py + 30)
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: px + 60, clientY: py + 30 }))
  await wait(1200); out.syntheticDrag = summarize('syntheticDrag')
  const label = '지도 확대'
  const zoomIn = [...document.querySelectorAll('#map *')].find((e) => (e.getAttribute('aria-label') || e.getAttribute('alt') || e.getAttribute('title') || '') === label)
  S.call('syntheticZoomControl', () => {})
  const z0 = S.map.getZoom()
  if (zoomIn) {
    const el = zoomIn.closest('a') || zoomIn, r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5, button: 0 }
    el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); el.dispatchEvent(new MouseEvent('click', o))
  }
  await wait(1200)
  out.syntheticZoomControl = { found: !!zoomIn, zoomBefore: z0, zoomAfter: S.map.getZoom(), ...summarize('syntheticZoomControl') }
  return JSON.stringify(out)
} catch (e) { return 'ERR ' + e.message } })()
