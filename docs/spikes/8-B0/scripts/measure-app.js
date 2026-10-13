(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  const map = document.querySelector('section.map')
  const m = map && map.getBoundingClientRect()
  const rel = (o) => (o && m ? { x: o.x - Math.round(m.x), y: o.y - Math.round(m.y), w: o.w, h: o.h } : o)
  const out = { vw: innerWidth, vh: innerHeight, map: r(map), header: r(document.querySelector('header')), sheet: r(document.querySelector('.map-sheet')) }
  for (const s of ['.map__legend', '.map__guide', '.map__store-bar']) out[s] = rel(r(document.querySelector(s)))
  const sdk = []
  const canvas = document.querySelector('.map__canvas')
  if (canvas && m) for (const el of canvas.querySelectorAll('*')) {
    if (getComputedStyle(el).zIndex !== '100') continue
    const b = el.getBoundingClientRect()
    if (b.width >= 1 && b.height >= 1 && b.width < m.width) sdk.push(rel(r(el)))
  }
  out.sdk = sdk
  return JSON.stringify(out)
})()
