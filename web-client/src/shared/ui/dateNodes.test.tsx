// ── ПИН: невалидная дата не роняет экран, а год не пропадает ─────────────────
//
// Два дефекта, оба внесены задачей #121 и оба найдены ревью:
//
//  1. `Intl.DateTimeFormat.format(new Date(NaN))` бросает
//     `RangeError: Invalid time value`, и `IntlDateElement.update` его не
//     ловит — то есть битая строка с провода роняет РЕНДЕР ЭКРАНА. До перевода
//     подписей на узлы проверка была у каждого экрана своя (`Number.isNaN` в
//     `PremiumManage`, `try/catch` в `Passkeys`), и при переводе обе пропали;
//  2. `formatDate` оригинала опускает год у дат ТЕКУЩЕГО года. Экранам, где
//     дата отвечает на вопрос «до каких пор» («подписка до 3 декабря»), это
//     меняет смысл, поэтому им служит `overrideIntlOptions`.
//
// Проверяется поведение обёрток; что экраны их зовут именно так — отдельным
// пином (`components/dateLabels.form.test.tsx`).
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../../test/lang'

import { ALWAYS_YEAR, DayDate, RowDate, SentTime, Time } from './dateNodes'

/** 14 июня 2026, 10:00 UTC. */
const TS = Math.floor(Date.parse('2026-06-14T10:00:00Z') / 1000)
/** Ровно то, что даёт `Math.floor(Date.parse('битая строка') / 1000)`. */
const BROKEN = Math.floor(Date.parse('не дата') / 1000)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('невалидная дата', () => {
  it('`Date.parse` мусора действительно даёт NaN — иначе пин ни о чём', () => {
    expect(Number.isNaN(BROKEN)).toBe(true)
  })

  const cases = [
    ['SentTime', (fallback?: string) => <SentTime timestamp={BROKEN} fallback={fallback} />],
    ['Time', (fallback?: string) => <Time timestamp={BROKEN} fallback={fallback} />],
    ['DayDate', (fallback?: string) => <DayDate date={BROKEN} fallback={fallback} />],
    ['RowDate', (fallback?: string) => <RowDate timestamp={BROKEN} fallback={fallback} />],
  ] as const

  for (const [name, build] of cases) {
    it(`${name} не бросает и рисует fallback вместо подписи`, () => {
      // Именно «не бросает»: без защиты здесь падал бы `RangeError` из `Intl`,
      // и вместе с обёрткой падал бы весь экран.
      expect(() => render(build('2026-13-45'))).not.toThrow()
      expect(document.body.textContent).toContain('2026-13-45')
      expect(document.querySelector('.i18n')).toBeNull()
    })
  }
})

describe('год в `DayDate`', () => {
  it('по умолчанию — как у оригинала: у текущего года года нет, у прошлого есть', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T18:00:00'))

    const { container } = render(<DayDate date={TS} />)
    expect(container.textContent).toBe('June 14')

    cleanup()
    const past = Math.floor(Date.parse('2025-06-14T10:00:00Z') / 1000)
    expect(render(<DayDate date={past} />).container.textContent).toBe('June 14, 2025')
  })

  it('`ALWAYS_YEAR` возвращает год и датам текущего года', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T18:00:00'))

    const { container } = render(<DayDate date={TS} overrideIntlOptions={ALWAYS_YEAR} />)
    expect(container.textContent).toBe('June 14, 2026')
  })

  it('`shortMonth` вместе с `ALWAYS_YEAR` — «Jun 14, 2026»', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T18:00:00'))

    const { container } = render(<DayDate date={TS} shortMonth overrideIntlOptions={ALWAYS_YEAR} />)
    expect(container.textContent).toBe('Jun 14, 2026')
  })
})

// ── ПИН ЗАДАЧИ #123: подпись СТРОКИ СПИСКА ───────────────────────────────────
//
// `RowDate` — порт `formatDateAccordingToTodayNew` (tweb `helpers/date.ts:107-129`),
// у которого ЧЕТЫРЕ ветки, и выбирает их не «сколько прошло», а комбинация:
// тот же день / другой год / та же неделя / тот же год. Прежняя подпись строк
// поиска (`friendlyMsgTime`) отвечала на другой вопрос — «Сегодня в 08:17»,
// «12.06 в 08:17», — то есть у нас строки поиска и строки списка чатов
// говорили по-разному, хотя у оригинала это ОДНА И ТА ЖЕ строка диалога
// (`appSearchSuper.ts:853` → `setLastMessageN` → `appDialogsManager.ts:2242`).
//
// Ветки проверяются все четыре: подмена набора опций в одной из них — молчаливая
// правка, которую не видит ни тайпчек, ни сборка.
describe('`RowDate` — четыре ветки строки списка', () => {
  /** Четверг, 27 августа 2026, 18:00. */
  const NOW = '2026-08-27T18:00:00'

  const label = (iso: string) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { container } = render(<RowDate timestamp={Math.floor(new Date(iso).getTime() / 1000)} />)
    return container.textContent
  }

  it('тот же день — часы и минуты', () => {
    expect(label('2026-08-27T09:05:00')).toBe('09:05')
  })

  it('текущая неделя — короткий день недели', () => {
    // Понедельник той же недели: `getWeekNumber` совпадает, разница < 7 суток.
    expect(label('2026-08-24T09:05:00')).toBe('Mon')
  })

  it('тот же год, но не эта неделя — короткий месяц и число', () => {
    expect(label('2026-06-14T09:05:00')).toBe('Jun 14')
  })

  it('другой год — год, число и ДВУЗНАЧНЫЙ месяц', () => {
    // Именно `month: '2-digit'` (:106), а не короткое имя: у оригинала прошлый
    // год пишется числами целиком.
    expect(label('2025-06-14T09:05:00')).toBe('06/14/2025')
  })
})
