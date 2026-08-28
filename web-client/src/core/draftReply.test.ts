// Плашка «ответ» над композером: расчёт имени/цвета (`convMsgReplyState`) и
// сборка по НОМЕРУ сообщения из окна (`windowReplyState`) — общий путь для
// восстановления из облачного черновика (draft.reply_to_id), ответа жестом
// ленты и Ctrl/Cmd+↑.
import { describe, it, expect, beforeEach } from 'vitest'
import { convMsgReplyState, windowReplyState } from './draftReply'
import { peerColor } from '../components/peerColor'
import { applyPeerOps, resetPeerMirror } from './peerCache'
import { makeMessage, makeServiceMessage } from './messages/testMessage'
import type { MyMessage } from './models'
import type { ConvMsg } from '../data'
import type { User } from './peers/peer'

const ME = 1
const BOB = 2
const CHAT = 5

const user = (id: number, firstName: string): User => ({
  _: 'user', id, pFlags: {}, first_name: firstName,
})

// Окно так, как его отдаёт зеркало: сырые `MyMessage`, по возрастанию номера.
const win: MyMessage[] = [
  makeMessage({ id: 10, peerId: CHAT, fromId: BOB, text: 'привет', date: 1_750_000_000 }),
  makeMessage({ id: 11, peerId: CHAT, fromId: ME, out: true, text: 'ответ', date: 1_750_000_100 }),
  makeServiceMessage({ id: 12, peerId: CHAT, fromId: BOB, date: 1_750_000_200, action: { _: 'messageActionChatJoinedByLink', inviter_id: BOB } }),
]

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [user(BOB, 'Боб'), user(ME, 'Я')] }])
})

describe('windowReplyState', () => {
  it('сообщение собеседника из окна: имя автора из зеркала пиров, цвет по имени', () => {
    expect(windowReplyState(win, 10, 'Чат', '#3390ec', { meId: ME, peerId: CHAT, isGroup: true })).toEqual({
      msgId: 10, name: 'Боб', text: 'привет', color: peerColor('Боб'), peerId: BOB,
    })
  })

  it('вне группы имя автора не резолвится — у входящего стоит имя чата', () => {
    expect(windowReplyState(win, 10, 'Чат', '#3390ec', { meId: ME, peerId: CHAT })).toEqual({
      msgId: 10, name: 'Чат', text: 'привет', color: peerColor('Чат'), peerId: BOB,
    })
  })

  // Своё сообщение: имя берётся из КАРТОЧКИ ПИРА, как и любое другое, а цвет
  // остаётся accent'ом чата.
  //
  // Прежняя редакция этого теста требовала литерала `'Дн'` — чужой тестовой
  // заглушки, утёкшей в продуктовый код. Тест был зелёным, а плашка ответа на
  // своё сообщение живьём писала «Ответ Дн». Ошибку нашёл живой стенд, а не
  // сюита, потому что сюита фиксировала именно её.
  it('своё сообщение: имя из карточки пира, цвет — accent', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ME, first_name: 'Денис', pFlags: {} } as never] }])
    expect(windowReplyState(win, 11, 'Чат', '#3390ec', { meId: ME, peerId: CHAT, isGroup: true })).toEqual({
      msgId: 11, name: 'Денис', text: 'ответ', color: '#3390ec', peerId: ME,
    })
  })

  // Карточки ещё нет — плашка обязана назвать чат, а не пустоту и не заглушку.
  it('своё сообщение без карточки пира — фолбэк на имя чата', () => {
    resetPeerMirror()
    expect(windowReplyState(win, 11, 'Чат', '#3390ec', { meId: ME, peerId: CHAT, isGroup: true })?.name).toBe('Чат')
  })

  it('сообщение вне окна → null (восстановление скипается)', () => {
    expect(windowReplyState(win, 99, 'Чат', '#3390ec', { meId: ME, peerId: CHAT })).toBeNull()
  })

  it('пилюля тоже адресуема по номеру — текстом идёт её служебная строка', () => {
    const rs = windowReplyState(win, 12, 'Чат', '#3390ec', { meId: ME, peerId: CHAT, isGroup: true })
    expect(rs?.msgId).toBe(12)
    expect(rs?.text).not.toBe('')
  })
})

describe('convMsgReplyState', () => {
  it('date-плашка не реплается', () => {
    expect(convMsgReplyState({ type: 'date', text: '21 июля' }, undefined, 'Чат', '#3390ec')).toBeNull()
  })

  it('без sender у входящего — имя чата', () => {
    const m: ConvMsg = { id: 5, type: 'text', out: false, text: 'x' }
    const rs = convMsgReplyState(m, 5, 'Групп-чат', '#3390ec')
    expect(rs?.name).toBe('Групп-чат')
    expect(rs?.color).toBe(peerColor('Групп-чат'))
  })

  it('без текста берётся emoji; без senderColor — peerColor(имя)', () => {
    const m: ConvMsg = { id: 12, type: 'sticker', out: false, sender: 'Боб', emoji: '🔥' }
    expect(convMsgReplyState(m, 12, 'Чат', '#3390ec')).toEqual({
      msgId: 12, name: 'Боб', text: '🔥', color: peerColor('Боб'), peerId: undefined,
    })
  })
})
