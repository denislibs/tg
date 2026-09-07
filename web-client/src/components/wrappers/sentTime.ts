/**
 * Порт tweb `src/components/wrappers/sentTime.ts` (`wrapSentTime`) — короткая
 * дата отправки справа от имени файла/трека в shared-media («14:30», «вт»,
 * «5 сент.», «05.09.2025» — по удалённости, `formatDateAccordingToTodayNew`).
 */
import { formatDateAccordingToTodayNew } from '@helpers/date'

export default function wrapSentTime(message: { date: number }): HTMLElement {
  const el = document.createElement('span')
  el.classList.add('sent-time')
  el.append(formatDateAccordingToTodayNew(new Date(message.date * 1000)))

  return el
}
