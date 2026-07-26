// Восстановление reply-бара из облачного черновика (draft.reply_to_id):
// поиск сообщения в окне + построение ReplyState тем же расчётом, что и
// «Ответить» из контекстного меню.
import { describe, it, expect } from 'vitest'
import { convMsgReplyState, draftReplyState } from './draftReply'
import { peerColor } from '../components/peerColor'
import type { ConvMsg } from '../data'

const msgs: ConvMsg[] = [
  { type: 'date', text: '21 июля' },
  { id: 10, type: 'text', out: false, sender: 'Боб', senderColor: '#e17076', text: 'привет' },
  { id: 11, type: 'text', out: true, text: 'ответ' },
  { id: 12, type: 'sticker', out: false, sender: 'Боб', emoji: '🔥' },
]

describe('draftReplyState', () => {
  it('восстанавливает reply по сообщению собеседника из окна', () => {
    expect(draftReplyState(msgs, 10, 'Чат', '#3390ec')).toEqual({
      msgId: 10, name: 'Боб', text: 'привет', color: '#e17076',
    })
  })

  it('своё сообщение: имя «Дн», цвет — accent', () => {
    expect(draftReplyState(msgs, 11, 'Чат', '#3390ec')).toEqual({
      msgId: 11, name: 'Дн', text: 'ответ', color: '#3390ec',
    })
  })

  it('без текста берётся emoji; без senderColor — peerColor(имя)', () => {
    expect(draftReplyState(msgs, 12, 'Чат', '#3390ec')).toEqual({
      msgId: 12, name: 'Боб', text: '🔥', color: peerColor('Боб'),
    })
  })

  it('сообщение вне окна → null (восстановление скипается)', () => {
    expect(draftReplyState(msgs, 99, 'Чат', '#3390ec')).toBeNull()
  })
})

describe('convMsgReplyState', () => {
  it('date-плашка не реплается', () => {
    expect(convMsgReplyState(msgs[0], undefined, 'Чат', '#3390ec')).toBeNull()
  })

  it('без sender у входящего — имя чата', () => {
    const m: ConvMsg = { id: 5, type: 'text', out: false, text: 'x' }
    const rs = convMsgReplyState(m, 5, 'Групп-чат', '#3390ec')
    expect(rs?.name).toBe('Групп-чат')
    expect(rs?.color).toBe(peerColor('Групп-чат'))
  })
})
