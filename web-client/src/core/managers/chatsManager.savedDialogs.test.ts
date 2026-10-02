// `chats.savedDialogs` — контейнер «Избранного» (`messages.savedDialogs`): строка
// несёт ССЫЛКУ `top_message`, а это номер в самом «Избранном» — у сообщения
// `peer_id` свой пир, а не источник (tweb `getMessageByPeer(myId, top_message)`).
// Найдено на стенде задачей 1-7 волны 7: у источников-людей и каналов превью
// строки было пустым — сообщение искали в чате источника.
import { describe, expect, it } from 'vitest'
import type { RestClient } from '../net/restClient'
import { generateMessageId } from '../history/messageId'
import type { MyMessage, RawMyMessage } from '../models'
import { getPeerId } from '../peers/peerId'
import { newChatsManager, type MessagesSavedDialogs } from './chatsManager'

const ME = 777001

/** Хранилище сообщений по чату — как `messagesManager` (`msgsByChat`, ключ — пир сообщения). */
function fakeMessages() {
  const byChat = new Map<number, Map<number, MyMessage>>()
  return {
    async saveApiMessages(raw: RawMyMessage[]) {
      return raw.map((m) => {
        const peerId = getPeerId(m.peer_id)
        const message = { ...m, id: generateMessageId(m.id), peerId } as unknown as MyMessage
        if(!byChat.has(peerId)) byChat.set(peerId, new Map())
        byChat.get(peerId)!.set(message.id, message)
        return message
      })
    },
    getMessageByPeer(peerId: number, seq: number) {
      return byChat.get(peerId)?.get(seq)
    },
  }
}

const raw = (id: number, text: string) => ({
  _: 'message', pFlags: { out: true }, id, date: 1786968000,
  peer_id: { _: 'peerUser', user_id: ME }, from_id: { _: 'peerUser', user_id: ME }, message: text,
}) as unknown as RawMyMessage

describe('chatsManager.savedDialogs', () => {
  it('последнее сообщение строки берётся из «Избранного», а не из чата источника', async() => {
    const container: MessagesSavedDialogs = {
      _: 'messages.savedDialogs',
      dialogs: [
        { _: 'savedDialog', peer: { _: 'peerChannel', channel_id: 2 }, top_message: 26 },
        { _: 'savedDialog', peer: { _: 'peerUser', user_id: 777002 }, top_message: 25 },
        { _: 'savedDialog', peer: { _: 'peerUser', user_id: ME }, top_message: 23 },
      ],
      messages: [raw(23, 'заметка'), raw(25, 'от Боба'), raw(26, 'из канала')],
      chats: [],
      users: [],
    }
    const rest = { get: async() => container } as unknown as RestClient
    const manager = newChatsManager({ rest, messages: fakeMessages() })

    const rows = await manager.savedDialogs()

    expect(rows.map((r) => r.peerId)).toEqual([-2, 777002, ME])
    expect(rows.map((r) => r.lastMessage && 'message' in r.lastMessage ? r.lastMessage.message : undefined))
    .toEqual(['из канала', 'от Боба', 'заметка'])
  })
})
