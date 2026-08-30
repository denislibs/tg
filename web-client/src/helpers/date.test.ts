// Порт `formatDateAccordingToTodayNew` (tweb helpers/date.ts:107-129): одна
// метка, чья ПОДРОБНОСТЬ зависит от давности события. Проверяются все четыре
// ветки выбора формата — перепутанный порядок условий в оригинале даёт
// правдоподобную, но неверную метку (например, «пн» вместо «14 авг»), и
// заметить это без теста нечем.
//
// Локаль фиксируем английской (умолчание `useI18nStore`), чтобы утверждения не
// зависели от языка машины: сам `Intl` тестируется не здесь.
import { describe, expect, it, vi, afterEach } from 'vitest'

import { useSettingsStore } from '@/settings'
import { formatDateAccordingToTodayNew, getWeekNumber } from './date'

// Ядро локализации наполняется побочным эффектом создания хранилища языка; в
// продукте это делает холодный старт (`main.tsx` → `client/boot.ts`).
import '@/i18n'

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

// ДЕФЕКТ, ЗАКРЫТЫЙ ЗАДАЧЕЙ 7. Метка времени игнорировала настройку «12/24 часа»:
// формат строил `Intl.DateTimeFormat`, а он выбирает часовой цикл по ЛОКАЛИ, и
// настройку у него взять неоткуда. Ветку «часы и минуты руками» ядро уже несло
// (`IntlDateElement`, порт tweb :624-633) — не хватало связи настройки с
// `I18n.setTimeFormat`, и она заведена в `settings.tsx`.
//
// Проверяются полночь и полдень: именно на них ошибается наивное `hours % 12`
// (даёт «0:00 AM» вместо «12:00 AM» и «0:00 PM» вместо «12:00 PM»).
describe('настройка 12/24 часа доезжает до метки', () => {
  const format = (iso: string) => {
    vi.useFakeTimers()
    vi.setSystemTime(at(iso.slice(0, 10) + 'T23:59:00'))
    return formatDateAccordingToTodayNew(at(iso)).textContent!
  }

  afterEach(() => {
    useSettingsStore.getState().update({ timeFormat: '24h' })
  })

  it('24 часа — «09:41», без am/pm', () => {
    useSettingsStore.getState().update({ timeFormat: '24h' })
    expect(format('2026-08-29T09:41:00')).toBe('09:41')
    expect(format('2026-08-29T18:05:00')).toBe('18:05')
  })

  it('12 часов — «09:41 AM»/«06:05 PM», полночь и полдень — 12, а не 0', () => {
    useSettingsStore.getState().update({ timeFormat: '12h' })
    expect(format('2026-08-29T09:41:00')).toBe('09:41 AM')
    expect(format('2026-08-29T18:05:00')).toBe('06:05 PM')
    expect(format('2026-08-29T00:00:00')).toBe('12:00 AM')
    expect(format('2026-08-29T12:00:00')).toBe('12:00 PM')
  })

  it('переключение перерисовывает УЖЕ показанную метку, а не только следующую', () => {
    useSettingsStore.getState().update({ timeFormat: '24h' })
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-08-29T23:59:00'))
    const el = formatDateAccordingToTodayNew(at('2026-08-29T18:05:00'))
    document.body.append(el)
    expect(el.textContent).toBe('18:05')

    useSettingsStore.getState().update({ timeFormat: '12h' })
    expect(el.textContent).toBe('06:05 PM')
    el.remove()
  })
})
