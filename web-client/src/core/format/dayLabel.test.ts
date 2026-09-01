// ── ПИН ЗАДАЧИ #123: подпись дня ─────────────────────────────────────────────
//
// Прежняя редакция собирала подпись руками: «Сегодня»/«Today» тернарником
// `lang === 'ru'` и месяц из зашитых массивов `RU_MONTHS`/`EN_MONTHS`. Отсюда
// два отказа, и проверяются оба:
//
//  • языков у нас пять, а веток было две — украинский, испанский, немецкий и
//    французский читали АНГЛИЙСКИЕ месяцы и английское «Today»;
//  • даже на этих двух подпись застывала: собранная строкой, она не менялась
//    при смене языка, пока разделитель не построят заново.
//
// Плюс ветка, которой у оригинала нет вовсе: «Вчера». У tweb `createDateBubble`
// (`bubbles.ts:4783-4798`) знает ровно два исхода — «сегодня» и дата.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import I18n from '@lib/langPack'
import '../../test/lang'
import { applyLang } from '../../test/lang'

import { dayLabel, startOfDayMs } from './dayLabel'

/** «Сегодня» всех тестов файла — воскресенье 30 августа 2026. */
const NOW = '2026-08-30T14:00:00'

const dayOf = (iso: string) => startOfDayMs(iso)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
})

afterEach(async () => {
  vi.useRealTimers()
  document.body.replaceChildren()
  await applyLang('en')
})

describe('dayLabel — две ветки оригинала', () => {
  it('сегодня — ключ Date.Today, а не своя строка', () => {
    const node = dayLabel(dayOf(NOW))
    expect(node.textContent).toBe('Today')
    // Ключ настоящий: под другим языком тот же узел скажет иначе (см. ниже).
    expect(I18n.weakMap.get(node)).toBeDefined()
  })

  it('ВЧЕРА — это дата, а не «Вчера»: такой ветки у оригинала нет', () => {
    // Именно эта ветка была нашей добавкой поверх порта.
    expect(dayLabel(dayOf('2026-08-29T10:00:00')).textContent).toBe('August 29')
  })

  it('прошлый год несёт год — так решает formatDate оригинала', () => {
    expect(dayLabel(dayOf('2025-07-19T10:00:00')).textContent).toBe('July 19, 2025')
  })
})

describe('подпись следует за языком', () => {
  // Немецкий берётся не случайно: прежние ветки знали только `ru` и `en`,
  // поэтому немецкий читал АНГЛИЙСКИЙ месяц — отказ, видимый пользователю.
  it('смена языка переписывает ТОТ ЖЕ узел, без пересборки', async () => {
    const today = dayLabel(dayOf(NOW))
    const past = dayLabel(dayOf('2026-07-19T10:00:00'))
    // В документе, а не на весу: ядро находит узлы обходом `.i18n`, как в бою.
    document.body.append(today, past)

    expect([today.textContent, past.textContent]).toEqual(['Today', 'July 19'])

    await applyLang('de')

    // Месяц приходит из `Intl` по языку ПАКЕТА — словарь для него не нужен.
    expect(past.textContent).toBe('19. Juli')
    // А «сегодня» — ключ, и в `dict.de.ts` его нет: под ним остаётся английский
    // нижний слой. Это не отказ подписи, а непереведённый ключ — предмет
    // ЗАДАЧИ #102 (210 таких ключей). Проверяется здесь ЯВНО, чтобы перевод
    // ключа не выглядел поломкой пина.
    expect(today.textContent).toBe('Today')

    await applyLang('ru')

    expect(today.textContent).toBe('Сегодня')
    expect(past.textContent).toBe('19 июля')
  })
})
