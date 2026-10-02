/**
 * Порт tweb `src/components/wrappers/callBubble.ts` (812502980) — бабл лога
 * звонка: какой это был звонок и чем кончился, строка статуса и иконка звонка
 * у правого края. Точка вызова — ветка `messageMediaCall` ленты
 * (`components/chat/bubbles.ts::renderCall`, tweb bubbles.ts:10067-10083).
 *
 * Строка статуса — время сообщения и после запятой длительность, если звонок
 * состоялся (`Chat.CallMessage.TimeAndDuration` = «%1$@, %2$@»). Её печатает сам
 * бабл, а не `setTime` ленты: у такого бабла нет своего блока времени и статуса
 * доставки (tweb bubbles.ts:9004-9012, `noMessageInfo`).
 *
 * Расхождение с оригиналом одно — конференц-звонков нет (О-1 волны 7, см.
 * шапку `lib/calls/helpers/callLog.ts`): ветка `messageActionConferenceCall`
 * (:115-142) с её рядом участников (`StackedAvatars`, `getConferenceCallParticipants`)
 * и `data-conference-msg-id` не перенесена — её нечем наполнить. Поэтому и
 * параметры `mid`/`fromId`/`middleware`/`loadPromises` (их читает только она)
 * сюда не приехали.
 */
import Icon from '@components/icon'
import Button from '@components/button'
import { wrapCallDuration } from '@components/wrappers/wrapDuration'
import { formatTime } from '@helpers/date'
import { _i18n, i18n, type LangPackKey } from '@lib/langPack'
import type { CallLogAction } from '@lib/calls/helpers/callLog'
import type { MessageActionPhoneCall } from '@core/messages/messageAction'

export type CallBubbleAction = CallLogAction

/**
 * tweb :41-71. Заголовок говорит, ЧЕМ кончился звонок (tdesktop
 * `MediaCall::Text`, Android `getCallMessageText`): исходящий без ответа —
 * отменённый, входящий без ответа — пропущенный, входящий, сброшенный
 * адресатом, — отклонённый. «Занято» у звонящего остаётся исходящим.
 */
function getPhoneCallLangKey(action: MessageActionPhoneCall, isOut: boolean): LangPackKey {
  const video = !!action.pFlags?.video
  const reason = action.reason?._
  if(isOut) {
    return reason === 'phoneCallDiscardReasonMissed'
      ? (video ? 'CallMessageVideoOutgoingMissed' : 'CallMessageOutgoingMissed')
      : (video ? 'CallMessageVideoOutgoing' : 'CallMessageOutgoing')
  }

  if(reason === 'phoneCallDiscardReasonMissed') {
    return video ? 'CallMessageVideoIncomingMissed' : 'CallMessageIncomingMissed'
  }

  if(reason === 'phoneCallDiscardReasonBusy') {
    return video ? 'CallMessageVideoIncomingDeclined' : 'CallMessageIncomingDeclined'
  }

  return video ? 'CallMessageVideoIncoming' : 'CallMessageIncoming'
}

/** tweb :88-151 (без конференц-ветки, см. шапку). */
export default function wrapCallBubble(options: {
  action: CallBubbleAction
  isOut: boolean
  /** Когда был звонок — с него начинается строка статуса. */
  date: number
}) {
  const { action, isOut, date } = options

  const element = Button('bubble-call', { noRipple: true })
  element.append(Icon(action.pFlags?.video ? 'videocamera' : 'phone', 'bubble-call-icon'))

  const title = document.createElement('div')
  title.classList.add('bubble-call-title')

  const subtitle = document.createElement('div')
  subtitle.classList.add('bubble-call-subtitle')

  const status = document.createElement('span')
  status.classList.add('bubble-call-status')
  const time = formatTime(new Date(date * 1000))
  status.append(action.duration !== undefined
    ? i18n('Chat.CallMessage.TimeAndDuration', [time, wrapCallDuration(action.duration)])
    : time)
  subtitle.append(status)

  // tweb :143-148 — тип звонка на самом узле: его читает перезвон по клику
  // (bubbles.ts:3617-3633, `callDiv.dataset.type`).
  element.dataset.type = action.pFlags?.video ? 'video' : 'voice'
  const isMissed = action.duration === undefined

  _i18n(title, getPhoneCallLangKey(action, isOut))

  subtitle.prepend(Icon('arrow_next', 'bubble-call-arrow', 'bubble-call-arrow-' + (isMissed ? 'red' : 'green')))

  element.append(title, subtitle)

  return { element }
}
