// Порт `formatDateAccordingToTodayNew` (tweb helpers/date.ts:107-129): одна
// метка, чья ПОДРОБНОСТЬ зависит от давности события. Проверяются все четыре
// ветки выбора формата — перепутанный порядок условий в оригинале даёт
// правдоподобную, но неверную метку (например, «пн» вместо «14 авг»), и
// заметить это без теста нечем.
//
// Локаль фиксируем английской (умолчание `useI18nStore`), чтобы утверждения не
// зависели от языка машины: сам `Intl` тестируется не здесь.
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'

import { useSettingsStore } from '@/settings'
import {
  daysLocalized,
  fillLocalizedDates,
  fillTipDates,
  formatDate,
  formatDateAccordingToTodayNew,
  formatFullSentTime,
  formatFullSentTimeRaw,
  formatTime,
  getFullDate,
  getWeekNumber,
  monthsLocalized,
  type DateData,
} from './date'
import { applyLang } from '@/test/lang'

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

// ── Остальные подписи файла (порт задачей #121) ──────────────────────────────
//
// Проверяется ВЫБОР ВЕТКИ и ФОРМА, а не сам `Intl`: перепутанные условия в
// `formatFullSentTimeRaw` дают правдоподобную, но неверную подпись («5 сент.»
// вместо «Сегодня»), и заметить это без теста нечем.

describe('formatFullSentTimeRaw', () => {
  afterEach(() => { vi.useRealTimers() })

  const raw = (nowIso: string, timeIso: string, options?: Parameters<typeof formatFullSentTimeRaw>[1]) => {
    vi.useFakeTimers()
    vi.setSystemTime(at(nowIso))
    return formatFullSentTimeRaw(Math.floor(at(timeIso).getTime() / 1000), options)
  }

  it('сегодня — ключ `Date.Today`, а не дата', () => {
    const { dateEl, timeEl } = raw('2026-08-29T18:00:00', '2026-08-29T09:41:00', { capitalize: true })
    expect(dateEl.textContent).toBe('Today')
    expect(timeEl!.textContent).toBe('09:41')
  })

  it('вчера — ключ `Yesterday` с капитализацией через CSS (как у оригинала)', () => {
    const { dateEl } = raw('2026-08-29T18:00:00', '2026-08-28T09:41:00', { capitalize: true })
    expect(dateEl.textContent).toBe('yesterday')
    expect(dateEl.style.textTransform).toBe('capitalize')
  })

  it('без `capitalize` — строчные ключи статуса пира', () => {
    const { dateEl } = raw('2026-08-29T18:00:00', '2026-08-29T09:41:00')
    expect(dateEl.textContent).toBe('today')
  })

  it('позавчера — уже дата, а не «вчера»', () => {
    const { dateEl } = raw('2026-08-29T18:00:00', '2026-08-26T09:41:00', { capitalize: true })
    expect(dateEl.textContent).toBe('Aug 26')
  })

  it('другой год — с годом', () => {
    const { dateEl } = raw('2026-08-29T18:00:00', '2025-08-26T09:41:00', { capitalize: true })
    expect(dateEl.textContent).toBe('Aug 26, 2025')
  })

  it('`combined` — дата и время ОДНИМ узлом, «сегодня» не подставляется', () => {
    const { dateEl, timeEl } = raw('2026-08-29T18:00:00', '2026-08-29T09:41:00', { combined: true })
    expect(timeEl).toBeUndefined()
    expect(dateEl.textContent).toContain('Aug 29')
    expect(dateEl.textContent).toMatch(/09:41|9:41/)
  })
})

describe('formatFullSentTime', () => {
  afterEach(() => { vi.useRealTimers() })

  it('склеивает дату и время ключом `ScheduleController.at`', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-08-29T18:00:00'))
    const host = document.createElement('div')
    host.append(formatFullSentTime(Math.floor(at('2026-08-29T09:41:00').getTime() / 1000)))
    expect(host.textContent).toBe('Today at 09:41')
  })
})

describe('formatDate', () => {
  afterEach(() => { vi.useRealTimers() })

  it('тот же год — без года; другой — с годом', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-08-29T18:00:00'))
    expect(formatDate(at('2026-06-14T10:00:00')).textContent).toBe('June 14')
    expect(formatDate(at('2025-06-14T10:00:00')).textContent).toBe('June 14, 2025')
  })

  it('`shortMonth` и `withTime` меняют форму', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-08-29T18:00:00'))
    expect(formatDate(at('2026-06-14T10:00:00'), { shortMonth: true }).textContent).toBe('Jun 14')
    expect(formatDate(at('2026-06-14T10:00:00'), { withTime: true }).textContent).toContain('10:00')
  })
})

describe('formatTime', () => {
  it('только часы и минуты', () => {
    expect(formatTime(at('2026-06-14T10:05:00')).textContent).toBe('10:05')
  })
})

describe('getFullDate', () => {
  // Техническая подсказка (`title` времени бабла, метка в копируемом тексте):
  // месяц английский ВО ВСЕХ языках — так у оригинала (`months` из
  // `helpers/date/common.ts`, а не `monthsLocalized`).
  it('по умолчанию — «14 June 2026, 10:05:07»', () => {
    expect(getFullDate(at('2026-06-14T10:05:07'))).toBe('14 June 2026, 10:05:07')
  })

  it('форма копируемой метки оригинала: месяц числом, без секунд, время через пробел', () => {
    expect(getFullDate(at('2026-06-04T10:05:07'), {
      noSeconds: true,
      monthAsNumber: true,
      timeJoiner: ' ',
      leadingZero: true,
    })).toBe('04.06.2026 10:05')
  })
})

// ── Чипы дат глобального поиска — порт `fillTipDates` (tweb date.ts:240-592) ──
//
// Пины — на РЕЗУЛЬТАТ: заголовок чипа и вычисленные границы [minDate, maxDate]
// в миллисекундах, ровно то, что владелец поиска положит в `data-key`
// (`date_<min>_<max>`, tweb sidebarLeft/index.ts:1355) и дальше в запрос.
// «Сейчас» зафиксировано: суббота, 26 сентября 2026, 15:30:00.000 местного
// времени — от него считаются «сегодня», «вчера», прошедший день недели и
// отсечение будущих дат.
describe('fillTipDates', () => {
  const NOW = new Date(2026, 8, 26, 15, 30, 0, 0)
  /** Полночь местного дня (месяц — человеческий, с 1). */
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime()
  const tips = (q: string) => {
    const dates: DateData[] = []
    fillTipDates(q, dates)
    return dates
  }
  const titles = (q: string) => tips(q).map((d) => d.title)
  const YEARS_DOWN = Array.from({ length: 2026 - 2013 + 1 }, (_, i) => 2026 - i)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    fillLocalizedDates()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await applyLang('en')
    fillLocalizedDates()
  })

  it('короче трёх символов — ни одного чипа', () => {
    expect(tips('to')).toEqual([])
    expect(tips(' 1. ')).toEqual([])
  })

  it('«today» и его префикс — сегодняшние сутки', () => {
    const today = [{ title: 'Today', minDate: day(2026, 9, 26), maxDate: day(2026, 9, 27) - 1 }]
    expect(tips('today')).toEqual(today)
    expect(tips('  ToD ')).toEqual(today)
  })

  it('«yesterday» — вчерашние сутки, заголовок с заглавной', () => {
    expect(tips('yest')).toEqual([{ title: 'Yesterday', minDate: day(2026, 9, 25), maxDate: day(2026, 9, 26) - 1 }])
  })

  it('день недели — ПРОШЕДШИЙ такой день (сегодняшний — сегодня), заголовок — этот же день', () => {
    // Пин расхождения 1 шапки `date.ts`: у оригинала `daysLocalized` после
    // `fillLocalizedDates` начинается с понедельника, а читается по `getDay()`
    // (0 — воскресенье), и «monday» давал ВОСКРЕСЕНЬЕ с подписью «Monday».
    expect(tips('monday')).toEqual([{ title: 'Monday', minDate: day(2026, 9, 21), maxDate: day(2026, 9, 22) - 1 }])
    expect(tips('frid')).toEqual([{ title: 'Friday', minDate: day(2026, 9, 25), maxDate: day(2026, 9, 26) - 1 }])
    expect(tips('saturday')).toEqual([{ title: 'Saturday', minDate: day(2026, 9, 26), maxDate: day(2026, 9, 27) - 1 }])
    expect(tips('sunday')).toEqual([{ title: 'Sunday', minDate: day(2026, 9, 20), maxDate: day(2026, 9, 21) - 1 }])
    // Три буквы — ещё не день недели (`getDayOfWeek`, :580) и не месяц.
    expect(tips('mon')).toEqual([])
  })

  it('«12.05» — 12 мая каждого года от текущего вниз до 2013-го; текущий — «May 12»', () => {
    const dates = tips('12.05')
    expect(dates.map((d) => d.title)).toEqual(['May 12', ...YEARS_DOWN.slice(1).map((y) => '12.05.' + y)])
    expect(dates[0]).toEqual({ title: 'May 12', minDate: day(2026, 5, 12), maxDate: day(2026, 5, 13) - 1 })
    expect(dates[13]).toEqual({ title: '12.05.2013', minDate: day(2013, 5, 12), maxDate: day(2013, 5, 13) - 1 })
  })

  it('будущий день этого года отсекается, 29.02 — только високосные годы', () => {
    expect(titles('12.10')[0]).toBe('12.10.2025')
    expect(titles('12.10')).toHaveLength(13)
    expect(titles('29.02')).toEqual(['29.02.2024', '29.02.2020', '29.02.2016'])
  })

  it('месяц и год числами — месяц целиком, в любом порядке', () => {
    const may2024 = [{ title: 'May 2024', minDate: day(2024, 5, 1), maxDate: day(2024, 6, 1) - 1 }]
    expect(tips('05.2024')).toEqual(may2024)
    expect(tips('2024/05')).toEqual(may2024)
    // Будущий месяц текущего года — не чип.
    expect(tips('10.2026')).toEqual([])
  })

  it('«12.05.2024» — один день; двузначный год — 20xx; будущий год и 31.02 — ничего', () => {
    const d = [{ title: '12.05.2024', minDate: day(2024, 5, 12), maxDate: day(2024, 5, 13) - 1 }]
    expect(tips('12.05.2024')).toEqual(d)
    expect(tips('12-05-24')).toEqual(d)
    expect(tips('12.05.2030')).toEqual([])
    expect(tips('31.02.2024')).toEqual([])
  })

  // Порт теста оригинала `src/tests/fillTipDates.test.ts` целиком.
  it('разделители полной даты обязаны совпадать (тест оригинала)', () => {
    expect(tips('01.02.2020')).toHaveLength(1)
    expect(tips('01.02/2020')).toHaveLength(0)
    expect(tips('01/02-2020')).toHaveLength(0)
  })

  it('имя месяца — этот месяц каждого года вниз до 2013-го; будущий в этом году пропущен', () => {
    expect(titles('may')).toEqual(YEARS_DOWN.map((y) => 'May ' + y))
    expect(tips('may')[0]).toEqual({ title: 'May 2026', minDate: day(2026, 5, 1), maxDate: day(2026, 6, 1) - 1 })
    expect(titles('oct')).toEqual(YEARS_DOWN.slice(1).map((y) => 'October ' + y))
  })

  it('месяц с годом или днём — в обоих порядках', () => {
    expect(titles('may 2024')).toEqual(['May 2024'])
    expect(titles('may 12')).toEqual(titles('12.05'))
    expect(titles('12 may')).toEqual(titles('12.05'))
    // «год месяц» у оригинала не выходит из разбора (:404-419 без `return`):
    // дальше срабатывают и шаблон месяца, и шаблон года — дословно так же.
    expect(titles('2024 may')).toEqual(['May 2024', ...YEARS_DOWN.map((y) => 'May ' + y), '2024'])
  })

  it('год — весь год; раньше 2013-го — все годы; будущий — ничего', () => {
    expect(tips('2024')).toEqual([{ title: '2024', minDate: day(2024, 1, 1), maxDate: day(2025, 1, 1) - 1 }])
    expect(titles('2010')).toEqual(YEARS_DOWN.map(String))
    expect(tips('2027')).toEqual([])
  })

  it('язык приложения: «сегодня», «вчера», день недели и месяц по-русски; английский тоже понят', async () => {
    await applyLang('ru')
    fillLocalizedDates()

    expect(tips('сегодня')).toEqual([{ title: 'Сегодня', minDate: day(2026, 9, 26), maxDate: day(2026, 9, 27) - 1 }])
    expect(titles('today')).toEqual(['Сегодня'])
    expect(tips('вчера')).toEqual([{ title: 'Вчера', minDate: day(2026, 9, 25), maxDate: day(2026, 9, 26) - 1 }])
    expect(tips('понедельник')).toEqual([{ title: 'Понедельник', minDate: day(2026, 9, 21), maxDate: day(2026, 9, 22) - 1 }])
    expect(titles('январь 2024')).toEqual(['Январь 2024'])
    expect(titles('май')).toEqual(YEARS_DOWN.map((y) => 'Май ' + y))
    // `getMonth` сверяет и английские `months` (:571): «may» понят и в русском.
    expect(titles('may')[0]).toBe('Май 2026')
    expect(titles('12.05')[0]).toBe('Май 12')
  })
})

// Названия месяцев и дней — из `Intl` на ЯЗЫКЕ ПАКЕТА (`I18n.getDateTimeFormat`),
// индексированные так, как их читают: месяц — по `getMonth()`, день — по
// `getDay()` (0 — воскресенье, как `days` оригинала).
describe('fillLocalizedDates', () => {
  const realTZ = process.env.TZ

  afterEach(async () => {
    process.env.TZ = realTZ
    await applyLang('en')
    fillLocalizedDates()
  })

  it('русский пакет — русские названия, воскресенье первым', async () => {
    await applyLang('ru')
    fillLocalizedDates()

    expect(monthsLocalized[0]).toBe('Январь')
    expect(monthsLocalized[11]).toBe('Декабрь')
    expect(daysLocalized[0]).toBe('Воскресенье')
    expect(daysLocalized[1]).toBe('Понедельник')
  })

  // Пин расхождения 2 шапки `date.ts`: оригинал строит опорные даты через
  // `Date.UTC(...)`, а форматирует в МЕСТНОМ поясе, и к западу от Гринвича
  // полночь 1 января по UTC — это ещё 31 декабря: все месяцы сдвигались на один.
  it('к западу от Гринвича названия не сдвигаются', async () => {
    process.env.TZ = 'America/New_York'
    // Смена языка сбрасывает кэш форматтеров ядра — новые возьмут новый пояс.
    await applyLang('ru')
    fillLocalizedDates()

    expect(monthsLocalized[0]).toBe('Январь')
    expect(daysLocalized[0]).toBe('Воскресенье')
  })
})
