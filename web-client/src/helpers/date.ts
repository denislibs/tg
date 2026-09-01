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
 * (tweb `helpers/date/getFullDate.ts`). Остальное файла оригинала
 * (`getWeekDays`/`getMonths`/`fillLocalizedDates`, `formatDaysDuration`,
 * `formatMonthsDuration`) не перенесено: вызывающих нет.
 */
import I18n, { i18n } from '@lib/langPack'

export const ONE_DAY = 86400

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

/**
 * tweb `helpers/date/common.ts` — месяцы АНГЛИЙСКИМИ константами, и это не
 * недосмотр оригинала, а его выбор: единственный потребитель `months` —
 * `getFullDate`, а `getFullDate` рисует ТЕХНИЧЕСКУЮ дату (подсказка `title` у
 * времени бабла, метка в копируемом тексте), одинаковую во всех языках.
 * Локализованные месяцы у оригинала лежат отдельно (`monthsLocalized`, наполняет
 * `fillLocalizedDates`) и сюда не попадают.
 */
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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
