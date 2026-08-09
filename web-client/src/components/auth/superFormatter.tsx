// superFormatter — порт разбора разметки словаря из tweb `lib/langPack.ts`
// (`superFormatter`). Строки словаря несут ту же микроразметку, что и langpack
// Telegram:
//
//   '**жирный**'      → <b>
//   '__курсив__'      → <i>
//   '\n'              → <br>
//   ' > ' / ' < '     → span.tgico.inline-icon (IconMap: '>' → next, '<' → previous),
//                       пробелы вокруг стрелки съедаются (tweb iconsNoWhitespace)
//
// Разметка собирается React-нодами — сырой HTML-строкой мы не рендерим ничего
// (мандат безопасности проекта), даже собственный словарь.
//
// Не портированы ветки `[text](url)` и подстановки `%1$s`/`un1`: ни одна строка
// экрана входа в нашем словаре их не использует — мёртвый код.
import type { ReactNode } from 'react'
import TgIcon, { type IconName } from '../TgIcon'

const ICON_MAP: Record<string, IconName> = { '>': 'next', '<': 'previous' }

// (\*\*|__)(.+?)\1 | (\n) | (?:^|\s)(>|<)(?:$|\s)   — та же форма, что в tweb
const RE = /(\*\*|__)(.+?)\1|(\n)|(?:^|\s)([><])(?:$|\s)/g

export default function superFormatter(input: string): ReactNode[] {
  const out: ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of input.matchAll(RE)) {
    const [full, marker, inner, newline, icon] = match
    const offset = match.index
    if (offset > lastIndex) out.push(input.slice(lastIndex, offset))

    if (marker) {
      const content = superFormatter(inner)
      out.push(
        marker === '**' ? <b key={key++}>{content}</b> : <i key={key++}>{content}</i>,
      )
    } else if (newline) {
      out.push(<br key={key++} />)
    } else if (icon) {
      out.push(<TgIcon key={key++} name={ICON_MAP[icon]} className="inline-icon" size={16} />)
    }

    lastIndex = offset + full.length
  }

  if (lastIndex !== input.length) out.push(input.slice(lastIndex))
  return out
}
