import { describe, it, expect } from 'vitest'
import { serviceMsgSegs, serviceMsgText, UNSUPPORTED_ACTION } from './serviceMsg'
import { applyPeerOps } from './peerCache'
import { makeServiceMessage } from './messages/testMessage'
import type { MessageAction } from './messages/messageAction'

// Служебное действие — ОБЪЕДИНЕНИЕ КОНСТРУКТОРОВ (`messageService.action`), а не
// JSON внутри текста: дискриминатор больше не подделан ни разу.
//
// ИМЁН В ДЕЙСТВИИ НЕТ — только ссылки на пиров, как `messageActionChatAddUser`
// несёт `users:Vector<long>`. Поэтому фикстура заселяет ЗЕРКАЛО карточек, а имя
// подставляет `peerTitle`. Прежние фикстуры кормили поле `actor`, которого на
// проводе уже не существовало, — и потому оставались зелёными, пока пилюли в
// бою читались «Пользователь добавил(а) пользователя».
const ALICE = 5
const BOB = 6
applyPeerOps([
  { op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {} },
  ] },
])

const pill = (action: MessageAction, over: { replyToMsgId?: number; out?: boolean } = {}) =>
  makeServiceMessage({ id: 10, peerId: -1, fromId: ALICE, action, ...over })

describe('serviceMsgText', () => {
  it('renders joined_by_link (вступление по инвайт-ссылке)', () => {
    expect(serviceMsgText(pill({ _: 'messageActionChatJoinedByLink', inviter_id: BOB }))).toBe(
      'Алиса присоединился(ась) к группе по ссылке-приглашению от Боб',
    )
  })

  it('вступил по заявке (tweb `messageActionTextNewUnsafe.ts:416-425`): чужое — имя, своё — «заявка одобрена», канал — свои ключи', () => {
    applyPeerOps([{ op: 'upsert', peers: [
      { _: 'channel', id: 1, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } },
      { _: 'channel', id: 2, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } },
    ] }])
    const action: MessageAction = { _: 'messageActionChatJoinedByRequest' }
    expect(serviceMsgText(pill(action))).toBe('Алиса was accepted to the group')
    expect(serviceMsgSegs(pill(action))[0]).toEqual({ kind: 'peer', peerId: ALICE, fallback: 'Пользователь' })
    expect(serviceMsgText(pill(action, { out: true }))).toBe('Your request to join the group was approved')
    const inChannel = makeServiceMessage({ id: 10, peerId: -2, fromId: ALICE, action })
    expect(serviceMsgText(inChannel)).toBe('Алиса joined the channel by request')
  })

  it('renders edit_photo pill (фото едет ВНУТРИ действия, а не media_id рядом)', () => {
    expect(serviceMsgText(pill({ _: 'messageActionChatEditPhoto' }))).toBe('Алиса обновил(а) фото группы')
  })

  it('renders group lifecycle actions', () => {
    expect(serviceMsgText(pill({ _: 'messageActionChatCreate', title: 'Наш чат', users: [BOB] })))
      .toBe('Алиса создал(а) группу «Наш чат»')
    expect(serviceMsgText(pill({ _: 'messageActionChatAddUser', users: [BOB] }))).toBe('Алиса добавил(а) Боб')
    expect(serviceMsgText(pill({ _: 'messageActionChatLeave', user_id: ALICE }))).toBe('Алиса покинул(а) группу')
  })

  // Новое название теперь ЕДЕТ: прежде в действии был один `actor_id`, и пилюля
  // читалась «Имя изменил(а) название группы» без самого названия.
  it('переименование несёт новое название', () => {
    expect(serviceMsgText(pill({ _: 'messageActionChatEditTitle', title: 'Новое' })))
      .toBe('Алиса изменил(а) название группы на «Новое»')
  })

  // Незнакомый конструктор НЕ показывается сырым объектом: это служебная кишка,
  // а не текст пользователя. Так уже случалось вживую — бэкенд слал `restrict`,
  // разбор его не знал, и в пилюле висел `{"action":"restrict",...}`.
  it('незнакомый конструктор — честная заглушка, а не служебная кишка', () => {
    const m = pill({ _: 'messageActionTotallyUnknown' } as unknown as MessageAction)
    expect(serviceMsgText(m)).toBe(UNSUPPORTED_ACTION)
    expect(serviceMsgText(m)).not.toContain('{')
  })

  it('restrict — ограничение прав участника', () => {
    expect(serviceMsgText(pill({ _: 'messageActionRestrict', user_id: BOB })))
      .toBe('Алиса ограничил(а) права Боб')
  })

  // tweb Chat.Service.Group.UpdatedPinnedMessage: `%@ pinned "%@"`, где второй
  // аргумент — превью закреплённого (messageForReply). У самого действия
  // параметров НЕТ ВОВСЕ: цель находится по `reply_to`, превью строит клиент.
  describe('pin_message', () => {
    const pin = pill({ _: 'messageActionPinMessage' }, { replyToMsgId: 42 })

    it('quotes the pinned preview, собранное вызывающим', () => {
      expect(serviceMsgText(pin, 'привет')).toBe('Алиса закрепил(а) "привет"')
    })

    it('falls back to ActionPinnedNoText, когда превью нет', () => {
      expect(serviceMsgText(pin)).toBe('Алиса закрепил(а) сообщение')
    })

    it('exposes the author and the pinned message as clickable segments', () => {
      expect(serviceMsgSegs(pin, 'привет')).toEqual([
        // У сегмента-пира имени НЕТ — только ссылка; имя подставит рендерер.
        { kind: 'peer', peerId: ALICE, fallback: 'Пользователь' },
        { kind: 'text', text: ' закрепил(а) "' },
        { kind: 'msg', text: 'привет', msgId: 42 },
        { kind: 'text', text: '"' },
      ])
    })
  })
})

// Лог звонка пилюлей не рисуется, но ТЕКСТОМ он есть — превью строки списка
// чатов и плашки ответа. Порт tweb: вид `action.type`
// (appMessagesManager.ts:7303-7314) → ключ `messageActionPhoneCall.<type>`
// (lib/langPack.ts:51-58) с длительностью аргументом
// (messageActionTextNewUnsafe.ts:248-253). Прежде строка была пустой.
describe('serviceMsgText: лог звонка', () => {
  const call = (action: Omit<Extract<MessageAction, { _: 'messageActionPhoneCall' }>, '_'>, out = false) =>
    serviceMsgText(pill({ _: 'messageActionPhoneCall', ...action }, { out }))

  it('несостоявшийся: пропущен по причине Missed, иначе отменён — сторона не важна', () => {
    expect(call({ reason: { _: 'phoneCallDiscardReasonMissed' } }, true)).toBe('Missed Call')
    expect(call({ reason: { _: 'phoneCallDiscardReasonMissed' } })).toBe('Missed Call')
    expect(call({ reason: { _: 'phoneCallDiscardReasonHangup' } }, true)).toBe('Canceled Call')
    expect(call({ reason: { _: 'phoneCallDiscardReasonBusy' } })).toBe('Canceled Call')
  })

  it('состоявшийся: сторона из pFlags.out и длительность двумя разрядами', () => {
    expect(call({ duration: 65 }, true)).toBe('Outgoing Call (1 minute, 5 seconds)')
    expect(call({ duration: 3 })).toBe('Incoming Call (3 seconds)')
  })

  it('видеозвонок — свои ключи', () => {
    expect(call({ pFlags: { video: true }, reason: { _: 'phoneCallDiscardReasonMissed' } })).toBe('Missed Video Call')
    expect(call({ pFlags: { video: true }, reason: { _: 'phoneCallDiscardReasonHangup' } }, true)).toBe('Canceled Video Call')
    expect(call({ pFlags: { video: true }, duration: 3 }, true)).toBe('Outgoing Video Call (3 seconds)')
  })
})
