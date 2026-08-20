import { describe, it, expect } from 'vitest'
import { serviceMsgSegs, serviceMsgText, UNSUPPORTED_ACTION } from './serviceMsg'
import { applyPeerOps } from './peerCache'

// Бэк хранит сервисное действие как JSON (зеркало tweb messageAction); клиент
// собирает локализованную пилюлю. Проверяем разбор ключевых действий.
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

const raw = (action: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ action, actor_id: ALICE, ...extra })

describe('serviceMsgText', () => {
  it('renders joined_by_link (вступление по инвайт-ссылке)', () => {
    expect(serviceMsgText(raw('joined_by_link'))).toBe(
      'Алиса присоединился(ась) к группе по ссылке-приглашению',
    )
  })

  it('renders edit_photo pill (media rides on media_id, not the text)', () => {
    expect(serviceMsgText(raw('edit_photo'))).toBe('Алиса обновил(а) фото группы')
  })

  it('renders group lifecycle actions', () => {
    expect(serviceMsgText(raw('group_create'))).toBe('Алиса создал(а) группу')
    expect(serviceMsgText(raw('add_user', { user_id: BOB }))).toBe('Алиса добавил(а) Боб')
    expect(serviceMsgText(raw('leave'))).toBe('Алиса покинул(а) группу')
  })

  it('passes through plain (non-JSON) service strings untouched', () => {
    expect(serviceMsgText('Сообщения зашифрованы')).toBe('Сообщения зашифрованы')
  })

  // Незнакомое действие НЕ показывается сырым JSON: это служебная кишка, а не
  // текст пользователя. Так уже случалось вживую — бэкенд слал `restrict`,
  // разбор его не знал, и в пилюле висел `{"action":"restrict",...}`.
  it('незнакомое действие — честная заглушка, а не сырой JSON', () => {
    const r = raw('totally_unknown')
    expect(serviceMsgText(r)).toBe(UNSUPPORTED_ACTION)
    expect(serviceMsgText(r)).not.toContain('{')
  })

  it('restrict — ограничение прав участника', () => {
    expect(serviceMsgText(raw('restrict', { user_id: BOB, denied_rights: 5 })))
      .toBe('Алиса ограничил(а) права Боб')
  })

  // tweb Chat.Service.Group.UpdatedPinnedMessage: `%@ pinned "%@"`, где второй
  // аргумент — превью закреплённого (messageForReply).
  describe('pin_message', () => {
    const pin = (extra: Record<string, unknown>) =>
      raw('pin_message', { msg_id: 42, msg_seq: 5, ...extra })

    it('quotes the pinned text', () => {
      expect(serviceMsgText(pin({ msg_type: 'text', msg_text: 'привет' }))).toBe(
        'Алиса закрепил(а) "привет"',
      )
    })

    it('renders audio tags with the 🎵 prefix', () => {
      expect(
        serviceMsgText(pin({ msg_type: 'audio', msg_name: 'Батырбек далбоеб - denis1488' })),
      ).toBe('Алиса закрепил(а) "🎵 Батырбек далбоеб - denis1488"')
    })

    it('labels caption-less media by type, and appends the caption after it', () => {
      expect(serviceMsgText(pin({ msg_type: 'photo' }))).toBe('Алиса закрепил(а) "Фотография"')
      expect(serviceMsgText(pin({ msg_type: 'photo', msg_text: 'вид' }))).toBe(
        'Алиса закрепил(а) "Фотография, вид"',
      )
    })

    it('falls back to ActionPinnedNoText when there is no preview at all', () => {
      expect(serviceMsgText(pin({ msg_type: 'poll' }))).toBe('Алиса закрепил(а) сообщение')
    })

    it('exposes the author and the pinned message as clickable segments', () => {
      expect(serviceMsgSegs(pin({ msg_type: 'text', msg_text: 'привет' }))).toEqual([
        // У сегмента-пира имени НЕТ — только ссылка; имя подставит рендерер.
        { kind: 'peer', peerId: ALICE, fallback: 'Пользователь' },
        { kind: 'text', text: ' закрепил(а) "' },
        { kind: 'msg', text: 'привет', msgId: 42, seq: 5 },
        { kind: 'text', text: '"' },
      ])
    })
  })
})
