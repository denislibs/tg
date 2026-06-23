import type { ReactNode } from 'react'
import { Box } from '@mui/material'

// Matches URLs, t.me links, @usernames and #hashtags
const ENTITY_RE = /(https?:\/\/\S+|t\.me\/\S+|@[A-Za-z0-9_]{3,}|#[\p{L}0-9_]+)/gu
// Custom (premium) emoji marker: {e:🔥}
const CE_RE = /\{e:([^}]+)\}/g

/**
 * If `text` is only 1–3 emoji (with optional ZWJ joins / skin tones), returns
 * that count so the message can be rendered as a big emoji; otherwise 0.
 */
export function emojiOnlyCount(text: string): number {
  const t = text.replace(/[\s️]/g, '')
  if (!t) return 0
  const re = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*[\u{1F3FB}-\u{1F3FF}]?/gu
  const matches = t.match(re)
  if (!matches) return 0
  if (t.replace(re, '').length > 0) return 0 // non-emoji characters present
  return matches.length <= 3 ? matches.length : 0
}

/** Linkifies a plain text segment (no custom-emoji markers). */
function entityNodes(text: string, linkColor: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(ENTITY_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    out.push(
      <Box
        key={`${keyBase}-${idx}`}
        component="span"
        sx={{ color: linkColor, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
      >
        {m[0]}
      </Box>,
    )
    last = idx + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Renders message text with clickable links / @mentions / #hashtags and inline
 * custom (premium) emoji written as `{e:😎}`.
 */
export default function RichText({ text, linkColor }: { text: string; linkColor: string }) {
  const out: ReactNode[] = []
  let last = 0
  let seg = 0
  for (const m of text.matchAll(CE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(...entityNodes(text.slice(last, idx), linkColor, `s${seg++}`))
    out.push(
      <Box
        key={`ce-${idx}`}
        component="span"
        sx={{
          display: 'inline-block',
          fontSize: '1.3em',
          lineHeight: 1,
          verticalAlign: '-0.2em',
          mx: '1px',
        }}
      >
        {m[1]}
      </Box>,
    )
    last = idx + m[0].length
  }
  if (last < text.length) out.push(...entityNodes(text.slice(last), linkColor, `s${seg++}`))
  return <>{out}</>
}
