// wrapEmailPattern — маска почты восстановления (`de•••@gmail.com`) как её рисует
// tweb: порт `components/popups/emailSetup.ts:wrapEmailPattern` + ветки
// `messageEntitySpoiler` с `noTextFormat` из `lib/richTextProcessor/wrapRichText.ts`.
//
// Каждый ПРОГОН звёздочек превращается в `span.bluff-spoiler`, внутри — по
// `span.bluff-spoiler-letter` на символ, а сам символ подменяется случайным
// брайлевым знаком (порт `lib/richTextProcessor/spoiler.ts`). Стили — глобальные
// (`styles/tweb/_spoiler.scss`), маска (кадр симуляции частиц) — за
// `lib/spoiler/bluffSpoilerController`.
import { useMemo, type ReactNode } from 'react'

import { bluffSpoilerRef } from '@lib/spoiler/bluffSpoilerController'

// tweb lib/richTextProcessor/spoiler.ts — набор брайлевых «букв» по возрастанию
// плотности точек; символ маски выбирается из него случайно.
const CHARS =
  '⠁⠂⠄⠈⠐⠠⡀⢀⠃⠅⠆⠉⠊⠌⠑⠒⠔⠘⠡⠢⠤⠨⠰⡁⡂⡄⡈⡐⡠⢁⢂⢄⢈⢐⢠⣀⠇⠋⠍⠎⠓⠕⠖⠙⠚⠜⠣⠥⠦⠩⠪⠬⠱⠲⠴⠸⡃⡅⡆⡉⡊⡌⡑⡒⡔⡘⡡⡢⡤⡨⡰⢃⢅⢆⢉⢊⢌⢑⢒⢔⢘⢡⢢⢤⢨⢰⣁⣂⣄⣈⣐⣠⠏⠗⠛⠝⠞⠧⠫⠭⠮⠳⠵⠶⠹⠺⠼⡇⡋⡍⡎⡓⡕⡖⡙⡚⡜⡣⡥⡦⡩⡪⡬⡱⡲⡴⡸⢇⢋⢍⢎⢓⢕⢖⢙⢚⢜⢣⢥⢦⢩⢪⢬⢱⢲⢴⢸⣃⣅⣆⣉⣊⣌⣑⣒⣔⣘⣡⣢⣤⣨⣰⠟⠯⠷⠻⠽⠾⡏⡗⡛⡝⡞⡧⡫⡭⡮⡳⡵⡶⡹⡺⡼⢏⢗⢛⢝⢞⢧⢫⢭⢮⢳⢵⢶⢹⢺⢼⣇⣋⣍⣎⣓⣕⣖⣙⣚⣜⣣⣥⣦⣩⣪⣬⣱⣲⣴⣸⠿⡟⡯⡷⡻⡽⡾⢟⢯⢷⢻⢽⢾⣏⣗⣛⣝⣞⣧⣫⣭⣮⣳⣵⣶⣹⣺⣼⡿⢿⣟⣯⣷⣻⣽⣾⣿'

const randomChar = () => CHARS[((Math.random() * 1000) | 0) % CHARS.length]

// Скрытый символ — только `*`: бэкенд отдаёт маску формата Telegram
// (`d****@e******.com`, звёздочка на каждый спрятанный символ), как и ждёт tweb.
const isMask = (ch: string | undefined) => ch === '*'
const firstMaskIndex = (s: string, from: number) => {
  for (let i = from; i < s.length; i++) if (isMask(s[i])) return i
  return -1
}

/**
 * `d****@e******.com` → узлы для подстановки в подзаголовок карточки восстановления.
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
        // `mask-image` и класс `is-visible` ставит BluffSpoilerController: он
        // владелец маски (живой кадр симуляции либо статический фолбэк), React
        // это свойство не трогает
        <span key={key++} className="bluff-spoiler" ref={bluffSpoilerRef}>
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
