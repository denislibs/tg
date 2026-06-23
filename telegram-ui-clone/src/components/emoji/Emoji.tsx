import { useState } from 'react'

// Render an emoji as an Apple-set image (like tweb's `<img class="emoji">`),
// falling back to the native glyph if the image can't be found.
//
// tweb ships the PNGs in `assets/img/emoji/<unicode>.png`; we don't bundle the
// set, so we pull the same Apple artwork from the emoji-datasource CDN. The
// filename is the emoji's codepoints in hex joined by "-". Some files keep the
// VS16 (FE0F) and some drop it, so we try the full sequence first, then the
// FE0F-stripped one, then give up and show the native glyph.

const BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/'

function codepoints(emoji: string, stripVS = false): string {
  const cps: number[] = []
  for (const ch of emoji) {
    const cp = ch.codePointAt(0)!
    if (stripVS && cp === 0xfe0f) continue
    cps.push(cp)
  }
  return cps.map((c) => c.toString(16)).join('-')
}

export default function Emoji({ e, size = 24 }: { e: string; size?: number }) {
  const [attempt, setAttempt] = useState(0)

  if (attempt >= 2) {
    return (
      <span style={{ fontSize: size * 0.95, lineHeight: 1, userSelect: 'none' }}>{e}</span>
    )
  }

  const file = codepoints(e, attempt === 1)
  return (
    <img
      src={`${BASE}${file}.png`}
      alt={e}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => setAttempt((a) => a + 1)}
      style={{ width: size, height: size, objectFit: 'contain', display: 'block', userSelect: 'none' }}
    />
  )
}
