(async () => { try {
  const S = window.__spike, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !S.map; i++) await wait(100)
  await wait(2000)
  const mapEl = document.getElementById('map')
  const saved = { w: mapEl.style.width, h: mapEl.style.height }
  const snap = () => { const b = S.map.getBounds(); const c = S.map.getCenter(); const s = S.map.getSize(); return { zoom: S.map.getZoom(), center: [c.lat(), c.lng()].map((v) => +v.toFixed(4)), bounds: [b.getSW().lat(), b.getSW().lng(), b.getNE().lat(), b.getNE().lng()].map((v) => +v.toFixed(4)), sdkSize: [s.width, s.height] } }
  const res = {}
  for (const mode of ['displayNone', 'zeroSize']) {
    S.call('reset', () => { S.map.setZoom(11, false); S.map.setCenter(new S.api.LatLng(37.4563, 126.7052)) }); await wait(300)
    const visibleU = S.usable()
    if (mode === 'displayNone') mapEl.style.display = 'none'; else { mapEl.style.width = '0px'; mapEl.style.height = '0px' }
    await wait(300)
    const r0 = mapEl.getBoundingClientRect()
    const hidden = { containerRect: [r0.width, r0.height], usableWhileHidden: S.usable().u, before: snap() }
    const c = S.circle('A', S.BUPYEONG, 500)
    let threw = null
    S.call('fit-' + mode, () => { try { S.map.fitBounds(c.getBounds(), visibleU.margin) } catch (e) { threw = e.message } })
    await wait(300)
    hidden.afterFit = snap(); hidden.threw = threw; hidden.events = S.eventsOf('fit-' + mode)
    if (mode === 'displayNone') mapEl.style.display = ''; else { mapEl.style.width = saved.w; mapEl.style.height = saved.h }
    await wait(300)
    const r = mapEl.getBoundingClientRect()
    S.call('setSize-' + mode, () => S.map.setSize(new S.api.Size(r.width, r.height))); await wait(300)
    res[mode] = { hidden, shownAfterSetSize: snap(), setSizeEvents: S.eventsOf('setSize-' + mode), verdictAfterShow: S.verdict(S.circleRect(c), S.usable().u) }
  }
  return JSON.stringify(res)
} catch (e) { return 'ERR ' + e.message } })()
