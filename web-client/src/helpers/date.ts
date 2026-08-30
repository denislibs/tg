/**
 * Порт tweb `src/helpers/date.ts` в объёме ОДНОГО потребителя — метки
 * последней активности сессии во вкладке «Устройства»
 * (`sidebarLeft/tabs/activeSessions.tsx:35`). Портированы ровно три вещи:
 * `ONE_DAY` (:9), `getWeekNumber` (:59-67) и `formatDateAccordingToTodayNew`
 * (:107-129). Остальные ~20 функций файла оригинала не переносятся: у них в
 * этом репозитории нет ни одного вызывающего, а тянут они за собой langPack
 * (`monthsLocalized`/`daysLocalized`, `formatDaysDuration` и т.д.), который
 * не портирован.
 *
 * Смысл функции: ОДНА метка времени, чья ПОДРОБНОСТЬ зависит от того, как
 * давно было событие, — сегодня достаточно часов, на этой неделе хватает дня
 * недели, в прошлом году без года не обойтись.
 *
 * Метку строит `new I18n.IntlDateElement({date, options}).element` — дословно как
 * оригинал (:125-128). До задачи 7 здесь стоял свой `Intl.DateTimeFormat` в
 * `i18nSpan`, и это был ДЕФЕКТ, а не упрощение: ветка `hour+minute` ядра
 * (langPack.ts:624-633) собирает «ЧЧ:ММ» РУКАМИ, минуя `Intl`, — только чтобы
 * уважить пользовательскую настройку 12/24 часа, у `Intl` её взять неоткуда (он
 * выбирает цикл по ЛОКАЛИ). Настройка у нас есть и переключатель у неё живой
 * (`settings/GeneralSettings.tsx`), то есть метки времени ВЫБОР ПОЛЬЗОВАТЕЛЯ
 * ИГНОРИРОВАЛИ. Связь настройки с `I18n.setTimeFormat` заведена в `settings.tsx`,
 * там же разбор; заглавную букву («пн», «авг.») ставит сам `IntlDateElement`
 * (`capitalizeFirstLetter`, langPack.ts:637).
 */
import I18n from '@lib/langPack'

export const ONE_DAY = 86400

// tweb :58-67 — https://stackoverflow.com/a/6117889
export const getWeekNumber = (date: Date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  // getTime() в миллисекундах, ONE_DAY — в секундах
  return Math.ceil((((d.getTime() - yearStart.getTime()) / (ONE_DAY * 1000)) + 1) / 7)
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
