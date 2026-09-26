// Диспетчер поиска истории — порт развилки tweb `requestHistory`
// (`lib/appManagers/appMessagesManager.ts:9966-10003`): классу `AppSearchSuper`
// отдаётся ОДИН метод, а ручку выбирает воркер по контексту поиска. Пины — на
// ФАКТИЧЕСКИЙ адрес запроса и на то, что вернулось наружу (сообщения, счётчик,
// курсор), а не на «позвали такой-то метод с такими-то аргументами».
import { describe, it, expect } from 'vitest'
import { newMessagesManager } from './messagesManager'
import type { RestClient } from '../net/restClient'
import type { RawMessage } from '../models'
import { generateMessageId } from '../history/messageId'
import { makeRawMessage } from '../messages/testMessage'

const cid = generateMessageId

/** Фейковый REST: пишет путь и параметры, отвечает контейнером
 *  `messages.messagesSlice` c одним сообщением и заданным хвостом. */
function recordingRest(reply: Record<string, unknown> = {}) {
  const calls: { path: string, query: Record<string, string | number> }[] = []
  const rest = {
    get: async (path: string, query?: Record<string, string | number>) => {
      calls.push({ path, query: query ?? {} })
      const messages = [makeRawMessage({
        id: 41, peerId: 5, fromId: 7, text: 'кот', createdAt: '2026-06-24T10:00:00Z',
      }) as RawMessage]
      return { _: 'messages.messagesSlice', messages, users: [], chats: [], count: 9, ...reply }
    },
    post: async () => ({}),
  } as unknown as RestClient
  return { rest, calls }
}

describe('MessagesManager.searchHistory — развилка requestHistory', () => {
  // tweb `:9966` — пир задан, курсора глобальной выдачи нет и `folderId`
  // не задан: поиск в ОДНОМ чате. Без запроса и дат у нас это ручка шаред-медиа.
  it('пир + фильтр без запроса → /chats/{id}/media по курсору offset_id', async () => {
    const { rest, calls } = recordingRest({ next_rate: 99 })
    const r = await newMessagesManager({ rest }).searchHistory({
      peerId: 5, inputFilter: { _: 'inputMessagesFilterPhotoVideo' }, query: '', offsetId: cid(77), limit: 30,
    })

    expect(calls).toEqual([{ path: '/chats/5/media', query: { filter: 'media', offset_id: 77, limit: 30 } }])
    expect(r.messages.map((m) => m.id)).toEqual([cid(41)])
    expect(r.count).toBe(9)
    // курсор глобальной выдачи — только из глобальной ветки
    expect(r.nextRate).toBeUndefined()
  })

  it('пир + запрос → /chats/{id}/search: q, filter, offset_id', async () => {
    const { rest, calls } = recordingRest({ next_rate: 99 })
    const r = await newMessagesManager({ rest }).searchHistory({
      peerId: 5, inputFilter: { _: 'inputMessagesFilterDocument' }, query: 'отчёт', offsetId: cid(12), limit: 20,
    })

    expect(calls).toEqual([{ path: '/chats/5/search', query: { q: 'отчёт', filter: 'files', offset_id: 12, limit: 20 } }])
    expect(r.messages.map((m) => m.id)).toEqual([cid(41)])
    expect(r.nextRate).toBeUndefined()
  })

  // Чип пира без текста (`appSearchSuper.ts:2233-2236`): `messages.search` с
  // пустым `q` и `inputMessagesFilterEmpty` — вся история чата; фильтра на
  // проводе нет вовсе.
  it('пир + пустой фильтр без запроса → /chats/{id}/search без filter', async () => {
    const { rest, calls } = recordingRest()
    await newMessagesManager({ rest }).searchHistory({
      peerId: 5, inputFilter: { _: 'inputMessagesFilterEmpty' }, query: '', limit: 20,
    })

    expect(calls).toEqual([{ path: '/chats/5/search', query: { q: '', offset_id: 0, limit: 20 } }])
  })

  // `/chats/{id}/media` дат не принимает, а оригинал шлёт их в
  // `messages.search` (`:9976-9977`) — чип даты с чипом пира уводит на поиск.
  it('пир + фильтр + даты без запроса → /chats/{id}/search с датами секундами', async () => {
    const { rest, calls } = recordingRest()
    await newMessagesManager({ rest }).searchHistory({
      peerId: 5, inputFilter: { _: 'inputMessagesFilterUrl' }, query: '',
      minDate: 1768089600000, maxDate: 1768175999999, limit: 20,
    })

    expect(calls).toEqual([{
      path: '/chats/5/search',
      query: { q: '', filter: 'links', offset_id: 0, limit: 20, min_date: 1768089600, max_date: 1768175999 },
    }])
  })

  // tweb `:9987-10003` — всё прочее: `messages.searchGlobal` с `offset_rate`
  // из курсора и флагами типа чата; `next_rate` ответа уходит наружу (`:9432`).
  it('без пира → /search/messages: offset_rate, chat_type, даты; nextRate наружу', async () => {
    const { rest, calls } = recordingRest({ next_rate: 4242 })
    const r = await newMessagesManager({ rest }).searchHistory({
      peerId: 0, folderId: 0, inputFilter: { _: 'inputMessagesFilterEmpty' }, query: 'кот',
      offsetId: cid(41), nextRate: 5000, chatType: 'groups',
      minDate: 1768089600000, maxDate: 1768175999999, limit: 30,
    })

    expect(calls).toEqual([{
      path: '/search/messages',
      query: {
        q: 'кот', filter: '', offset_rate: 5000, limit: 30,
        chat_type: 'groups', min_date: 1768089600, max_date: 1768175999,
      },
    }])
    expect(r.messages.map((m) => m.id)).toEqual([cid(41)])
    expect(r.count).toBe(9)
    expect(r.nextRate).toBe(4242)
  })

  it('глобально: последняя страница без next_rate — nextRate нет; chatType all — без chat_type', async () => {
    const { rest, calls } = recordingRest()
    const r = await newMessagesManager({ rest }).searchHistory({
      peerId: 0, folderId: 0, inputFilter: { _: 'inputMessagesFilterMusic' }, query: 'бах',
      chatType: 'all', limit: 30,
    })

    expect(calls).toEqual([{ path: '/search/messages', query: { q: 'бах', filter: 'music', offset_rate: 0, limit: 30 } }])
    expect(r.nextRate).toBeUndefined()
  })

  // Условие оригинала — `peerId && !nextRate && folderId === undefined`: пир
  // сам по себе поиск в чате не включает.
  it('пир с folderId: 0 → глобально', async () => {
    const { rest, calls } = recordingRest()
    await newMessagesManager({ rest }).searchHistory({
      peerId: 5, folderId: 0, inputFilter: { _: 'inputMessagesFilterEmpty' }, query: 'кот', limit: 20,
    })

    expect(calls.map((c) => c.path)).toEqual(['/search/messages'])
  })

  it('пир с курсором глобальной выдачи → глобально, курсор уходит offset_rate', async () => {
    const { rest, calls } = recordingRest()
    await newMessagesManager({ rest }).searchHistory({
      peerId: 5, nextRate: 700, inputFilter: { _: 'inputMessagesFilterEmpty' }, query: 'кот', limit: 20,
    })

    expect(calls).toEqual([{ path: '/search/messages', query: { q: 'кот', filter: '', offset_rate: 700, limit: 20 } }])
  })
})
