// wrapEmailPattern — маска почты восстановления (`de•••@gmail.com`) как её рисует
// tweb: порт `components/popups/emailSetup.ts:wrapEmailPattern` + ветки
// `messageEntitySpoiler` с `noTextFormat` из `lib/richTextProcessor/wrapRichText.ts`.
//
// Каждый ПРОГОН звёздочек превращается в `span.bluff-spoiler.is-visible`, внутри —
// по `span.bluff-spoiler-letter` на символ, а сам символ подменяется случайным
// брайлевым знаком (порт `lib/richTextProcessor/spoiler.ts`). Стили — глобальные
// (`styles/tweb/_spoiler.scss`).
import { useMemo, type CSSProperties, type ReactNode } from 'react'

// tweb lib/richTextProcessor/spoiler.ts — набор брайлевых «букв» по возрастанию
// плотности точек; символ маски выбирается из него случайно.
const CHARS =
  '⠁⠂⠄⠈⠐⠠⡀⢀⠃⠅⠆⠉⠊⠌⠑⠒⠔⠘⠡⠢⠤⠨⠰⡁⡂⡄⡈⡐⡠⢁⢂⢄⢈⢐⢠⣀⠇⠋⠍⠎⠓⠕⠖⠙⠚⠜⠣⠥⠦⠩⠪⠬⠱⠲⠴⠸⡃⡅⡆⡉⡊⡌⡑⡒⡔⡘⡡⡢⡤⡨⡰⢃⢅⢆⢉⢊⢌⢑⢒⢔⢘⢡⢢⢤⢨⢰⣁⣂⣄⣈⣐⣠⠏⠗⠛⠝⠞⠧⠫⠭⠮⠳⠵⠶⠹⠺⠼⡇⡋⡍⡎⡓⡕⡖⡙⡚⡜⡣⡥⡦⡩⡪⡬⡱⡲⡴⡸⢇⢋⢍⢎⢓⢕⢖⢙⢚⢜⢣⢥⢦⢩⢪⢬⢱⢲⢴⢸⣃⣅⣆⣉⣊⣌⣑⣒⣔⣘⣡⣢⣤⣨⣰⠟⠯⠷⠻⠽⠾⡏⡗⡛⡝⡞⡧⡫⡭⡮⡳⡵⡶⡹⡺⡼⢏⢗⢛⢝⢞⢧⢫⢭⢮⢳⢵⢶⢹⢺⢼⣇⣋⣍⣎⣓⣕⣖⣙⣚⣜⣣⣥⣦⣩⣪⣬⣱⣲⣴⣸⠿⡟⡯⡷⡻⡽⡾⢟⢯⢷⢻⢽⢾⣏⣗⣛⣝⣞⣧⣫⣭⣮⣳⣵⣶⣹⣺⣼⡿⢿⣟⣯⣷⣻⣽⣾⣿'

const randomChar = () => CHARS[((Math.random() * 1000) | 0) % CHARS.length]

// отступление от tweb: у Telegram `email_pattern` маскируется ЗВЁЗДОЧКАМИ
// (`a**@e***.com`), а наш бэкенд отдаёт готовые буллеты (`de•••@example.com`).
// Считаем скрытым прогоном и то и другое — иначе спойлер не собрался бы вовсе.
const MASK_CHARS = '*•'
const isMask = (ch: string | undefined) => ch !== undefined && MASK_CHARS.includes(ch)
const firstMaskIndex = (s: string, from: number) => {
  for (let i = from; i < s.length; i++) if (isMask(s[i])) return i
  return -1
}

// отступление от tweb: в оригинале `mask-image` спойлера — КАДР живой симуляции
// частиц (`BluffSpoilerController` → WebGL2-воркер `spoilerRenderer.worker`,
// перекодирование кадра в data-URL 15 раз в секунду). Подсистема не портирована,
// а без маски `.bluff-spoiler-letter{background-color: currentColor}` рисует
// сплошные плашки. Ставим статическую зернистую маску того же тайла, что ждёт
// `_spoiler.scss` (`mask-size: 240px 120px; mask-repeat: repeat`).
const STATIC_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='1'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 8 -4'/%3E%3C/filter%3E%3Crect width='240' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")"

const MASK_STYLE = { maskImage: STATIC_MASK, WebkitMaskImage: STATIC_MASK } as CSSProperties

/**
 * `de•••@gmail.com` → узлы для подстановки в подзаголовок карточки восстановления.
 * Как в tweb: строка без «*» (или с пробелом) отдаётся как есть.
 */
export default function useEmailPattern(pattern: string): ReactNode {
  // Символы маски случайны — пересчитывать их на каждый рендер нельзя, иначе
  // подпись «дёргается» на любом вводе кода.
  return useMemo(() => {
    if (pattern.includes(' ') || firstMaskIndex(pattern, 0) === -1) return pattern

    const out: ReactNode[] = []
    let i = 0
    let key = 0
    for (;;) {
      const start = firstMaskIndex(pattern, i)
      if (start === -1) break
      let end = start + 1
      while (isMask(pattern[end])) end++

      if (start > i) out.push(pattern.slice(i, start))
      out.push(
        <span key={key++} className="bluff-spoiler is-visible" style={MASK_STYLE}>
          {Array.from({ length: end - start }, (_, n) => (
            <span key={n} className="bluff-spoiler-letter">
              {randomChar()}
            </span>
          ))}
        </span>,
      )
      i = end
    }
    if (i < pattern.length) out.push(pattern.slice(i))
    return out
  }, [pattern])
}
