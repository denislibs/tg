// src/core/safeUrl.ts
//
// Allow-list URL schemes for link entities. Anything with a disallowed scheme
// (javascript:, data:, vbscript:, file:, …) is rejected so a crafted text_link
// entity can't run code via href. Relative / scheme-less URLs are allowed.
// Shared by the render path (RichText) and the editor path (markdown.ts) — a
// link href must never reach the DOM without passing through here.
export const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'tg:'])

// Порт tweb `matchUrlProtocol.ts` (`matchUrlProtocolText`, fcfe06f76): схема
// читается с ТЕКСТА так же, как её читает парсер URL до любой другой проверки, —
// табы и переводы строк выбрасываются где угодно, ведущие C0/пробел пропускаются.
// Иначе `java\nscript:` и `\x01javascript:` проходили бы как «адрес без схемы»,
// а браузер исполнил бы их как `javascript:`.
// Ведущие C0/пробел (≤ U+0020) пропускаются циклом, а не классом `[\x00-\x20]`
// в регэкспе, как у оригинала, — его запрещает линт (`no-control-regex`).
const STRIPPED_REG_EXP = /[\t\n\r]/g
const PROTOCOL_REG_EXP = /^([a-z][a-z\d+\-.]*):/i
export function matchUrlProtocolText(text: string | undefined) {
  if (!text) return null
  const stripped = text.replace(STRIPPED_REG_EXP, '')
  let start = 0
  while (start < stripped.length && stripped.charCodeAt(start) <= 0x20) ++start
  const match = stripped.slice(start).match(PROTOCOL_REG_EXP)
  return match ? match[1].toLowerCase() + ':' : null
}

export function safeUrl(url?: string): string | undefined {
  if (!url) return undefined
  const u = url.trim()
  const protocol = matchUrlProtocolText(u)
  if (protocol && !SAFE_SCHEMES.has(protocol)) return undefined
  return u
}
