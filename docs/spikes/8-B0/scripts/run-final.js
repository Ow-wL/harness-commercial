(async () => { try {
  const S = window.__spike, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !S.map; i++) await wait(100)
  await wait(2000)
  const reset = async () => { S.call('reset', () => { S.map.setZoom(11, false); S.map.setCenter(new S.api.LatLng(37.4563, 126.7052)) }); await wait(200) }
  const out = { kind: S.kind, viewport: [innerWidth, innerHeight], zoomStyle: new URLSearchParams(location.search).get('zoomStyle') || 'LARGE(default)',
    obstacles: S.obstacles().map((o) => o.src + ' ' + [o.x, o.y, o.w, o.h].map(Math.round).join(',')), usable: S.usable(), fits: [] }
  for (const r of [300, 500, 1000]) {
    await reset()
    const a = await S.fit('A', S.BUPYEONG, r)
    await reset()
    const b = await S.fitCustom('A', S.BUPYEONG, r)
    out.fits.push({ r,
      sdk: { zoom: a.after, verdict: a.verdict },
      direct: { zoom: b.after, target: b.target, d0AtZoom11: b.d0, panBy: b.pan, circleCenterMinusUCenter: b.centerToU, verdict: b.verdict } })
  }
  S.showU()
  return JSON.stringify(out)
} catch (e) { return 'ERR ' + e.message } })()
