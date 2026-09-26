/**
 * Порт tweb `src/helpers/date.ts` — ВСЕ метки дат приложения строятся здесь.
 *
 * ── Почему метка это УЗЕЛ, а не строка ─────────────────────────────────────
 * Каждая функция возвращает `new I18n.IntlDateElement({date, options}).element`
 * (или фрагмент из таких узлов) — ровно как оригинал. Узел кладёт себя в
 * `I18n.weakMap`, и дальше его обновляет ЯДРО: `applyLangPack` обходит `.i18n`
 * на смену языка (`lib/langPack.ts:568-572`, tweb `langPack.ts:328-335`), а
 * `I18n.setTimeFormat` — на смену настройки 12/24 часа (`:490`). Строка так не
 * умеет: отформатированная один раз, она застывает в языке, который был в
 * момент форматирования, и никакая перерисовка её не чинит — это и был дефект
 * задачи #121 (дата в списке чатов оставалась «30 авг.» при английском
 * интерфейсе, потому что проекция `dialogToChat` форматировала её строкой).
 *
 * Часы и минуты `IntlDateElement` собирает РУКАМИ, минуя `Intl`
 * (`langPack.ts:624-633`): только так уважается пользовательская настройка
 * 12/24 часа — у `Intl` её взять неоткуда, он выбирает цикл по ЛОКАЛИ. Связь
 * настройки с `I18n.setTimeFormat` заведена в `settings.tsx`. Заглавную букву
 * («пн», «авг.») ставит тоже ядро (`capitalizeFirstLetter`, `langPack.ts:637`).
 *
 * ── Что портировано ────────────────────────────────────────────────────────
 * `ONE_DAY` (:9), `getWeekNumber` (:59-67), `formatDate` (:75-105),
 * `formatDateAccordingToTodayNew` (:107-129), `formatFullSentTimeRaw` (:135-176),
 * `formatFullSentTime` (:178-187), `formatTime` (:200-205) и `getFullDate`
 * (tweb `helpers/date/getFullDate.ts`); для чипов дат глобального поиска —
 * `monthsLocalized`/`daysLocalized` (:6-7), `getWeekDays`/`getMonths`/
 * `fillLocalizedDates` (:32-57) и `fillTipDates` с помощниками (:220-592).
 * Не перенесено (вызывающих нет): `formatDaysDuration`, `formatMonthsDuration`,
 * `earliestSelectableMinuteMs`, `ONE_DAY_MINUTES`/`ONE_WEEK*`,
 * `getDaysPerMonthForYear`, `numberOfDaysEachMonthNonLeapYear`.
 *
 * ── Расхождения с оригиналом ───────────────────────────────────────────────
 * 1. `fillLocalizedDates` кладёт в `daysLocalized` дни С ВОСКРЕСЕНЬЯ. У
 *    оригинала туда уходит `getWeekDays()` как есть — а он начинает с
 *    понедельника (опорная дата 2 января 2017-го, понедельник; так его ждёт
 *    `businessHours.tsx:184`), тогда как `daysLocalized` читается по
 *    `getDay()` (0 — воскресенье, `formatWeekLong`, :550-553) и до наполнения
 *    равен `days` с воскресенья. Итог у оригинала: «monday» давал чип
 *    ВОСКРЕСЕНЬЯ с подписью «Monday». Сам `getWeekDays` оставлен дословным.
 * 2. `getWeekDays`/`getMonths` строят опорные даты МЕСТНЫМ конструктором, а не
 *    `Date.UTC(...)`: форматирует `Intl` в местном поясе, и к западу от
 *    Гринвича полночь 1 января по UTC — ещё 31 декабря, все названия
 *    сдвигались на одно. Пины обоих — `date.test.ts`, `fillLocalizedDates`.
 * 3. `MOUNT_CLASS_TO.fillTipDates` (:594) — отладочная выкладка в `window`, не
 *    портирована.
 *
 * Названия месяцев и дней берутся из `Intl` на языке ПАКЕТА
 * (`I18n.getDateTimeFormat`), а не ключами словаря — как у оригинала; поэтому
 * новых ключей локализации чипы дат не требуют. Наполняет их
 * `fillLocalizedDates` на каждое `language_apply` (`client/boot.ts`, порт tweb
 * `index.ts:482-491`).
 */
import I18n, { i18n } from '@lib/langPack'
import capitalizeFirstLetter from '@helpers/string/capitalizeFirstLetter'

export const ONE_DAY = 86400

/**
 * tweb `helpers/date/common.ts` — месяцы АНГЛИЙСКИМИ константами, и это не
 * недосмотр оригинала, а его выбор: `getFullDate` рисует ТЕХНИЧЕСКУЮ дату
 * (подсказка `title` у времени бабла, метка в копируемом тексте), одинаковую
 * во всех языках, а `fillTipDates` понимает английские названия при любом
 * языке интерфейса (`getMonth`, :571). Локализованные — `monthsLocalized`.
 */
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// tweb :6-7 — до первого `fillLocalizedDates` совпадают с английскими.
export const monthsLocalized = months.slice()
export const daysLocalized = days.slice()

// tweb :32-41 — дни С ПОНЕДЕЛЬНИКА (порядок оригинала), с заглавной.
// Опорная дата местная — расхождение 2 шапки.
export function getWeekDays() {
  const dateTimeFormat = I18n.getDateTimeFormat({ weekday: 'long' })
  const date = new Date(2017, 0, 2)
  const out: string[] = []
  for(let i = 0; i < 7; ++i) {
    out.push(capitalizeFirstLetter(dateTimeFormat.format(date)))
    date.setDate(date.getDate() + 1)
  }
  return out
}

// tweb :43-52. Опорная дата местная — расхождение 2 шапки.
export function getMonths() {
  const dateTimeFormat = I18n.getDateTimeFormat({ month: 'long' })
  const date = new Date(2017, 0, 1)
  const out: string[] = []
  for(let i = 0; i < 12; ++i) {
    out.push(capitalizeFirstLetter(dateTimeFormat.format(date)))
    date.setMonth(date.getMonth() + 1)
  }
  return out
}

// tweb :54-57. Воскресенье — первым (расхождение 1 шапки): `daysLocalized`
// читается по `getDay()`.
export function fillLocalizedDates() {
  const weekDays = getWeekDays()
  monthsLocalized.splice(0, monthsLocalized.length, ...getMonths())
  daysLocalized.splice(0, daysLocalized.length, weekDays[6]!, ...weekDays.slice(0, 6))
}

/**
 * Секунды эпохи, из которых МОЖНО построить дату.
 *
 * Проверка живёт здесь, а не у вызывающих, потому что вход у неё один на всех:
 * `Intl.DateTimeFormat.format(new Date(NaN))` бросает
 * `RangeError: Invalid time value`, а `IntlDateElement.update` его не ловит (не
 * ловит и оригинал — у него на этот вход данные не приходят: в MTProto `date`
 * это `int`, а у нас половина дат приезжает СТРОКАМИ, и `Date.parse` битой
 * строки даёт `NaN`). Без проверки такая строка роняет рендер экрана, а внутри
 * `.then()` — ещё и unhandled rejection с вечным шиммером на месте подписи.
 *
 * Функция намеренно тривиальна: ценность в том, что вход ОДИН, а не в том, что
 * она делает. Зовут её обёртки React (`shared/ui/dateNodes`) и ванильные места,
 * которые строят подпись сами (`chat/contextMenu.ts`).
 */
export const isValidTimestamp = (timestamp: number) => Number.isFinite(timestamp)

// tweb :58-67 — https://stackoverflow.com/a/6117889
export const getWeekNumber = (date: Date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  // getTime() в миллисекундах, ONE_DAY — в секундах
  return Math.ceil((((d.getTime() - yearStart.getTime()) / (ONE_DAY * 1000)) + 1) / 7)
}

type FormatDateOptions = {
  today?: Date
  withTime?: boolean
  shortMonth?: boolean
  overrideIntlOptions?: Intl.DateTimeFormatOptions
}

// tweb :75-105 — «5 сентября»/«5 сен. 2024, 14:30»: год добавляется, только
// если он не совпадает с сегодняшним.
export function formatDate(date: Date, { today, withTime, shortMonth, overrideIntlOptions }: FormatDateOptions = {}) {
  if(!today) {
    today = new Date()
    today.setHours(0, 0, 0, 0)
  }

  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: shortMonth ? 'short' : 'long',
  }

  if(withTime) {
    options.hour = '2-digit'
    options.minute = '2-digit'
  }

  if(date.getFullYear() !== today.getFullYear()) {
    options.year = 'numeric'
  }

  if(overrideIntlOptions) {
    Object.assign(options, overrideIntlOptions)
  }

  return new I18n.IntlDateElement({ date, options }).element
}

// tweb :107-129
export function formatDateAccordingToTodayNew(time: Date) {
  const today = new Date()
  const now = today.getTime() / 1000 | 0
  const timestamp = time.getTime() / 1000 | 0

  const options: Intl.DateTimeFormatOptions = {}
  if((now - timestamp) < ONE_DAY && today.getDate() === time.getDate()) { // тот же день
    options.hour = options.minute = '2-digit'
  } else if(today.getFullYear() !== time.getFullYear()) { // другой год
    options.year = options.day = 'numeric'
    options.month = '2-digit'
  } else if((now - timestamp) < (ONE_DAY * 7) && getWeekNumber(today) === getWeekNumber(time)) { // текущая неделя
    options.weekday = 'short'
  } else { // тот же год
    options.month = 'short'
    options.day = 'numeric'
  }

  return new I18n.IntlDateElement({ date: time, options }).element // :125-128
}

// tweb :131-134
const formatTimeOptions: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
}

// tweb :200-205 — только «ЧЧ:ММ» (ветка `hour+minute` ядра, см. шапку файла).
export function formatTime(date: Date) {
  return new I18n.IntlDateElement({ date, options: formatTimeOptions }).element
}

/**
 * tweb :135-176 — «Сегодня»/«вчера»/«5 сент.» ОТДЕЛЬНО от «14:30», двумя узлами:
 * вызывающие склеивают их по-разному (`formatFullSentTime` ставит между ними
 * `ScheduleController.at`, статус пира — свою фразу).
 *
 * `combined: true` — дата и время ОДНИМ узлом (`month/day` вместе с
 * `hour/minute` в одних опциях); тогда `timeEl` не строится вовсе, а
 * «сегодня/вчера» не подставляется (`noToday`).
 */
export function formatFullSentTimeRaw(timestamp: number, options: {
  capitalize?: boolean
  noToday?: boolean
  combined?: boolean
} = {}) {
  if(options.combined) {
    options.noToday = true
  }

  const date = new Date()
  const time = new Date(timestamp * 1000)
  const now = date.getTime() / 1000 | 0
  const diff = now - timestamp

  const timeEl = options.combined ? undefined : formatTime(time)

  let dateEl: HTMLElement
  if(!options.noToday && diff < ONE_DAY && date.getDate() === time.getDate()) { // тот же день
    dateEl = i18n(options.capitalize ? 'Date.Today' : 'Peer.Status.Today')
  } else if(!options.noToday && diff > 0 && diff < (ONE_DAY * 2) && new Date(date.getTime() - ONE_DAY * 1000).getDate() === time.getDate()) { // вчера
    dateEl = i18n(options.capitalize ? 'Yesterday' : 'Peer.Status.Yesterday')

    if(options.capitalize) {
      dateEl.style.textTransform = 'capitalize'
    }
  } else if(date.getFullYear() !== time.getFullYear()) { // другой год
    dateEl = new I18n.IntlDateElement({
      date: time,
      options: {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        ...(options.combined ? formatTimeOptions : {}),
      },
    }).element
  } else {
    dateEl = new I18n.IntlDateElement({
      date: time,
      options: {
        month: 'short',
        day: 'numeric',
        ...(options.combined ? formatTimeOptions : {}),
      },
    }).element
  }

  return { dateEl, timeEl }
}

// tweb :178-187 — «Сегодня в 14:30» одним фрагментом.
export function formatFullSentTime(timestamp: number, capitalize = true, noToday = false) {
  const { dateEl, timeEl } = formatFullSentTimeRaw(timestamp, { capitalize, noToday })

  const fragment = document.createDocumentFragment()
  fragment.append(dateEl, ' ', i18n('ScheduleController.at'), ' ', timeEl!)
  return fragment
}

// tweb `helpers/date/getFullDate.ts` 1:1.
export const getFullDate = (date: Date, options: Partial<{
  noTime: boolean
  noSeconds: boolean
  monthAsNumber: boolean
  leadingZero: boolean
  shortYear: boolean
  timeJoiner: string
}> = {}) => {
  const joiner = options.monthAsNumber ? '.' : ' '
  const time = ('0' + date.getHours()).slice(-2) + ':' +
    ('0' + date.getMinutes()).slice(-2) +
    (options.noSeconds ? '' : ':' + ('0' + date.getSeconds()).slice(-2))
  const fullYear = date.getFullYear()

  return (options.leadingZero ? ('0' + date.getDate()).slice(-2) : date.getDate()) +
    joiner + (options.monthAsNumber ? ('0' + (date.getMonth() + 1)).slice(-2) : months[date.getMonth()]) +
    joiner + (('' + fullYear).slice(options.shortYear ? 2 : 0)) +
    (options.noTime ? '' : (options.timeJoiner || ', ') + time)
}

// ── Чипы дат глобального поиска (tweb :220-592) ─────────────────────────────
// Порт разбора Telegram Android (`FiltersView.java`, ссылка оригинала :220):
// текст запроса → набор суток/месяцев/лет с границами в МИЛЛИСЕКУНДАХ.
// Потребитель — владелец поиска (`sidebarLeft/index.ts:1351-1359`): чип
// `date_<minDate>_<maxDate>`, выбранный — в `setQuery({minDate, maxDate})`.
//
// Разбор дословный, вместе с его особенностями: `setHours(0, 0, 0)` без
// миллисекунд оставляет миллисекунды текущего момента; «год месяц» не выходит
// из разбора и добирает чипы шаблонами месяца и года (:404-419 без `return`).
const minYear = 2013
const yearPattern = new RegExp('20[0-9]{1,2}')
const anyLetterRegExp = '\\p{L}'
const monthPattern = new RegExp(`(${anyLetterRegExp}{3,})`, 'iu')
const monthYearOrDayPattern = new RegExp(`(${anyLetterRegExp}{3,}) ([0-9]{0,4})`, 'iu')
const yearOrDayAndMonthPattern = new RegExp(`([0-9]{0,4}) (${anyLetterRegExp}{2,})`, 'iu')
const shortDate = new RegExp('^([0-9]{1,4})(\\.| |/|\\-)([0-9]{1,4})$', 'i')
const longDate = new RegExp('^([0-9]{1,2})(\\.| |/|\\-)([0-9]{1,2})(\\.| |/|\\-)([0-9]{1,4})$', 'i')
const numberOfDaysEachMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// tweb :240-244
export type DateData = {
  title: string
  minDate: number
  maxDate: number
}

// tweb :245-472
export function fillTipDates(query: string, dates: DateData[]) {
  const q = query.trim().toLowerCase()

  if(q.length < 3) {
    return
  }

  if(['today', I18n.format('Peer.Status.Today', true)].some((haystack) => haystack.indexOf(q) === 0)) {
    const date = new Date()
    const year = date.getFullYear()
    const month = date.getMonth()
    const day = date.getDate()
    date.setFullYear(year, month, day)
    date.setHours(0, 0, 0)

    const minDate = date.getTime()
    date.setFullYear(year, month, day + 1)
    date.setHours(0, 0, 0)

    const maxDate = date.getTime() - 1
    dates.push({
      title: I18n.format('Date.Today', true),
      minDate,
      maxDate,
    })
    return
  }

  if(['yesterday', I18n.format('Peer.Status.Yesterday', true)].some((haystack) => haystack.indexOf(q) === 0)) {
    const date = new Date()
    const year = date.getFullYear()
    const month = date.getMonth()
    const day = date.getDate()
    date.setFullYear(year, month, day)
    date.setHours(0, 0, 0)

    const minDate = date.getTime() - 86400000
    date.setFullYear(year, month, day + 1)
    date.setHours(0, 0, 0)

    const maxDate = date.getTime() - 86400001
    dates.push({
      title: capitalizeFirstLetter(I18n.format('Yesterday', true)),
      minDate,
      maxDate,
    })
    return
  }

  const dayOfWeek = getDayOfWeek(q)
  if(dayOfWeek >= 0) {
    const date = new Date()
    const now = date.getTime()
    const currentDay = date.getDay()
    const distance = dayOfWeek - currentDay
    date.setDate(date.getDate() + distance)
    if(date.getTime() > now) {
      date.setTime(date.getTime() - 604800000)
    }
    const year = date.getFullYear()
    const month = date.getMonth()
    const day = date.getDate()
    date.setFullYear(year, month, day)
    date.setHours(0, 0, 0)

    const minDate = date.getTime()
    date.setFullYear(year, month, day + 1)
    date.setHours(0, 0, 0)

    const maxDate = date.getTime() - 1
    dates.push({
      title: formatWeekLong(minDate),
      minDate,
      maxDate,
    })
    return
  }

  let matches: RegExpExecArray | null
  if((matches = shortDate.exec(q)) !== null) {
    const g1 = matches[1]!
    const g2 = matches[3]!
    const k = parseInt(g1)
    const k1 = parseInt(g2)
    if(k > 0 && k <= 31) {
      if(k1 >= minYear && k <= 12) {
        const selectedYear = k1
        const month = k - 1
        createForMonthYear(dates, month, selectedYear)
        return
      } else if(k1 <= 12) {
        const day = k - 1
        const month = k1 - 1
        createForDayMonth(dates, day, month)
      }
    } else if(k >= minYear && k1 <= 12) {
      const selectedYear = k
      const month = k1 - 1
      createForMonthYear(dates, month, selectedYear)
    }

    return
  }

  if((matches = longDate.exec(q)) !== null) {
    const g1 = matches[1]!
    const g2 = matches[3]!
    const g3 = matches[5]!
    if(matches[2] !== matches[4]) {
      return
    }

    const day = parseInt(g1)
    const month = parseInt(g2) - 1
    let year = parseInt(g3)
    if(year >= 10 && year <= 99) {
      year += 2000
    }

    const currentYear = new Date().getFullYear()
    if(validDateForMonth(day - 1, month) && year >= minYear && year <= currentYear) {
      const date = new Date()
      date.setFullYear(year, month, day)
      date.setHours(0, 0, 0)

      const minDate = date.getTime()
      date.setFullYear(year, month, day + 1)
      date.setHours(0, 0, 0)

      const maxDate = date.getTime() - 1
      dates.push({
        title: formatterYearMax(minDate),
        minDate,
        maxDate,
      })
      return
    }

    return
  }

  if((matches = monthYearOrDayPattern.exec(q)) !== null) {
    const g1 = matches[1]!
    const g2 = matches[2]!
    const month = getMonth(g1)
    if(month >= 0) {
      const k = +g2 || new Date().getUTCFullYear()
      if(k > 0 && k <= 31) {
        const day = k - 1
        createForDayMonth(dates, day, month)
        return
      } else if(k >= minYear) {
        const selectedYear = k
        createForMonthYear(dates, month, selectedYear)
        return
      }
    }
  }

  if((matches = yearOrDayAndMonthPattern.exec(q)) !== null) {
    const g1 = matches[1]!
    const g2 = matches[2]!
    const month = getMonth(g2)
    if(month >= 0) {
      const k = +g1
      if(k > 0 && k <= 31) {
        const day = k - 1
        createForDayMonth(dates, day, month)
        return
      } else if(k >= minYear) {
        const selectedYear = k
        createForMonthYear(dates, month, selectedYear)
      }
    }
  }

  if((matches = monthPattern.exec(q)) !== null) {
    const g1 = matches[1]!
    const month = getMonth(g1)
    if(month >= 0) {
      const currentYear = new Date().getFullYear()
      for(let i = currentYear; i >= minYear; --i) {
        createForMonthYear(dates, month, i)
      }
    }
  }

  if((matches = yearPattern.exec(q)) !== null) {
    let selectedYear = +matches[0]
    const currentYear = new Date().getFullYear()
    if(selectedYear < minYear) {
      selectedYear = minYear
      for(let i = currentYear; i >= selectedYear; i--) {
        const date = new Date()
        date.setFullYear(i, 0, 1)
        date.setHours(0, 0, 0)

        const minDate = date.getTime()
        date.setFullYear(i + 1, 0, 1)
        date.setHours(0, 0, 0)

        const maxDate = date.getTime() - 1
        dates.push({
          title: '' + i,
          minDate,
          maxDate,
        })
      }
    } else if(selectedYear <= currentYear) {
      const date = new Date()
      date.setFullYear(selectedYear, 0, 1)
      date.setHours(0, 0, 0)

      const minDate = date.getTime()
      date.setFullYear(selectedYear + 1, 0, 1)
      date.setHours(0, 0, 0)

      const maxDate = date.getTime() - 1
      dates.push({
        title: '' + selectedYear,
        minDate,
        maxDate,
      })
    }

    return
  }
}

// tweb :474-494
function createForMonthYear(dates: DateData[], month: number, selectedYear: number) {
  const currentYear = new Date().getFullYear()
  const today = Date.now()
  if(selectedYear >= minYear && selectedYear <= currentYear) {
    const date = new Date()
    date.setFullYear(selectedYear, month, 1)
    date.setHours(0, 0, 0)
    const minDate = date.getTime()
    if(minDate > today) {
      return
    }
    date.setMonth(date.getMonth() + 1)
    const maxDate = date.getTime() - 1

    dates.push({
      title: formatterMonthYear(minDate),
      minDate,
      maxDate,
    })
  }
}

// tweb :496-533
function createForDayMonth(dates: DateData[], day: number, month: number) {
  if(validDateForMonth(day, month)) {
    const currentYear = new Date().getFullYear()
    const today = Date.now()

    for(let i = currentYear; i >= minYear; i--) {
      if(month === 1 && day === 28 && !isLeapYear(i)) {
        continue
      }

      const date = new Date()
      date.setFullYear(i, month, day + 1)
      date.setHours(0, 0, 0)

      const minDate = date.getTime()
      if(minDate > today) {
        continue
      }

      date.setFullYear(i, month, day + 2)
      date.setHours(0, 0, 0)
      const maxDate = date.getTime() - 1
      if(i === currentYear) {
        dates.push({
          title: formatterDayMonth(minDate),
          minDate,
          maxDate,
        })
      } else {
        dates.push({
          title: formatterYearMax(minDate),
          minDate,
          maxDate,
        })
      }
    }
  }
}

// tweb :535-553
function formatterMonthYear(timestamp: number) {
  const date = new Date(timestamp)
  return monthsLocalized[date.getMonth()] + ' ' + date.getFullYear()
}

function formatterDayMonth(timestamp: number) {
  const date = new Date(timestamp)
  return monthsLocalized[date.getMonth()] + ' ' + date.getDate()
}

function formatterYearMax(timestamp: number) {
  const date = new Date(timestamp)
  return ('0' + date.getDate()).slice(-2) + '.' + ('0' + (date.getMonth() + 1)).slice(-2) + '.' + date.getFullYear()
}

function formatWeekLong(timestamp: number) {
  const date = new Date(timestamp)
  return daysLocalized[date.getDay()]!
}

// tweb :555-566
function validDateForMonth(day: number, month: number) {
  if(month >= 0 && month < 12) {
    if(day >= 0 && day < numberOfDaysEachMonth[month]!) {
      return true
    }
  }
  return false
}

function isLeapYear(year: number) {
  return ((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0)
}

// tweb :568-576 — и английское, и локализованное название.
function getMonth(q: string) {
  q = q.toLowerCase()
  for(let i = 0; i < 12; i++) {
    if([months[i]!, monthsLocalized[i]!].some((month) => month.toLowerCase().indexOf(q) === 0)) {
      return i
    }
  }
  return -1
}

// tweb :578-592 — только локализованное название (`formatWeekLong`), как у оригинала.
function getDayOfWeek(q: string) {
  const c = new Date()
  if(q.length <= 3) {
    return -1
  }

  for(let i = 0; i < 7; i++) {
    c.setDate(c.getDate() + 1)

    if(formatWeekLong(c.getTime()).toLowerCase().indexOf(q) === 0) {
      return c.getDay()
    }
  }
  return -1
}
