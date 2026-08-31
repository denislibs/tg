// ПИН НА ССЫЛОЧНУЮ РАЗМЕТКУ В СЛОВАРЕ.
//
// Разбор разметки словаря (`I18n.superFormatter`) умеет `[текст](url)` и строит из
// него `<a>`. У tweb такой `<a>` несёт ИНЛАЙНОВЫЙ `onclick` и потому работает где
// угодно; у нас инлайновые обработчики запрещены (мандат безопасности), имя действия
// едет атрибутом `data-anchor-action`, а слушателя этого атрибута вешает ЛЕНТА
// (`components/chat/bubbles.ts`). Значит строка со ссылкой, показанная в попапе или
// сайдбаре, дала бы пользователю мёртвый клик.
//
// Сегодня предмета нет: ни в английском источнике, ни в одном из пяти словарей такой
// разметки НЕТ. Поэтому вместо делегата, поднятого «на будущее» (инфраструктура без
// потребителя — то, что здесь сносят как мёртвый код), стоит эта проверка: она
// краснеет в тот момент, когда первая такая строка появится, и тогда решение о
// делегате принимается ПО ФАКТУ, с живым вызывающим на руках.
//
// Второй половины проблемы — исполнителя действия — тоже пока нет: `openInternalLink`
// (`BubblesNavigation`) не передаёт ни один производственный вызывающий, только тесты
// ленты. Это проверяется тут же: если исполнитель появится раньше строки, разбор
// делегата придётся начать всё равно.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import lang, { type LangPackValue } from '../lang'
import ru from './dict.ru'
import uk from './dict.uk'
import es from './dict.es'
import de from './dict.de'
import fr from './dict.fr'

/** Та же форма, что читает `superFormatter`: `[…](…)`. */
const ANCHOR = /\[.+?\]\(.*?\)/

/** Корень исходников — от МЕСТА ЭТОГО ФАЙЛА: `process.cwd()` зависит от того, откуда
 *  запустили прогон, и молча уводит скан в пустоту при запуске из корня монорепо. */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

function* allStrings(): Generator<{ where: string; key: string; text: string }> {
  for (const [key, value] of Object.entries(lang as Record<string, LangPackValue>)) {
    if (typeof value === 'string') yield { where: 'lang.ts', key, text: value }
    else for (const form of Object.values(value)) if (form) yield { where: 'lang.ts', key, text: form }
  }
  for (const [code, strings] of Object.entries({ ru, uk, es, de, fr })) {
    for (const string of strings) {
      if (string._ === 'langPackString') yield { where: `dict.${code}`, key: string.key, text: string.value }
      else if (string._ === 'langPackStringPluralized') {
        // Формы перебираются ПО СЛОТАМ, а не по списку из четырёх имён. Список
        // был слепым по построению: у схемы есть ещё `zero_value` и `two_value`
        // (`layer.d.ts`), предмета для них сегодня нет ни в одном словаре — и
        // ровно поэтому первая такая строка проехала бы мимо проверки молча.
        // У `lang.ts` (выше) перебор и так по слотам, то есть половины одного
        // скана расходились.
        for (const [slot, form] of Object.entries(string)) {
          if (!slot.endsWith('_value') || typeof form !== 'string') continue
          yield { where: `dict.${code}`, key: string.key, text: form }
        }
      }
    }
  }
}

describe('в словаре нет ссылочной разметки, пока клик по ней некому исполнить', () => {
  it('ни одна строка не несёт `[текст](url)`', () => {
    const offenders: string[] = []
    let seen = 0
    for (const { where, key, text } of allStrings()) {
      seen++
      if (ANCHOR.test(text)) offenders.push(`${where}: ${key} — «${text}»`)
    }
    // Иначе «разметки нет» означало бы «строк не нашлось».
    expect(seen).toBeGreaterThan(4000)
    expect(offenders).toEqual([])
  })

  // Вторая половина того же вопроса: даже появись строка со ссылкой, кликом по ней
  // некому распорядиться. `openInternalLink` (`BubblesNavigation`) — необязательное
  // поле, и «его никто не передаёт» рантаймом не выражается: узнать это можно только
  // по исходникам.
  //
  // Скан идёт по ВСЕМУ `src`, а не по одному хосту ленты: делегат `data-anchor-action`
  // живёт внутри ленты, и вся суть разбора в том, ГДЕ появится исполнитель — попап,
  // сайдбар, второй хост. Проверка «прочитать `VanillaFeed.tsx`» это ровно и
  // пропускала. Путь считается от каталога этого файла, а не от `process.cwd()`:
  // рабочий каталог прогона — свойство запуска, а не кода.
  it('исполнителя внутренней ссылки в продукте нет НИГДЕ, а не только в хосте ленты', () => {
    const providers: string[] = []
    let seen = 0
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file)
      // Объявление самой точки расширения и тесты ленты — не производственные
      // вызывающие: первое вводит поле, вторые передают его моком.
      if (rel === 'components/chat/bubbles.ts' || /\.test\.tsx?$/.test(rel)) continue
      // Комментарии — не код: имя точки расширения в них РАЗБИРАЕТСЯ (в этом файле,
      // в `lib/langPack.ts`, в `lib/richtext/url.ts`), и считать разбор исполнителем
      // значило бы краснеть на собственной документации.
      const src = stripComments(readFileSync(file, 'utf8'))
      seen++
      if (src.includes('openInternalLink')) providers.push(rel)
    }
    // Иначе «исполнителя нет» означало бы «файлов не нашлось».
    expect(seen).toBeGreaterThan(500)
    expect(providers).toEqual([])
  })
})
