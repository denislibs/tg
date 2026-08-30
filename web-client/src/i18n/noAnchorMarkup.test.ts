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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import lang, { type LangPackValue } from '../lang'
import ru from './dict.ru'
import uk from './dict.uk'
import es from './dict.es'
import de from './dict.de'
import fr from './dict.fr'

/** Та же форма, что читает `superFormatter`: `[…](…)`. */
const ANCHOR = /\[.+?\]\(.*?\)/

function* allStrings(): Generator<{ where: string; key: string; text: string }> {
  for (const [key, value] of Object.entries(lang as Record<string, LangPackValue>)) {
    if (typeof value === 'string') yield { where: 'lang.ts', key, text: value }
    else for (const form of Object.values(value)) if (form) yield { where: 'lang.ts', key, text: form }
  }
  for (const [code, strings] of Object.entries({ ru, uk, es, de, fr })) {
    for (const string of strings) {
      if (string._ === 'langPackString') yield { where: `dict.${code}`, key: string.key, text: string.value }
      else if (string._ === 'langPackStringPluralized') {
        for (const form of [string.one_value, string.few_value, string.many_value, string.other_value]) {
          if (form) yield { where: `dict.${code}`, key: string.key, text: form }
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

  it('исполнителя внутренней ссылки в продукте тоже нет', async () => {
    // Читаем ИСХОДНИК: `openInternalLink` — необязательное поле, и «не передан»
    // рантаймом не выражается — узнать это можно только по вызывающим.
    const bubbles = readFileSync(resolve(process.cwd(), 'src/components/chat/VanillaFeed.tsx'), 'utf8')
    expect(bubbles).not.toContain('openInternalLink')
  })
})
