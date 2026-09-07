// Порт tweb `src/components/wrappers/sentTime.ts` — время отправки для строк
// поиска и shared media (`span.sent-time`, стили — `_searchSuper.scss`).
// Формат — `formatDateAccordingToTodayNew` (порт tweb `helpers/date.ts:107-129`):
// сегодня — часы:минуты, на этой неделе — день недели, иначе дата.
import { formatDateAccordingToTodayNew } from '@helpers/date'
import type { MyMessage } from '@core/models'

export default function wrapSentTime(message: MyMessage) {
  const el: HTMLElement = document.createElement('span')
  el.classList.add('sent-time')
  el.append(formatDateAccordingToTodayNew(new Date(message.date * 1000)))

  return el
}
