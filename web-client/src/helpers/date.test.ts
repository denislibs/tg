// Порт `formatDateAccordingToTodayNew` (tweb helpers/date.ts:107-129): одна
// метка, чья ПОДРОБНОСТЬ зависит от давности события. Проверяются все четыре
// ветки выбора формата — перепутанный порядок условий в оригинале даёт
// правдоподобную, но неверную метку (например, «пн» вместо «14 авг»), и
// заметить это без теста нечем.
//
// Локаль фиксируем английской (умолчание `useI18nStore`), чтобы утверждения не
// зависели от языка машины: сам `Intl` тестируется не здесь.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { formatDateAccordingToTodayNew, getWeekNumber } from './date'

const at = (iso: string) => new Date(iso)

afterEach(() => {
  vi.useRealTimers()
})

describe('formatDateAccordingToTodayNew', () => {
  it('сегодня — только часы и минуты', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-08-29T18:00:00'))

    expect(formatDateAccordingToTodayNew(at('2026-08-29T09:41:00')).textContent).toMatch(/09:41|9:41/)
  })

  it('другой год — день, месяц числом и год', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-08-29T18:00:00'))

    const text = formatDateAccordingToTodayNew(at('2025-12-31T10:00:00')).textContent!
    expect(text).toContain('2025')
  })

  it('текущая неделя — короткий день недели', () => {
    vi.useFakeTimers()
    // 29 августа 2026 — суббота; 27-е той же недели.
    vi.setSystemTime(at('2026-08-29T18:00:00'))

    expect(formatDateAccordingToTodayNew(at('2026-08-27T10:00:00')).textContent).toBe('Thu')
  })

  it('тот же год, но не эта неделя — месяц и число', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-08-29T18:00:00'))

    expect(formatDateAccordingToTodayNew(at('2026-06-14T10:00:00')).textContent).toBe('Jun 14')
  })

  it('узел — span.i18n, как у `IntlDateElement` оригинала', () => {
    const el = formatDateAccordingToTodayNew(at('2026-08-29T09:41:00'))
    expect(el.tagName).toBe('SPAN')
    expect(el.classList.contains('i18n')).toBe(true)
  })
})

describe('getWeekNumber', () => {
  it('считает ISO-неделю: 4 января всегда в первой', () => {
    expect(getWeekNumber(at('2026-01-04T12:00:00'))).toBe(1)
  })

  it('соседние дни внутри одной недели дают одно число, а через границу — разные', () => {
    // 27 и 29 августа 2026 — четверг и суббота одной недели; 31-е — понедельник следующей.
    expect(getWeekNumber(at('2026-08-27T12:00:00'))).toBe(getWeekNumber(at('2026-08-29T12:00:00')))
    expect(getWeekNumber(at('2026-08-31T12:00:00'))).not.toBe(getWeekNumber(at('2026-08-29T12:00:00')))
  })
})
