(async () => { try {
  const S = window.__spike, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !S.map; i++) await wait(100)
  await wait(2000)
  const reset = async () => { S.call('reset', () => { S.map.setZoom(11, false); S.map.setCenter(new S.api.LatLng(37.4563, 126.7052)) }); await wait(200) }
  const usable = S.usable(), mg = usable.margin
  const out = { kind: S.kind, usable, hyp: {} }
  const c = S.circle('A', S.BUPYEONG, 500), b = c.getBounds()
  const hx = (mg.left + mg.right) / 2, hy = (mg.top + mg.bottom) / 2
  const trials = { asym: mg, symSameU: { top: hy, bottom: hy, left: hx, right: hx },
    symMax: { top: Math.max(mg.top, mg.bottom), bottom: Math.max(mg.top, mg.bottom), left: Math.max(mg.left, mg.right), right: Math.max(mg.left, mg.right) } }
  for (const [k, margin] of Object.entries(trials)) {
    await reset()
    S.call('h', () => S.map.fitBounds(b, margin)); await wait(300)
    const rect = S.circleRect(c)
    out.hyp[k] = { margin, zoom: S.map.getZoom(), svg: rect.svg && [rect.svg.x, rect.svg.y, rect.svg.w, rect.svg.h].map(Math.round) }
  }
  await reset()
  const ca = S.circle('A', S.BUPYEONG, 500), cb = S.circle('B', S.GUWOL, 500)
  const ub = ca.getBounds().union(cb.getBounds())
  S.call('union', () => S.map.fitBounds(ub, S.usable().margin)); await wait(300)
  const u = S.usable().u
  out.unionSdkFitBounds = { method: 'SDK fitBounds(A union B, U margin); direct calculation NOT tested for union (8-B2)',
    zoom: S.map.getZoom(), a: S.verdict(S.circleRect(ca), u).svg, b: S.verdict(S.circleRect(cb), u).svg, events: S.eventsOf('union') }
  cb.setMap(null)
  return JSON.stringify(out)
} catch (e) { return 'ERR ' + e.message } })()
