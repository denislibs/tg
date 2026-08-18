// src/core/models.test.ts
import { describe, it, expect } from 'vitest'
import { deriveOut, fromNewMessageEvt, mapChecklist, mapDialog, mapDraft, mapMessage, type RawChecklist, type RawDialog, type RawMessage } from './models'
import type { NewMessageEvt } from './realtime/events'

describe('mapDialog', () => {
  it('maps a private dialog with peer + last_message', () => {
    const raw: RawDialog = {
      chat_id: 1, type: 'private', last_read_seq: 4, peer_read_seq: 3, unread: 2, muted: false,
      peer: { id: 2, display_name: 'Bob', avatar_url: '' },
      last_message: { seq: 4, text: 'hi', sender_id: 2, at: '2026-06-24T10:00:00Z' },
    }
    const d = mapDialog(raw)
    expect(d).toEqual({
      chatId: 1, type: 'private', lastReadSeq: 4, peerReadSeq: 3, unread: 2, muted: false, pinned: false, archived: false,
      notifyPreview: true, notifySound: 'default',
      autoDeletePeriod: 0, title: undefined, username: undefined, photoUrl: undefined,
      peer: { id: 2, displayName: 'Bob', avatarUrl: '', verified: undefined, premium: undefined, emojiStatus: undefined },
      lastMessage: {
        seq: 4, text: 'hi', senderId: 2, at: '2026-06-24T10:00:00Z',
        mediaId: undefined, mediaType: undefined, forwarded: undefined, senderName: undefined,
      },
    })
  })

  it('handles missing peer / last_message / muted', () => {
    const d = mapDialog({ chat_id: 7, type: 'group', last_read_seq: 0, unread: 0 })
    expect(d.peer).toBeUndefined()
    expect(d.lastMessage).toBeUndefined()
    expect(d.muted).toBe(false)
  })

  it('maps unread_reactions → unreadReactions (undefined when 0/absent)', () => {
    expect(mapDialog({ chat_id: 1, type: 'private', last_read_seq: 0, unread: 0, unread_reactions: 3 }).unreadReactions).toBe(3)
    expect(mapDialog({ chat_id: 1, type: 'private', last_read_seq: 0, unread: 0, unread_reactions: 0 }).unreadReactions).toBeUndefined()
    expect(mapDialog({ chat_id: 1, type: 'private', last_read_seq: 0, unread: 0 }).unreadReactions).toBeUndefined()
  })
})

describe('mapMessage', () => {
  it('maps a raw message and computes seq/ids', () => {
    const raw: RawMessage = {
      id: 10, chat_id: 1, seq: 5, sender_id: 1, type: 'text', text: 'hello',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
    }
    expect(mapMessage(raw)).toEqual({
      id: 10, chatId: 1, seq: 5, senderId: 1, type: 'text', text: 'hello',
      replyToId: null, mediaId: null, createdAt: '2026-06-24T10:01:00Z', threadRootId: null,
      groupedId: null, editedAt: null, deleted: false,
      fwdFromUserId: null, fwdFromChatId: null, fwdFromMsgId: null, fwdDate: null,
      replyTo: null,
    })
  })

  it('maps thread_root_id to threadRootId', () => {
    const raw: RawMessage = {
      id: 11, chat_id: 99, seq: 1, sender_id: 1, type: 'text', text: 'c',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z', thread_root_id: 5,
    }
    expect(mapMessage(raw).threadRootId).toBe(5)
  })

  it('defaults threadRootId to null when thread_root_id absent', () => {
    const raw: RawMessage = {
      id: 12, chat_id: 1, seq: 2, sender_id: 1, type: 'text', text: 'x',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
    }
    expect(mapMessage(raw).threadRootId).toBeNull()
  })

  it('maps a valid effect and drops unknown/empty effects', () => {
    const mk = (effect: string | null | undefined): RawMessage => ({
      id: 20, chat_id: 1, seq: 6, sender_id: 1, type: 'text', text: 'party',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z', effect,
    })
    expect(mapMessage(mk('confetti')).effect).toBe('confetti')
    expect(mapMessage(mk('fireworks')).effect).toBe('fireworks')
    // вне whitelist / пусто → undefined
    expect(mapMessage(mk('boom')).effect).toBeUndefined()
    expect(mapMessage(mk('')).effect).toBeUndefined()
    expect(mapMessage(mk(null)).effect).toBeUndefined()
    expect(mapMessage(mk(undefined)).effect).toBeUndefined()
  })

  it('maps web_page (server link preview) to webPage', () => {
    const raw: RawMessage = {
      id: 13, chat_id: 1, seq: 3, sender_id: 1, type: 'text', text: 'https://example.com',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
      web_page: {
        url: 'https://example.com', site_name: 'Example', title: 'Заголовок', description: 'Описание',
        photo_id: 42, photo_w: 1280, photo_h: 720, photo_blur: 'Ymx1cg==', photo_has_thumb: true, has_iv: true,
      },
    }
    expect(mapMessage(raw).webPage).toEqual({
      url: 'https://example.com', siteName: 'Example', title: 'Заголовок', description: 'Описание',
      photoId: 42, photoW: 1280, photoH: 720, photoBlur: 'Ymx1cg==', photoHasThumb: true, hasIV: true,
    })
  })

  it('drops empty web_page fields and defaults webPage to undefined', () => {
    const base = {
      id: 14, chat_id: 1, seq: 4, sender_id: 1, type: 'text', text: 'x',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
    }
    expect(mapMessage({ ...base }).webPage).toBeUndefined()
    expect(mapMessage({ ...base, web_page: null }).webPage).toBeUndefined()
    const wp = mapMessage({ ...base, web_page: { title: 't' } }).webPage
    expect(wp).toEqual({
      url: undefined, siteName: '', title: 't', description: undefined,
      photoId: undefined, photoW: undefined, photoH: undefined,
      photoBlur: undefined, photoHasThumb: undefined, hasIV: undefined,
    })
  })

  it('maps factcheck (fact check block) to factCheck', () => {
    const raw: RawMessage = {
      id: 15, chat_id: 1, seq: 5, sender_id: 1, type: 'text', text: 'post',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
      factcheck: { text: 'clarification', entities: [{ type: 'bold', offset: 0, length: 4 }], country: 'DE' },
    }
    expect(mapMessage(raw).factCheck).toEqual({
      text: 'clarification', entities: [{ type: 'bold', offset: 0, length: 4 }], country: 'DE',
    })
    const base = { ...raw, factcheck: null }
    expect(mapMessage(base).factCheck).toBeUndefined()
  })

  // Медиа-мета сообщения — то, из чего бабл строится ЦЕЛИКОМ, без отдельного
  // запроса меты медиа: точный бокс (media_w/media_h → setAttachmentSize),
  // мгновенное превью до сети (media_blur — наш аналог tweb photoStrippedSize),
  // постер/thumb, mime, длительность, размер, имя, теги трека и признак гифки.
  // Проверяем весь блок разом: пропуск одного ключа в маппере — это молча
  // потерянное поле у КАЖДОГО медиа-бабла.
  it('маппит медиа-мету сообщения (media_* → media*)', () => {
    const raw: RawMessage = {
      id: 30, chat_id: 1, seq: 7, sender_id: 1, type: 'video', text: '',
      reply_to_id: null, media_id: 42, created_at: '2026-06-24T10:01:00Z',
      media_w: 1600, media_h: 900, media_mime: 'video/mp4', media_blur: 'AAECAw==',
      media_has_thumb: true, media_duration: 61, media_size: 9000000, media_name: 'clip.mp4',
      media_title: 'Track One', media_performer: 'denis1488', media_animated: true,
      media_waveform: 'HwAq/wc=',
    }
    const m = mapMessage(raw)
    expect({
      mediaId: m.mediaId,
      mediaWidth: m.mediaWidth, mediaHeight: m.mediaHeight, mediaMime: m.mediaMime,
      mediaBlur: m.mediaBlur, mediaHasThumb: m.mediaHasThumb, mediaDuration: m.mediaDuration,
      mediaSize: m.mediaSize, mediaName: m.mediaName, mediaWaveform: m.mediaWaveform,
      mediaTitle: m.mediaTitle, mediaPerformer: m.mediaPerformer, mediaAnimated: m.mediaAnimated,
    }).toEqual({
      mediaId: 42,
      mediaWidth: 1600, mediaHeight: 900, mediaMime: 'video/mp4',
      mediaBlur: 'AAECAw==', mediaHasThumb: true, mediaDuration: 61,
      mediaSize: 9000000, mediaName: 'clip.mp4', mediaWaveform: 'HwAq/wc=',
      mediaTitle: 'Track One', mediaPerformer: 'denis1488', mediaAnimated: true,
    })

    // Медиа без обработки/без признака: ключей нет — поля undefined, а не false.
    const bare = mapMessage({ ...raw, media_animated: undefined, media_has_thumb: undefined })
    expect(bare.mediaAnimated).toBeUndefined()
    expect(bare.mediaHasThumb).toBeUndefined()
  })

  // Скрытое медиа (tweb messageMedia.pFlags.spoiler). Признак ОДНОСТОРОННИЙ:
  // сервер кладёт ключ только когда true, поэтому «нет ключа» обязано давать
  // undefined, а не false — иначе спойлер нельзя отличить от «сервер не сказал».
  it('маппит признак скрытого медиа (media_spoiler → mediaSpoiler)', () => {
    const raw: RawMessage = {
      id: 31, chat_id: 1, seq: 8, sender_id: 1, type: 'photo', text: '',
      reply_to_id: null, media_id: 43, created_at: '2026-06-24T10:02:00Z',
      media_blur: 'AAECAw==', media_spoiler: true,
    }
    expect(mapMessage(raw).mediaSpoiler).toBe(true)
    expect(mapMessage({ ...raw, media_spoiler: undefined }).mediaSpoiler).toBeUndefined()
  })

  it('маппит send_as (отображаемый автор канала/группы)', () => {
    const raw: RawMessage = {
      id: 31, chat_id: 1, seq: 8, sender_id: 7, type: 'text', text: 'post',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
      send_as: { chat_id: 9, title: 'Канал', photo_id: 5 },
    }
    expect(mapMessage(raw).sendAs).toEqual({ chatId: 9, title: 'Канал', photoId: 5 })
    expect(mapMessage({ ...raw, send_as: null }).sendAs).toBeUndefined()
  })
})

describe('mapDraft', () => {
  it('maps entities and reply_to_id (draft_update frame / GET /drafts)', () => {
    const d = mapDraft({
      chat_id: 3, text: '**жирный**',
      entities: [{ type: 'bold', offset: 0, length: 6 }],
      reply_to_id: 42, updated_at: '2026-07-21T10:00:00Z',
    })
    expect(d).toEqual({
      chatId: 3, text: '**жирный**',
      entities: [{ type: 'bold', offset: 0, length: 6 }],
      replyToId: 42, updatedAt: '2026-07-21T10:00:00Z',
    })
  })

  it('defaults absent/null entities and reply_to_id', () => {
    const d = mapDraft({ chat_id: 3, text: 'x', entities: null, reply_to_id: null, updated_at: 't' })
    expect(d.entities).toBeUndefined()
    expect(d.replyToId).toBeNull()
    const d2 = mapDraft({ chat_id: 3, text: 'x', updated_at: 't' })
    expect(d2.entities).toBeUndefined()
    expect(d2.replyToId).toBeNull()
  })

  it('drops an empty entities array', () => {
    expect(mapDraft({ chat_id: 1, text: 'x', entities: [], updated_at: 't' }).entities).toBeUndefined()
  })
})

describe('mapChecklist', () => {
  it('maps items with marks and permission flags (snake_case → camelCase)', () => {
    const raw: RawChecklist = {
      id: 7, title: 'todo',
      items: [
        { id: 1, text: 'a', marked_by: [10, 11] },
        { id: 2, text: 'b', marked_by: [] },
      ],
      others_can_add: true, others_can_mark: false,
    }
    expect(mapChecklist(raw)).toEqual({
      id: 7, title: 'todo',
      items: [
        { id: 1, text: 'a', markedBy: [10, 11] },
        { id: 2, text: 'b', markedBy: [] },
      ],
      othersCanAdd: true, othersCanMark: false,
    })
  })

  it('defaults absent items/marks to empty arrays', () => {
    const c = mapChecklist({ id: 1, title: 't' } as unknown as RawChecklist)
    expect(c.items).toEqual([])
    expect(c.othersCanAdd).toBe(false)
    expect(c.othersCanMark).toBe(false)
  })
})

// Порт tweb `message.pFlags.out`. Бэкенд поля не отдаёт (ни REST-витрина
// messageJSON, ни WS-кадр messageUpdatePayload), поэтому предикат — ЕДИНСТВЕННОЕ
// место вывода этого факта: его зовут границы маппинга владельца (messagesManager,
// pending, pollMethods, boostsManager). Прежде тот же вывод жил в витрине
// (messageToConvMsg) — правило перенесено сюда дословно, включая send-as.
describe('deriveOut — исходящее/входящее', () => {
  it('моё сообщение — исходящее', () => {
    expect(deriveOut({ senderId: 7 }, 7)).toBe(true)
  })

  it('чужое сообщение — входящее', () => {
    expect(deriveOut({ senderId: 2 }, 7)).toBe(false)
  })

  it('личность ещё не известна (meId === null) — входящее', () => {
    expect(deriveOut({ senderId: 7 }, null)).toBe(false)
  })

  it('send-as: пост от имени канала/группы рисуется ВХОДЯЩИМ, хотя отправитель — я', () => {
    expect(deriveOut({ senderId: 7, sendAs: { chatId: 9, title: 'Канал' } }, 7)).toBe(false)
  })
})

// Живой кадр new_message → Message. Единственная точка этого перехода
// (зовётся из messagesManager.cacheLive), поэтому непереложенное здесь поле
// отсутствует у сообщения до перезагрузки истории — и только у неё.
describe('fromNewMessageEvt — проводной кадр в модель', () => {
  const base: NewMessageEvt = {
    chat_id: 1, msg_id: 10, seq: 5, sender_id: 7, type: 'text', text: 'hi',
    media_id: null, created_at: '2026-06-24T10:01:00Z',
  }

  // Бэк кладёт send_as в кадр (usecase/chat/frame.go: messageUpdatePayload), но
  // маппер его не переносил: у живого сообщения не было ни имени автора
  // (бабл рисуется от имени канала/группы), ни правила `out` — send-as рисуется
  // ВХОДЯЩИМ даже когда отправитель я. Расхождение держалось до перезагрузки.
  it('переносит send_as живого кадра', () => {
    const m = fromNewMessageEvt({ ...base, send_as: { chat_id: 9, title: 'Канал', photo_id: 5 } })
    expect(m.sendAs).toEqual({ chatId: 9, title: 'Канал', photoId: 5 })
  })

  it('без send_as в кадре — sendAs undefined (обычная отправка)', () => {
    expect(fromNewMessageEvt(base).sendAs).toBeUndefined()
  })

  it('send-as живого кадра делает сообщение ВХОДЯЩИМ у самого отправителя', () => {
    const meId = 7
    const asChannel = fromNewMessageEvt({ ...base, send_as: { chat_id: 9, title: 'Канал' } })
    const asMyself = fromNewMessageEvt(base)
    expect(deriveOut(asChannel, meId)).toBe(false)
    expect(deriveOut(asMyself, meId)).toBe(true)
  })

  // Медиа-мета кадра — те же ключи, что у витрины истории: живой медиа-бабл
  // обязан рисоваться полноценно (точный бокс, превью до сети, признак гифки),
  // а не заглушкой до перезагрузки окна.
  it('переносит медиа-мету кадра целиком', () => {
    const m = fromNewMessageEvt({
      ...base, type: 'video', media_id: 42,
      media_w: 320, media_h: 240, media_mime: 'video/mp4', media_blur: 'AAECAw==',
      media_has_thumb: true, media_duration: 3, media_size: 400000, media_name: 'cat.mp4',
      media_title: 'T', media_performer: 'P', media_animated: true,
      media_waveform: 'HwAq/wc=',
    })
    expect({
      mediaId: m.mediaId, mediaWidth: m.mediaWidth, mediaHeight: m.mediaHeight,
      mediaMime: m.mediaMime, mediaBlur: m.mediaBlur, mediaHasThumb: m.mediaHasThumb,
      mediaDuration: m.mediaDuration, mediaSize: m.mediaSize, mediaName: m.mediaName,
      mediaWaveform: m.mediaWaveform,
      mediaTitle: m.mediaTitle, mediaPerformer: m.mediaPerformer, mediaAnimated: m.mediaAnimated,
    }).toEqual({
      mediaId: 42, mediaWidth: 320, mediaHeight: 240,
      mediaMime: 'video/mp4', mediaBlur: 'AAECAw==', mediaHasThumb: true,
      mediaDuration: 3, mediaSize: 400000, mediaName: 'cat.mp4',
      mediaWaveform: 'HwAq/wc=',
      mediaTitle: 'T', mediaPerformer: 'P', mediaAnimated: true,
    })
  })

  // Спойлер — отдельным пином по той же причине, что и волна: если ключа нет в
  // КАДРЕ, живое сообщение приедет БЕЗ спойлера и на миг обнажит медиа, а после
  // перезагрузки истории спойлер появится. Ровно дефект класса send_as.
  it('переносит признак скрытого медиа из живого кадра', () => {
    const m = fromNewMessageEvt({ ...base, type: 'photo', media_id: 43, media_blur: 'AAECAw==', media_spoiler: true })
    expect(m.mediaSpoiler).toBe(true)
    expect(fromNewMessageEvt({ ...base, type: 'photo', media_id: 43 }).mediaSpoiler).toBeUndefined()
  })

  // Пики волны голосового — отдельным пином: их отсутствие в КАДРЕ не ломает
  // ни один медиа-бабл, кроме голосового, и молча оставляет живое голосовое
  // без волны до перезагрузки истории (дефект класса send_as).
  it('переносит пики волны голосового из живого кадра', () => {
    const m = fromNewMessageEvt({ ...base, type: 'voice', media_id: 55, media_duration: 7, media_waveform: 'HwAq/wc=' })
    expect(m.mediaWaveform).toBe('HwAq/wc=')
    expect(fromNewMessageEvt({ ...base, type: 'voice', media_id: 55 }).mediaWaveform).toBeUndefined()
  })
})
