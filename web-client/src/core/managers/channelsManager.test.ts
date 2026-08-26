// src/core/managers/channelsManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newChannelsManager } from './channelsManager'
import type { RestClient } from '../net/restClient'
import type { MessageReal, MyMessage, RawMessage } from '../models'
import { generateMessageId } from '../history/messageId'
import { makeRawMessage } from '../messages/testMessage'

// Владелец карточек пиров: авторы последних комментариев приезжают попутно и
// обязаны доехать до зеркала (`saveApiPeers`) — см. commentCounts.
const fakePeers = () => ({ saveApiPeers: vi.fn() })

/** Номер в КЛИЕНТСКОМ пространстве. */
const cid = generateMessageId

function raw(id: number, threadRootId?: number): RawMessage {
  return makeRawMessage({
    id, peerId: 7, fromId: 1, text: `m${id}`, createdAt: '2026-06-24T10:00:00Z', threadRootId,
  }) as RawMessage
}

const real = (m: MyMessage): MessageReal | undefined => (m._ === 'message' ? m : undefined)

describe('ChannelsManager.createChannel', () => {
  // Ответ создания — СОЗДАННЫЙ объект (messages.chatFull), а не адрес в
  // обёртке: ключ пира выводится из краткой карточки, и она же сразу уезжает
  // в зеркало пиров.
  it('POSTs /channels and returns the new chat id', async () => {
    const card = {
      _: 'messages.chatFull',
      full_chat: { _: 'channelFull', id: 42 },
      chats: [{ _: 'channel', id: 42, title: 'News', pFlags: { broadcast: true } }],
      users: [],
    }
    const post = vi.fn(async () => card)
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const peers = fakePeers()
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers })
    const id = await mgr.createChannel({ title: 'News', isPublic: true })
    expect(id).toBe(-42)
    expect(peers.saveApiPeers).toHaveBeenCalledWith(card)
    expect(post).toHaveBeenCalledWith('/channels', { title: 'News', about: '', username: '', is_public: true })
  })
})

describe('ChannelsManager.post', () => {
  it('POSTs /channels/{id}/messages and returns a mapped Message', async () => {
    const post = vi.fn(async () => raw(6))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const m = await mgr.post(7, 'hey', 'c1')
    expect(post).toHaveBeenCalledWith('/channels/7/messages', { text: 'hey', entities: undefined, client_msg_id: 'c1' })
    expect(m.peerId).toBe(7)
    expect(m.id).toBe(cid(6))
    expect(real(m)?.message).toBe('m6')
  })

  // Разметка поста (bold/text_link/mention/hashtag) обязана уехать на бэк: без
  // неё пост канала приходит подписчикам голым текстом.
  it('передаёт entities поста в теле запроса', async () => {
    const post = vi.fn(async () => raw(6))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const entities = [{ _: 'messageEntityBold' as const, offset: 0, length: 6 }]

    await mgr.post(7, 'Голова: Мария', 'c1', entities)

    expect(post).toHaveBeenCalledWith('/channels/7/messages', { text: 'Голова: Мария', entities, client_msg_id: 'c1' })
  })

  // Что ломается, если гарантия нарушена: пост канала уходит по REST, мимо
  // messages.sendText, поэтому временный бабл заводит именно этот путь.
  // Пропади вызов — свой только что отправленный пост не появлялся бы в ленте до
  // живого эха new_message. Заявка уходит ДО сети: бабл не должен ждать ответа.
  it('optimistic: заявка на временный бабл уходит ДО POST, с текстом и разметкой поста', async () => {
    const order: string[] = []
    const post = vi.fn(async () => { order.push('post'); return raw(6) })
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const pendings: unknown[] = []
    const mgr = newChannelsManager({ rest, beforeSending: (p) => { order.push('pending'); pendings.push(p) }, peers: fakePeers() })
    const entities = [{ _: 'messageEntityBold' as const, offset: 0, length: 2 }]

    await mgr.post(7, 'пост', 'c9', entities, { senderId: 3, threadRootId: null })

    expect(order).toEqual(['pending', 'post'])
    expect(pendings).toEqual([{
      peer_id: 7, thread_root_id: null, client_msg_id: 'c9', sender_id: 3, text: 'пост', type: 'text', entities,
      // Порт опции tweb `beforeMessageSending({sequential})`: между баблом и
      // уходом запроса ничего не ждём, поэтому позиция бабла внизу окна
      // переживёт финализацию — лента на этом признаке срезает перекладку.
      sequential: true,
    }])
  })

  it('без optimistic бабл не заводится (публикация из мест без ленты на экране)', async () => {
    const post = vi.fn(async () => raw(6))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const beforeSending = vi.fn()
    const mgr = newChannelsManager({ rest, beforeSending, peers: fakePeers() })

    await mgr.post(7, 'пост', 'c10')

    expect(beforeSending).not.toHaveBeenCalled()
  })
})

describe('ChannelsManager.enableDiscussion', () => {
  it('POSTs /channels/{id}/discussion and returns discussion_peer_id', async () => {
    const post = vi.fn(async () => ({ discussion_peer_id: 555 }))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const id = await mgr.enableDiscussion(7)
    expect(post).toHaveBeenCalledWith('/channels/7/discussion', {})
    expect(id).toBe(555)
  })
})

describe('ChannelsManager.postComment', () => {
  it('POSTs comment and returns a mapped Message with the thread root inside reply_to', async () => {
    const post = vi.fn(async () => raw(9, 3))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const m = await mgr.postComment(7, 3, 'hi', 'c2')
    expect(post).toHaveBeenCalledWith('/channels/7/posts/3/comments', { text: 'hi', client_msg_id: 'c2' })
    expect(m.id).toBe(cid(9))
    // Корень треда живёт ВНУТРИ ссылки на ответ (`reply_to.reply_to_top_id`) —
    // отдельного поля рядом с сообщением больше нет.
    expect(m.reply_to?.reply_to_top_id).toBe(cid(3))
  })
})

describe('ChannelsManager.listComments', () => {
  it('GETs comments and maps {messages,count}', async () => {
    const get = vi.fn(async () => ({ messages: [raw(1), raw(2)], count: 2 }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const r = await mgr.listComments(7, 3)
    expect(get).toHaveBeenCalledWith('/channels/7/posts/3/comments', { offset: 0, limit: 50 })
    expect(r.count).toBe(2)
    expect(r.messages.map((m) => m.id)).toEqual([cid(1), cid(2)])
    expect(r.messages[0].reply_to).toBeUndefined()
  })

  it('handles missing messages array', async () => {
    const get = vi.fn(async () => ({ count: 0 }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const r = await mgr.listComments(7, 3)
    expect(r.messages).toEqual([])
  })
})

describe('ChannelsManager.commentCounts', () => {
  // Ответ — контейнер `messages.messageViews`, вектор в нём ПОЗИЦИОННЫЙ:
  // i-й элемент отвечает i-му номеру запроса. «Про этот пост сказать нечего» —
  // конструктор БЕЗ параметров, а не ноль: у поста без комментариев треда не
  // существует вовсе, и счётчика для него в модели быть не должно.
  it('разбирает позиционный вектор счётчиков, а пробел не становится нулём', async () => {
    const get = vi.fn(async () => ({
      _: 'messages.messageViews',
      views: [
        { _: 'messageViews', replies: { _: 'messageReplies', replies: 2 } },
        { _: 'messageViews' },
      ],
      chats: [], users: [],
    }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const r = await mgr.commentCounts(7, [5, 6])
    expect(get).toHaveBeenCalledWith('/channels/7/comment_counts', { ids: '5,6' })
    expect(r.counts).toEqual({ 5: 2 })
  })

  // Комментаторы приезжают ССЫЛКАМИ на пиров и кладутся вербатим: стек
  // аватаров рисует их по ключу, а имя и фото берёт из зеркала. Карточка в
  // каждом посте больше не дублируется — она едет ОДНИМ вектором `users`.
  it('ссылки на комментаторов для стека аватаров кладутся вербатим', async () => {
    const bob = { _: 'peerUser', user_id: 8 }
    const alice = { _: 'peerUser', user_id: 9 }
    const get = vi.fn(async () => ({
      _: 'messages.messageViews',
      views: [{ _: 'messageViews', replies: { _: 'messageReplies', replies: 2, recent_repliers: [bob, alice] } }],
      chats: [], users: [],
    }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const r = await newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() }).commentCounts(7, [5])
    expect(r.recent[5]).toEqual([bob, alice])
  })

  // Пин той же строки проводки, что у карточки чата: авторы приезжают попутно и
  // обязаны доехать до зеркала, иначе стек аватаров рисует их фолбэком «Удалённый
  // аккаунт» и ходит за теми же карточками вторым запросом. Удаление
  // `peers.saveApiPeers({ users: … })` из `commentCounts` красит этот кейс.
  it('карточки комментаторов уезжают владельцу пиров (saveApiPeers)', async () => {
    const bob = { _: 'user', id: 8, first_name: 'Боб' }
    const get = vi.fn(async () => ({
      _: 'messages.messageViews',
      views: [{ _: 'messageViews', replies: { _: 'messageReplies', replies: 1, recent_repliers: [{ _: 'peerUser', user_id: 8 }] } }],
      chats: [], users: [bob],
    }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const peers = fakePeers()
    await newChannelsManager({ rest, beforeSending: () => {}, peers }).commentCounts(7, [5])
    expect(peers.saveApiPeers).toHaveBeenCalledWith({ users: [bob] })
  })

  it('без recent_repliers в ответе стек пустой', async () => {
    const get = vi.fn(async () => ({
      _: 'messages.messageViews',
      views: [{ _: 'messageViews', replies: { _: 'messageReplies', replies: 1 } }],
      chats: [], users: [],
    }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const r = await newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() }).commentCounts(7, [5])
    expect(r.recent).toEqual({ 5: [] })
  })

  // Просмотры едут ТЕМ ЖЕ контейнером: у оригинала это параметр того же
  // конструктора `messageViews`, потому что и просмотры, и тред — счётчики
  // одного предмета. Пробел вектора нулём не становится.
  it('viewCounts разбирает тот же контейнер позиционно', async () => {
    const get = vi.fn(async () => ({
      _: 'messages.messageViews',
      views: [{ _: 'messageViews', views: 9200 }, { _: 'messageViews' }],
      chats: [], users: [],
    }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const r = await newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() }).viewCounts(7, [5, 6])
    expect(get).toHaveBeenCalledWith('/channels/7/view_counts', { ids: '5,6' })
    expect(r).toEqual({ 5: 9200 })
  })

  // Владение фактом: число просмотров живёт в СООБЩЕНИИ, поэтому положить его в
  // окно обязан владелец окна (`messages.cacheViews` → операция `rt:message_op`),
  // а не вызыватель ответа. Что ломается без этой строки: счётчик «9.2K 👁»
  // правит витрина мимо операций, и до зеркала главного потока (из которого
  // рисует императивная лента) он не доезжает вовсе.
  it('viewCounts отдаёт разобранные числа владельцу окна', async () => {
    const get = vi.fn(async () => ({
      _: 'messages.messageViews',
      views: [{ _: 'messageViews', views: 9200 }, { _: 'messageViews' }],
      chats: [], users: [],
    }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const cacheViews = vi.fn()
    await newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers(), cacheViews }).viewCounts(7, [5, 6])
    expect(cacheViews).toHaveBeenCalledWith(7, new Map([[5, 9200]]))
  })

  it('short-circuits empty ids without hitting REST', async () => {
    const get = vi.fn()
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const r = await mgr.commentCounts(7, [])
    expect(r).toEqual({ counts: {}, recent: {} })
    expect(get).not.toHaveBeenCalled()
  })
})

describe('ChannelsManager suggested posts', () => {
  function rawSp(id: number, status = 'pending') {
    return { id, peer_id: 7, author_id: 8, author_name: 'Bob', text: `p${id}`, status, created_at: 1000 }
  }

  it('suggestPost POSTs text/media/publish_at and maps the result', async () => {
    const post = vi.fn(async () => rawSp(3))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const p = await mgr.suggestPost(7, { text: 'hi', publishAt: 1234 })
    expect(post).toHaveBeenCalledWith('/channels/7/suggested_posts', { text: 'hi', entities: undefined, media_id: null, publish_at: 1234 })
    expect(p.id).toBe(3)
    expect(p.peerId).toBe(7)
    expect(p.authorName).toBe('Bob')
    expect(p.status).toBe('pending')
  })

  it('listSuggestedPosts GETs the queue and maps posts', async () => {
    const get = vi.fn(async () => ({ posts: [rawSp(1), rawSp(2, 'approved')] }))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const list = await mgr.listSuggestedPosts(7)
    expect(get).toHaveBeenCalledWith('/channels/7/suggested_posts')
    expect(list.map((p) => p.status)).toEqual(['pending', 'approved'])
  })

  it('listSuggestedPosts handles a missing posts array', async () => {
    const get = vi.fn(async () => ({}))
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    expect(await mgr.listSuggestedPosts(7)).toEqual([])
  })

  it('approveSuggestedPost POSTs approve with publish_at', async () => {
    const post = vi.fn(async () => rawSp(3, 'approved'))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const p = await mgr.approveSuggestedPost(3, 999)
    expect(post).toHaveBeenCalledWith('/suggested_posts/3/approve', { publish_at: 999 })
    expect(p.status).toBe('approved')
  })

  it('approveSuggestedPost defaults publish_at to 0 (publish now)', async () => {
    const post = vi.fn(async () => rawSp(3, 'approved'))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    await mgr.approveSuggestedPost(3)
    expect(post).toHaveBeenCalledWith('/suggested_posts/3/approve', { publish_at: 0 })
  })

  it('rejectSuggestedPost POSTs reject', async () => {
    const post = vi.fn(async () => rawSp(3, 'rejected'))
    const rest = { post, get: vi.fn() } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const p = await mgr.rejectSuggestedPost(3)
    expect(post).toHaveBeenCalledWith('/suggested_posts/3/reject', {})
    expect(p.status).toBe('rejected')
  })
})

describe('ChannelsManager.search', () => {
  it('short-circuits an empty query without hitting REST', async () => {
    const get = vi.fn()
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const r = await mgr.search('   ')
    expect(r).toEqual({ _: 'contacts.found', my_results: [], results: [], chats: [], users: [] })
    expect(get).not.toHaveBeenCalled()
  })

  // Ответ поиска — конструктор `contacts.found` В КОРНЕ: ссылки на пиры в
  // `results`, тела — в `chats`/`users`. Маппера нет: ответ и есть модель.
  it('GET /search отдаёт contacts.found без перекладки полей', async () => {
    const channel = { _: 'channel', id: 1, title: 'News', username: 'news', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } }
    const bob = { _: 'user', id: 2, username: 'bob', first_name: 'Bob', photo: { _: 'userProfilePhotoEmpty' } }
    const found = {
      _: 'contacts.found',
      my_results: [],
      results: [{ _: 'peerChannel', channel_id: 1 }, { _: 'peerUser', user_id: 2 }],
      chats: [channel],
      users: [bob],
    }
    const get = vi.fn(async () => found)
    const rest = { post: vi.fn(), get } as unknown as RestClient
    const mgr = newChannelsManager({ rest, beforeSending: () => {}, peers: fakePeers() })
    const r = await mgr.search('news')
    expect(get).toHaveBeenCalledWith('/search', { q: 'news' })
    expect(r).toEqual(found)
  })
})
