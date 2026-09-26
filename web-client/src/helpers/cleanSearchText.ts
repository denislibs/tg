/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

// Порт tweb `src/helpers/cleanSearchText.ts:1-91` — 1:1 по поведению.
// Нормализация текста для `lib/searchIndex.ts` (и индексируемого имени, и
// запроса) и чистка расширения файла в `components/wrappers/document.ts`.
//
// Расхождения с оригиналом:
//  1. Тип `C2L` — `Record<string, string>` вместо `{[k: string]: string}`, а
//     явные типы параметров/результатов — под наш strict (у tweb `strict`
//     выключен); логика не менялась.
//  2. В `badCharsRe` сняты лишние экранирования `\[` и `\/` внутри класса
//     символов (линт `no-useless-escape`) — набор символов тот же.
import LatinizeMap from '@config/latinizeMap'

export const badCharsRe = /[`~!@#$%^&*()\-_=+[\]\\|{}'";:/?.>,<]+/g
const trimRe = /^\s+|\s+$/g

/** Кириллица → клавиша той же позиции латинской раскладки (запрос, набранный
 *  «не в той» раскладке). */
const C2L: Record<string, string> = {
  'й': 'q',
  'ц': 'w',
  'у': 'e',
  'к': 'r',
  'е': 't',
  'н': 'y',
  'г': 'u',
  'ш': 'i',
  'щ': 'o',
  'з': 'p',
  'х': '[',
  'ъ': ']',
  'ф': 'a',
  'ы': 's',
  'в': 'd',
  'а': 'f',
  'п': 'g',
  'р': 'h',
  'о': 'j',
  'л': 'k',
  'д': 'l',
  'ж': ';',
  'э': '\'',
  'я': 'z',
  'ч': 'x',
  'с': 'c',
  'м': 'v',
  'и': 'b',
  'т': 'n',
  'ь': 'm',
  'б': ',',
  'ю': '.',
  '.': '/',
}

export function clearBadCharsAndTrim(text: string): string {
  return text.replace(badCharsRe, '').replace(trimRe, '')
}

export function fixCyrillic(text: string): string {
  return text.toLowerCase().replace(/[\wа-я]/g, (ch) => {
    const latinizeCh = C2L[ch]
    return latinizeCh ?? ch
  })
}

export function latinizeString(text: string): string {
  return text.replace(/[^A-Za-z0-9]/g, (ch) => {
    const latinizeCh = LatinizeMap[ch]
    return latinizeCh ?? ch
  })
}

export default function cleanSearchText(text: string, latinize = true): string {
  return processSearchText(text, {
    clearBadChars: true,
    latinize,
    ignoreCase: true,
  })
}

export type ProcessSearchTextOptions = Partial<{
  clearBadChars: boolean
  latinize: boolean
  ignoreCase: boolean
  includeTag: boolean
}>

/**
 * При `latinize` результат — ДВЕ строки через `\x01`: латинизированный текст и
 * исходный, переведённый `fixCyrillic` в латинскую раскладку. `SearchIndex`
 * режет запрос по `\x01` и ищет обе ветки.
 */
export function processSearchText(text = '', options: ProcessSearchTextOptions = {}): string {
  const hasTag = options.includeTag && text.charAt(0) === '%'
  const originalText = text
  if(options.clearBadChars) text = clearBadCharsAndTrim(text)
  if(options.latinize) text = latinizeString(text)
  if(options.ignoreCase) text = text.toLowerCase()
  if(hasTag) text = '%' + text
  if(options.latinize) text += '\x01' + fixCyrillic(originalText)
  return text
}
