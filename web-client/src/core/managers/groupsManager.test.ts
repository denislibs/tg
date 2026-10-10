// src/core/managers/groupsManager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newGroupsManager } from './groupsManager'
import type { RestClient } from '../net/restClient'
import { getLinkedChatPeerId } from '../peers/peer'
import { NULL_PEER_ID } from '../peers/peerId'
import { newPeersManager } from './peersManager'
import { applyPeerOps, cachedChat, hasRightsPeer, isBroadcastPeer, isChannelPeer, isMegagroupPeer, resetPeerMirror } from '../peerCache'
import { MUTE_UNTIL_FOREVER } from '../dialogs/notifySettings'
import { generateMessageId } from '../history/messageId'
import { DEFAULT_TME_ORIGIN } from '@config/app'

type PostCall = { path: string; body: unknown }

// Task 4 (действия без оптимистики): groupsManager получает владельца диалогов
// как зависимость (см. workerCore.ts) и зовёт его применялки ПОСЛЕ успешного
// REST-ответа. Большинству тестов ниже (createGroup/addMember/card/…) владелец
// не нужен вовсе — фейк с одними vi.fn() достаточен, чтобы конструктор
// типизировался; для проверки самого факта вызова (см. блок «действия без
// оптимистики» ниже) читаем conкретный мок.
const fakeDialogs = () => ({
  applyNotifySettings: vi.fn(),
  applyPinned: vi.fn(),
  applyFolder: vi.fn(),
  applyRemoved: vi.fn(),
})

// Владелец карточек пиров: `card()` обязана отдать ему `chats`/`users` ответа —
// иначе конструктор `channel` не попадает в зеркало главного потока и предикаты
// вида чата вместе с правами отвечают «нет» на всё. Проверка самого факта —
// в describe «card кормит зеркало пиров» ниже.
const fakePeers = () => ({ saveApiPeers: vi.fn() })

/** Ссылка-приглашение конструктором `chatInviteExported`: адрес один (`link`),
 *  признаки в `pFlags`, сроки в секундах эпохи. */
function invite(over: Record<string, unknown> = {}) {
  return { _: 'chatInviteExported', link: '/join/abc', admin_id: 1, date: 100, ...over }
}

/** Ответ `GET /chats/{peerID}/card` — конструктор `messages.chatFull` В КОРНЕ,
 *  без обёртки: ключ пира выводим из краткой карточки, а `creator_id` был
 *  мёртвым полем, которое никто не читал. */
function cardResponse() {
  return {
    _: 'messages.chatFull' as const,
    full_chat: {
      _: 'channelFull' as const,
      id: 5, about: 'a',
      read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0,
      chat_photo: null,
      linked_chat_id: 0,
    },
    chats: [{
      _: 'channel' as const,
      id: 5, title: 'T', username: 'u',
      photo: { _: 'chatPhotoEmpty' as const },
      date: 0,
      pFlags: { megagroup: true as const },
      participants_count: 12,
    }],
    users: [],
  }
}

function fakeRest(opts: { postReturn?: unknown; getReturn?: unknown; patchReturn?: unknown }) {
  const posts: PostCall[] = []
  const gets: string[] = []
  const dels: string[] = []
  const patches: PostCall[] = []
  const rest = {
    async post<R>(path: string, body: unknown): Promise<R> {
      posts.push({ path, body })
      return (opts.postReturn ?? {}) as R
    },
    async get<R>(path: string): Promise<R> {
      gets.push(path)
      return (opts.getReturn ?? {}) as R
    },
    async patch<R>(path: string, body: unknown): Promise<R> {
      patches.push({ path, body })
      return (opts.patchReturn ?? {}) as R
    },
    async del<R>(path: string): Promise<R> {
      dels.push(path)
      return {} as R
    },
  } as unknown as RestClient
  return { rest, posts, gets, dels, patches }
}

describe('GroupsManager', () => {
  // Порт `appChatsManager.createChat(title, userIds)` (tweb 812502980
  // `appChatsManager.ts:627-637`): ответ — `messages.invitedUsers`, созданный
  // чат берётся из `updates.chats[0]`, пиры пачки уезжают в зеркало, а наружу
  // идут `{chatId, missingInvitees}` — ровно пара оригинала.
  it('createChat POSTs /groups {title, member_ids} and returns {chatId, missingInvitees}', async () => {
    const peers = fakePeers()
    const card = cardResponse()
    const missing = [{ _: 'missingInvitee' as const, pFlags: {}, user_id: 9 }]
    const reply = {
      _: 'messages.invitedUsers' as const,
      updates: { _: 'updates' as const, updates: [], users: [], chats: card.chats, date: 1, seq: 0 },
      missing_invitees: missing,
    }
    const { rest, posts } = fakeRest({ postReturn: reply })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers })
    const result = await mgr.createChat('My Group', [8, 9])
    expect(result).toEqual({ chatId: 5, missingInvitees: missing })
    expect(peers.saveApiPeers).toHaveBeenCalledWith(reply.updates)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/groups')
    expect(posts[0].body).toEqual({ title: 'My Group', member_ids: [8, 9] })
  })

  it('setMute POSTs /chats/{id}/mute with muted flag', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    await mgr.setMute(9, true)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/9/mute')
    expect(posts[0].body).toEqual({ muted: true, until: null })
  })

  it('setMute передаёт until для временного mute и применяет ТОТ ЖЕ срок локально', async () => {
    const { rest, posts } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await mgr.setMute(9, true, 1700000000)
    expect(posts[0].body).toEqual({ muted: true, until: 1700000000 })
    // Локальное применение несёт КОНСТРУКТОР со сроком — тот же, что построит
    // бэкенд. Прежняя пара «булево + until» срок теряла на границе.
    expect(dialogs.applyNotifySettings).toHaveBeenCalledWith(9, { _: 'peerNotifySettings', mute_until: 1700000000 })
  })

  it('«навсегда» — далёкий срок, «снять» — отсутствие переопределения', async () => {
    const { rest } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await mgr.setMute(9, true)
    expect(dialogs.applyNotifySettings).toHaveBeenCalledWith(9, { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER })
    await mgr.setMute(9, false)
    expect(dialogs.applyNotifySettings).toHaveBeenLastCalledWith(9, { _: 'peerNotifySettings' })
  })

  it('addMember POSTs /chats/{id}/members with user_id', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    await mgr.addMember(3, 11)
    expect(posts[0].path).toBe('/chats/3/members')
    expect(posts[0].body).toEqual({ user_id: 11 })
  })

  it('card раскладывает messages.chatFull на пару конструкторов + свои поля', async () => {
    const { rest, gets } = fakeRest({ getReturn: cardResponse() })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    const card = await mgr.card(-5)
    expect(gets[0]).toBe('/chats/-5/card')
    expect(card).toEqual({
      peerId: -5,
      chat: cardResponse().chats[0],
      fullChat: cardResponse().full_chat,
      // Ни `muted`, ни `creator_id` в карточке БОЛЬШЕ НЕТ: заглушённость это
      // `channelFull.notify_settings` (параметр самой схемы, мьют выражен
      // СРОКОМ), а создатель — `pFlags.creator` краткой карточки. Читателей у
      // обоих полей не было ни одного.
    })
  })

  // `linked_chat_id` в схеме — СЫРОЙ положительный id чата, а не знаковый ключ:
  // прочитать его как ключ значило бы открывать обсуждение по чужому номеру.
  it('обсуждение: сырой linked_chat_id становится ОТРИЦАТЕЛЬНЫМ ключом; нет поля — NULL_PEER_ID', async () => {
    const withLink = cardResponse()
    withLink.full_chat.linked_chat_id = 88
    const a = newGroupsManager({ rest: fakeRest({ getReturn: withLink }).rest, dialogs: fakeDialogs(), peers: fakePeers() })
    expect(getLinkedChatPeerId((await a.card(-5))!.fullChat)).toBe(-88)

    const b = newGroupsManager({ rest: fakeRest({ getReturn: cardResponse() }).rest, dialogs: fakeDialogs(), peers: fakePeers() })
    expect(getLinkedChatPeerId((await b.card(-5))!.fullChat)).toBe(NULL_PEER_ID)
  })

  // Порт пары `editChatDefaultBannedRights` + `toggleSlowMode` одним вызовом
  // (задача 0б-6 волны 7): ЗАПРЕТЫ вкладки прав уходят нашим битмаском «что
  // можно» — инверсия только в `allowedFromBannedRights`.
  it('editChatDefaultBannedRights PUTs /chats/{id}/permissions: запреты → битмаск «что можно» + slowmode', async () => {
    const puts: PostCall[] = []
    const rest = { async put(path: string, body: unknown) { puts.push({ path, body }); return {} } } as unknown as RestClient
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    await mgr.editChatDefaultBannedRights(-5, { _: 'chatBannedRights', until_date: 0x7FFFFFFF, pFlags: { send_media: true, pin_messages: true } }, 60)
    expect(puts).toEqual([{ path: '/chats/-5/permissions', body: { permissions: 1 | 4 | 16, slowmode_seconds: 60 } }])
  })

  it('createInvite POSTs /chats/{id}/invite_links and maps requires_approval', async () => {
    const { rest, posts } = fakeRest({
      postReturn: { _: 'messages.exportedChatInvite', invite: invite({ pFlags: { request_needed: true } }) },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    const r = await mgr.createInvite(5, { usageLimit: 10, requiresApproval: true, expireSeconds: 3600 })
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/invite_links')
    expect(posts[0].body).toEqual({ usage_limit: 10, requires_approval: true, expire_seconds: 3600 })
    // Токен — ХВОСТ адреса, а не отдельное поле провода.
    expect(r).toEqual({ token: 'abc', url: '/join/abc', uses: 0, requiresApproval: true, title: '', usageLimit: null, revoked: false })
  })

  it('createInvite defaults usage_limit=null, requires_approval=false, expire_seconds=0', async () => {
    const { rest, posts } = fakeRest({ postReturn: { _: 'messages.exportedChatInvite', invite: invite() } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    await mgr.createInvite(5)
    expect(posts[0].body).toEqual({ usage_limit: null, requires_approval: false, expire_seconds: 0 })
  })

  // Срок в конструкторе — СЕКУНДЫ ЭПОХИ (`expire_date`), а не ISO-строка.
  it('createInvite maps expire_date from the response', async () => {
    const { rest } = fakeRest({
      postReturn: { _: 'messages.exportedChatInvite', invite: invite({ expire_date: 1785542400 }) },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    const r = await mgr.createInvite(5, { expireSeconds: 3600 })
    expect(r.expiresAt).toBe(new Date(1785542400 * 1000).toISOString())
  })

  it('listInvites GETs /chats/{id}/invite_links and maps requires_approval', async () => {
    const { rest, gets } = fakeRest({
      getReturn: {
        _: 'messages.exportedChatInvites', count: 1,
        invites: [invite({ link: '/join/t', usage: 3, pFlags: { request_needed: true } })],
      },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    const links = await mgr.listInvites(5)
    expect(gets[0]).toBe('/chats/5/invite_links')
    expect(links).toEqual([{ token: 't', uses: 3, url: '/join/t', requiresApproval: true, title: '', usageLimit: null, revoked: false }])
  })

  it('listInvites appends ?revoked=true when requesting revoked links', async () => {
    const { rest, gets } = fakeRest({
      getReturn: {
        _: 'messages.exportedChatInvites', count: 1,
        invites: [invite({ pFlags: { revoked: true } })],
      },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    const links = await mgr.listInvites(5, true)
    expect(gets[0]).toBe('/chats/5/invite_links?revoked=true')
    expect(links[0].revoked).toBe(true)
  })

  // ── Форма оригинала (`appChatInvitesManager`, вкладки ссылок 0б-3) ──────────
  // Ключ — `chatId` (ключ пира собирается внутри), ссылка — ПОЛНЫЙ публичный
  // адрес `t.me/+<хеш>` на нашем хосте (`core/publicLink.ts`), а не путь диплинка.
  it('getExportedChatInvites: ключ пира из chatId, link — публичный адрес /+<хеш>, карточки создателей — в зеркало', async () => {
    const users = [{ _: 'user', id: 1, first_name: 'A' }]
    const { rest, gets } = fakeRest({
      getReturn: { _: 'messages.exportedChatInvites', count: 1, invites: [invite({ link: '/join/t1', usage: 2 })], users },
    })
    const peers = fakePeers()
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers })
    const r = await mgr.getExportedChatInvites({ chatId: 5, revoked: true })
    expect(gets[0]).toBe('/chats/-5/invite_links?revoked=true')
    expect(r).toEqual({ _: 'messages.exportedChatInvites', count: 1, invites: [invite({ link: `${DEFAULT_TME_ORIGIN}/+t1`, usage: 2 })] })
    expect(peers.saveApiPeers).toHaveBeenCalledWith({ users })
  })

  it('exportChatInvite: абсолютный срок → expire_seconds от «сейчас», usageLimit 0 → без лимита', async () => {
    vi.useFakeTimers({ now: 1_000_000 * 1000 })
    try {
      const { rest, posts } = fakeRest({ postReturn: { _: 'messages.exportedChatInvite', invite: invite({ link: '/join/n' }) } })
      const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
      const r = await mgr.exportChatInvite({ chatId: 5, title: 'Team', requestNeeded: true, usageLimit: 0, expireDate: 1_000_000 + 3600 })
      expect(posts[0].path).toBe('/chats/-5/invite_links')
      expect(posts[0].body).toEqual({ title: 'Team', usage_limit: null, requires_approval: true, expire_seconds: 3600 })
      expect(r.link).toBe(`${DEFAULT_TME_ORIGIN}/+n`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('editExportedChatInvite: отзыв — одним признаком; правка — все поля формы по хешу ссылки', async () => {
    const { rest, patches } = fakeRest({ patchReturn: { _: 'messages.exportedChatInvite', invite: invite({ link: '/join/h', pFlags: { revoked: true } }) } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    const r = await mgr.editExportedChatInvite({ chatId: 5, link: `${DEFAULT_TME_ORIGIN}/+h`, revoked: true })
    expect(patches[0]).toEqual({ path: '/chats/-5/invite_links/h', body: { revoked: true } })
    expect(r.invite.link).toBe(`${DEFAULT_TME_ORIGIN}/+h`)

    await mgr.editExportedChatInvite({ chatId: 5, link: `${DEFAULT_TME_ORIGIN}/+h`, title: '', requestNeeded: false, usageLimit: 10, expireDate: 0 })
    expect(patches[1].body).toEqual({ title: '', requires_approval: false, usage_limit: 10, expire_seconds: 0 })
  })

  it('deleteExportedChatInvite / deleteRevokedExportedChatInvites — DELETE по хешу и всех отозванных', async () => {
    const { rest, dels } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    await mgr.deleteExportedChatInvite(5, `${DEFAULT_TME_ORIGIN}/+tok`)
    await mgr.deleteRevokedExportedChatInvites(5)
    expect(dels).toEqual(['/chats/-5/invite_links/tok', '/chats/-5/revoked_invite_links'])
  })

  // Импортёр — конструктор `chatInviteImporter`; карточки вектора `users` — в зеркало.
  it('getChatInviteImporters: контейнер как есть, карточки users — владельцу пиров', async () => {
    const users = [{ _: 'user', id: 11, first_name: 'B' }]
    const { rest, gets } = fakeRest({
      getReturn: {
        _: 'messages.chatInviteImporters', count: 1,
        importers: [{ _: 'chatInviteImporter', user_id: 11, date: 1785542400 }],
        users,
      },
    })
    const peers = fakePeers()
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers })
    const r = await mgr.getChatInviteImporters({ chatId: 5, link: `${DEFAULT_TME_ORIGIN}/+t` })
    expect(gets[0]).toBe('/chats/-5/invite_links/t/importers')
    expect(r.importers).toEqual([{ _: 'chatInviteImporter', user_id: 11, date: 1785542400 }])
    expect(peers.saveApiPeers).toHaveBeenCalledWith({ users })
  })

  it('importChatInvite: POST /join/{hash}, чат из updates.chats[0] — в зеркало и наружу ключом', async () => {
    // tweb `appChatInvitesManager.importChatInvite` (:92-104).
    const chat = { _: 'channel', id: 77, title: 'G', pFlags: { megagroup: true } }
    const { rest, posts } = fakeRest({ postReturn: { _: 'updates', updates: [], users: [], chats: [chat], date: 1, seq: 0 } })
    const peers = fakePeers()
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers })
    const peerId = await mgr.importChatInvite('tok123')
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/join/tok123')
    expect(posts[0].body).toEqual({})
    expect(peerId).toBe(-77)
    expect(peers.saveApiPeers).toHaveBeenCalledWith(expect.objectContaining({ chats: [chat] }))
  })

  // Тема адресуется НОМЕРОМ (номер служебки создания, у General — 1):
  // клиентский номер на границе ручки приводится к серверному
  // (tweb `topic_id: getServerMessageId(topicId)`, appMessagesManager.ts:10067, :10218).
  it('editForumTopic: PATCH /chats/{id}/topics/{n} только изменёнными полями', async () => {
    const { rest, patches } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    await mgr.editForumTopic(5, generateMessageId(10), { closed: true })
    await mgr.editForumTopic(5, generateMessageId(1), { title: 'T', iconEmoji: '🐞' })
    expect(patches).toEqual([
      { path: '/chats/5/topics/10', body: { closed: true } },
      { path: '/chats/5/topics/1', body: { title: 'T', icon_emoji: '🐞' } },
    ])
  })

  it('updatePinnedForumTopic: POST /chats/{id}/topics/{n}/pin', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    await mgr.updatePinnedForumTopic(5, generateMessageId(10), true)
    expect(posts).toEqual([{ path: '/chats/5/topics/10/pin', body: { pinned: true } }])
  })

  // Мьют темы — СРОК (tweb `mutePeer({threadId, muteUntil})`), применяется
  // хранилищем тем ПОСЛЕ ответа сети; 0 — снять.
  it('updateTopicNotifySettings: срок на сервер, после ответа — хранилищу тем', async () => {
    const { rest, posts } = fakeRest({})
    const applyNotifySettings = vi.fn()
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers(), forumTopics: { applyNotifySettings } })
    await mgr.updateTopicNotifySettings(5, generateMessageId(10), 1800000000)
    await mgr.updateTopicNotifySettings(5, generateMessageId(10), 0)
    expect(posts.map((p) => [p.path, p.body])).toEqual([
      ['/chats/5/topics/10/mute', { mute_until: 1800000000 }],
      ['/chats/5/topics/10/mute', { mute_until: 0 }],
    ])
    expect(applyNotifySettings.mock.calls).toEqual([
      [5, generateMessageId(10), { _: 'peerNotifySettings', mute_until: 1800000000 }],
      [5, generateMessageId(10), { _: 'peerNotifySettings' }],
    ])
  })

  it('updateTopicNotifySettings: ошибка сети — хранилище тем не трогается', async () => {
    const rest = { post: vi.fn(async () => { throw new Error('net') }) } as unknown as RestClient
    const applyNotifySettings = vi.fn()
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers(), forumTopics: { applyNotifySettings } })
    await expect(mgr.updateTopicNotifySettings(5, generateMessageId(10), 1)).rejects.toThrow('net')
    expect(applyNotifySettings).not.toHaveBeenCalled()
  })

  // tweb createForumTopic (:10093-10102): номер темы — из `updateNewChannelMessage` ответа
  it('createTopic: номер темы из Updates ответа, клиентский', async () => {
    const { rest, posts } = fakeRest({
      postReturn: { _: 'updates', updates: [{ _: 'updateNewChannelMessage', message: { id: 77 } }] },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs(), peers: fakePeers() })
    expect(await mgr.createTopic(5, 'T', 1, '🐞')).toBe(generateMessageId(77))
    expect(posts[0]).toEqual({ path: '/chats/5/topics', body: { title: 'T', icon_color: 1, icon_emoji: '🐞' } })
  })
})

// Task 4 (действия без оптимистики): setMute/setPin/setArchive/deleteGroup зовут
// применялку владельца ПОСЛЕ успешного REST-ответа, а на ошибке — не зовут вовсе
// (порт tweb invokeApi(...).then(saveUpdate)). setMute — детальный fail/success
// RED/GREEN разбор с РЕАЛЬНЫМ dialogsManager живёт в dialogsManager.test.ts (там
// же и мутация «применялка перед await»); здесь — по одному компактному
// unit-тесту на каждую строку проводки (лёгкий фейк, без owner целиком).
describe('GroupsManager: действия без оптимистики (Task 4)', () => {
  it('setPin: успех — dialogs.applyPinned зовётся с итоговым pinned', async () => {
    const { rest } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await mgr.setPin(9, true)
    expect(dialogs.applyPinned).toHaveBeenCalledWith(9, true)
  })

  it('setPin: RPC упал (лимит) — dialogs.applyPinned не зовётся', async () => {
    const rest = { post: vi.fn(async () => { throw new Error('pin limit') }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await expect(mgr.setPin(9, true)).rejects.toThrow('pin limit')
    expect(dialogs.applyPinned).not.toHaveBeenCalled()
  })

  it('setArchive: успех — dialogs.applyFolder зовётся с НОМЕРОМ ПАПКИ', async () => {
    const { rest } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await mgr.setArchive(9, true)
    // Номер ПАПКИ, а не признак: архив это папка №1 (WIRE_FOLDER_ARCHIVE).
    expect(dialogs.applyFolder).toHaveBeenCalledWith(9, 1)
  })

  it('setArchive: RPC упал — dialogs.applyFolder не зовётся', async () => {
    const rest = { post: vi.fn(async () => { throw new Error('offline') }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await expect(mgr.setArchive(9, true)).rejects.toThrow('offline')
    expect(dialogs.applyFolder).not.toHaveBeenCalled()
  })

  it('deleteGroup: DELETEs /chats/{id}, затем зовёт dialogs.applyRemoved', async () => {
    const { rest, dels } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await mgr.deleteGroup(9)
    expect(dels).toEqual(['/chats/9'])
    expect(dialogs.applyRemoved).toHaveBeenCalledWith(9)
  })

  it('deleteGroup: RPC упал — dialogs.applyRemoved не зовётся', async () => {
    const rest = { del: vi.fn(async () => { throw new Error('offline') }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs, peers: fakePeers() })
    await expect(mgr.deleteGroup(9)).rejects.toThrow('offline')
    expect(dialogs.applyRemoved).not.toHaveBeenCalled()
  })
})

// ── Пин пробела D2.5 №1: карточка чата обязана доехать до зеркала пиров ──────
//
// До этого шага `saveApiPeers` не звал НИКТО (грепом по src он встречался
// только в собственном тесте), поэтому конструкторы `Chat` в зеркало главного
// потока не попадали вовсе, и ВСЕ предикаты по ключу (`isChannelPeer`,
// `isMegagroupPeer`, …) вместе с правами (`hasRightsPeer`) отвечали `false`
// на любой чат. Ни один тест этого не показывал.
//
// Здесь связка собрана целиком и по-настоящему: НАСТОЯЩИЙ владелец
// (`newPeersManager`) + настоящее зеркало (`applyPeerOps` — ровно то, что
// делает проектор по `rt:peer_op`). Удаление строки
// `peers.saveApiPeers(r)` из `groupsManager.card` красит этот describe.
describe('card кормит зеркало пиров (иначе предикаты по ключу мертвы)', () => {
  beforeEach(() => { resetPeerMirror() })

  /** Владелец + зеркало, соединённые тем же путём, что в проде. */
  function wiredPeers() {
    return newPeersManager({
      rest: { get: vi.fn() } as never,
      onPeerOps: (ops) => applyPeerOps(ops),
    })
  }

  it('после card() предикаты по ключу отвечают ПРАВДУ, а не «всегда false»', async () => {
    const peers = wiredPeers()
    const mgr = newGroupsManager({ rest: fakeRest({ getReturn: cardResponse() }).rest, dialogs: fakeDialogs(), peers })

    // до похода за карточкой зеркало пусто — предикаты честно молчат
    expect(cachedChat(-5)).toBeUndefined()
    expect(isChannelPeer(-5)).toBe(false)

    await mgr.card(-5)

    expect(cachedChat(-5)).toEqual(cardResponse().chats[0])
    expect(isChannelPeer(-5)).toBe(true)    // `channel` — да
    expect(isMegagroupPeer(-5)).toBe(true)  // pFlags.megagroup — да
    expect(isBroadcastPeer(-5)).toBe(false) // …и потому НЕ вещательный: «всегда true» тоже неверно
  })

  it('права зрителя приезжают той же карточкой: creator может всё, обычный участник — по запретам', async () => {
    const creatorCard = cardResponse()
    creatorCard.chats[0].pFlags = { megagroup: true, creator: true } as never
    const a = newGroupsManager({ rest: fakeRest({ getReturn: creatorCard }).rest, dialogs: fakeDialogs(), peers: wiredPeers() })
    await a.card(-5)
    expect(hasRightsPeer(-5, 'add_admins')).toBe(true)

    resetPeerMirror()

    // ⚠ ПОЛЯРНОСТЬ: выставленный флаг `default_banned_rights` — это ЗАПРЕТ.
    // Прочитать его как разрешение значит перевернуть права всей группы.
    const bannedCard = cardResponse()
    ;(bannedCard.chats[0] as Record<string, unknown>).default_banned_rights =
      { _: 'chatBannedRights', pFlags: { send_messages: true }, until_date: 0 }
    const b = newGroupsManager({ rest: fakeRest({ getReturn: bannedCard }).rest, dialogs: fakeDialogs(), peers: wiredPeers() })
    await b.card(-5)
    expect(hasRightsPeer(-5, 'send_messages')).toBe(false) // запрещено
    expect(hasRightsPeer(-5, 'send_media')).toBe(true)     // не запрещено
    expect(hasRightsPeer(-5, 'add_admins')).toBe(false)    // не админ
  })
})
