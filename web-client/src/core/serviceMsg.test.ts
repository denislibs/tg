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
