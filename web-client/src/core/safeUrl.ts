// src/core/safeUrl.ts
//
// Allow-list URL schemes for link entities. Anything with a disallowed scheme
// (javascript:, data:, vbscript:, file:, …) is rejected so a crafted text_link
// entity can't run code via href. Relative / scheme-less URLs are allowed.
// Shared by the render path (RichText) and the editor path (markdown.ts) — a
// link href must never reach the DOM without passing through here.
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'tg'])

export function safeUrl(url?: string): string | undefined {
  if (!url) return undefined
  const u = url.trim()
  const m = u.match(/^([a-z][a-z0-9+.-]*):/i)
  if (m && !SAFE_SCHEMES.has(m[1].toLowerCase())) return undefined
  return u
}
