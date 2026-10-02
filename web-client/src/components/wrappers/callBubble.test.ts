// Бабл лога звонка — порт tweb `components/wrappers/callBubble.ts` (812502980).
//
// Пинуется то, что увидит пользователь, на НАСТОЯЩЕМ ядре локализации: заголовок
// говорит, ЧЕМ кончился звонок (tweb `getPhoneCallLangKey`, :49-71), строка
// статуса — время звонка и после запятой длительность (`Chat.CallMessage.
// TimeAndDuration`, :107-111), стрелка — красная у несостоявшегося (:146).
//
// Матрица исходов — ровно те, что производит сервер
// (`backend/internal/usecase/chat/phonecall.go:150-176`): разговор — Hangup/
// Disconnect с длительностью (`0` у отвеченного короче секунды), не ответили и
// бросил звонящий — Missed, адресат отклонил/занят — Busy; без длительности.
// Каждый исход виден ОБЕИМ сторонам — одно сообщение, `out` у каждой свой.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MessageActionPhoneCall, PhoneCallDiscardReason } from '@core/messages/messageAction'
import { formatTime } from '@helpers/date'
import { getIconContent } from '@components/icon'
import { applyLang } from '@/test/lang'
import wrapCallBubble from './callBubble'

const CALL_DATE = 1_790_000_000
const CALL_TIME = () => formatTime(new Date(CALL_DATE * 1000)).textContent

type Reason = PhoneCallDiscardReason['_']

const action = (reason: Reason, over: { video?: boolean, duration?: number } = {}): MessageActionPhoneCall => ({
  _: 'messageActionPhoneCall',
  pFlags: over.video ? { video: true } : {},
  reason: { _: reason } as PhoneCallDiscardReason,
  ...(over.duration !== undefined ? { duration: over.duration } : {}),
})

const wrap = (a: MessageActionPhoneCall, isOut: boolean) =>
  wrapCallBubble({ action: a, isOut, date: CALL_DATE }).element

const title = (a: MessageActionPhoneCall, isOut: boolean) =>
  wrap(a, isOut).querySelector('.bubble-call-title')!.textContent

const status = (a: MessageActionPhoneCall, isOut: boolean) =>
  wrap(a, isOut).querySelector('.bubble-call-status')!.textContent

const arrow = (a: MessageActionPhoneCall, isOut: boolean) => {
  const el = wrap(a, isOut)
  return el.querySelector('.bubble-call-arrow-green') ? 'green'
    : el.querySelector('.bubble-call-arrow-red') ? 'red' : 'none'
}

describe('wrapCallBubble — заголовок говорит, чем кончился звонок', () => {
  beforeAll(() => applyLang('en'))

  // [исход сервера, сторона, видео?, длительность] → заголовок, стрелка.
  const MATRIX: [Reason, boolean, boolean, number | undefined, string, 'green' | 'red'][] = [
    // разговор состоялся
    ['phoneCallDiscardReasonHangup', true, false, 65, 'Outgoing Call', 'green'],
    ['phoneCallDiscardReasonHangup', false, false, 65, 'Incoming Call', 'green'],
    ['phoneCallDiscardReasonHangup', true, true, 65, 'Outgoing Video Call', 'green'],
    ['phoneCallDiscardReasonHangup', false, true, 65, 'Incoming Video Call', 'green'],
    ['phoneCallDiscardReasonDisconnect', true, false, 0, 'Outgoing Call', 'green'],
    ['phoneCallDiscardReasonDisconnect', false, true, 0, 'Incoming Video Call', 'green'],
    // не ответили, бросил звонящий (или истекло ожидание)
    ['phoneCallDiscardReasonMissed', true, false, undefined, 'Cancelled Call', 'red'],
    ['phoneCallDiscardReasonMissed', false, false, undefined, 'Missed Call', 'red'],
    ['phoneCallDiscardReasonMissed', true, true, undefined, 'Cancelled Video Call', 'red'],
    ['phoneCallDiscardReasonMissed', false, true, undefined, 'Missed Video Call', 'red'],
    // адресат отклонил / занят: у звонящего — «исходящий» (tweb :56-58 держит его
    // на исходящем ключе), у адресата — «отклонённый»
    ['phoneCallDiscardReasonBusy', true, false, undefined, 'Outgoing Call', 'red'],
    ['phoneCallDiscardReasonBusy', false, false, undefined, 'Declined Call', 'red'],
    ['phoneCallDiscardReasonBusy', true, true, undefined, 'Outgoing Video Call', 'red'],
    ['phoneCallDiscardReasonBusy', false, true, undefined, 'Declined Video Call', 'red'],
  ]

  it.each(MATRIX)('%s, out=%s, video=%s, duration=%s → «%s», стрелка %s', (reason, isOut, video, duration, expected, color) => {
    const a = action(reason, { video, duration })
    expect(title(a, isOut)).toBe(expected)
    expect(arrow(a, isOut)).toBe(color)
  })

  it('без причины и без длительности — входящий, красная стрелка', () => {
    const a: MessageActionPhoneCall = { _: 'messageActionPhoneCall' }
    expect(title(a, false)).toBe('Incoming Call')
    expect(arrow(a, false)).toBe('red')
  })
})

describe('wrapCallBubble — строка статуса', () => {
  beforeAll(() => applyLang('en'))

  it('несостоявшийся звонок — только время', () => {
    expect(status(action('phoneCallDiscardReasonMissed'), true)).toBe(CALL_TIME())
  })

  it('состоявшийся — время и после запятой длительность формами числа', () => {
    expect(status(action('phoneCallDiscardReasonHangup', { duration: 65 }), false))
      .toBe(`${CALL_TIME()}, 1 minute, 5 seconds`)
  })

  it('отвеченный короче секунды («0») — всё равно состоялся: «1 second»', () => {
    expect(status(action('phoneCallDiscardReasonHangup', { duration: 0 }), true))
      .toBe(`${CALL_TIME()}, 1 second`)
  })

  it('стрелка стоит ПЕРЕД статусом, внутри подписи', () => {
    const subtitle = wrap(action('phoneCallDiscardReasonHangup', { duration: 3 }), true)
      .querySelector('.bubble-call-subtitle')!
    expect(subtitle.firstElementChild!.classList.contains('bubble-call-arrow')).toBe(true)
    expect(subtitle.lastElementChild!.classList.contains('bubble-call-status')).toBe(true)
  })
})

describe('wrapCallBubble — узел', () => {
  beforeAll(() => applyLang('en'))

  it('кнопка .bubble-call без рипла, тип звонка — на узле (его читает перезвон)', () => {
    const voice = wrap(action('phoneCallDiscardReasonHangup', { duration: 1 }), true)
    expect(voice.tagName).toBe('BUTTON')
    expect(voice.className).toBe('bubble-call')
    expect(voice.dataset.type).toBe('voice')
    expect(voice.querySelector('.c-ripple')).toBeNull()

    const video = wrap(action('phoneCallDiscardReasonHangup', { video: true, duration: 1 }), true)
    expect(video.dataset.type).toBe('video')
  })

  it('иконка у края: телефон или камера', () => {
    const icon = (video: boolean) => wrap(action('phoneCallDiscardReasonMissed', { video }), false)
      .querySelector('.bubble-call-icon')!.textContent
    expect(icon(false)).toBe(getIconContent('phone'))
    expect(icon(true)).toBe(getIconContent('videocamera'))
  })

  it('порядок детей: иконка, заголовок, подпись', () => {
    const el = wrap(action('phoneCallDiscardReasonMissed'), false)
    expect([...el.children].map((c) => c.classList[0])).toEqual(['tgico', 'bubble-call-title', 'bubble-call-subtitle'])
  })
})

describe('wrapCallBubble — перевод', () => {
  beforeAll(() => applyLang('ru'))
  afterAll(() => applyLang('en'))

  it('русский: отменённый, пропущенный, отклонённый', () => {
    expect(title(action('phoneCallDiscardReasonMissed'), true)).toBe('Отменённый звонок')
    expect(title(action('phoneCallDiscardReasonMissed'), false)).toBe('Пропущенный звонок')
    expect(title(action('phoneCallDiscardReasonBusy'), false)).toBe('Отклонённый звонок')
    expect(title(action('phoneCallDiscardReasonMissed', { video: true }), true)).toBe('Отменённый видеозвонок')
    expect(title(action('phoneCallDiscardReasonMissed', { video: true }), false)).toBe('Пропущенный видеозвонок')
    expect(title(action('phoneCallDiscardReasonBusy', { video: true }), false)).toBe('Отклонённый видеозвонок')
    expect(title(action('phoneCallDiscardReasonHangup', { video: true, duration: 2 }), false)).toBe('Входящий видеозвонок')
  })

  it('русский: длительность склоняется', () => {
    expect(status(action('phoneCallDiscardReasonHangup', { duration: 65 }), false))
      .toBe(`${CALL_TIME()}, 1 минута, 5 секунд`)
  })
})
