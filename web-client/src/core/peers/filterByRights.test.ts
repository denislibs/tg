// Кто может быть получателем пересылки/«Поделиться» — порт
// `AppSelectPeers.filterByRights` (tweb `appSelectPeers.tsx:827-834`) и
// `canSendToUser` (`appManagers/utils/users/canSendToUser.ts`).
//
// Жалоба: в «Поделиться» были чужие каналы. У tweb попап пересылки зовёт
// селектор с `chatRightsActions: ['send_plain']`, и чат без права писать туда
// не попадает: канал — только с `post_messages`, группа — если писать не
// запрещено (или зритель админ/создатель).
import { describe, expect, it } from 'vitest'

import type { Channel, Chat, User } from './peer'
import { canSendToUser, filterByRights, resolveChatRightsActions } from './filterByRights'
import { makeMessage } from '../messages/testMessage'

const channel = (over: Partial<Channel> = {}): Channel => ({
  _: 'channel', id: 42, title: 'Чат', photo: { _: 'chatPhotoEmpty' }, date: 0, ...over,
})
const OPEN: Channel['default_banned_rights'] = { _: 'chatBannedRights', until_date: 0 }
const NO_TEXT: Channel['default_banned_rights'] = { _: 'chatBannedRights', pFlags: { send_messages: true }, until_date: 0 }
const NO_MEDIA: Channel['default_banned_rights'] = { _: 'chatBannedRights', pFlags: { send_media: true }, until_date: 0 }

const user = (over: Partial<Extract<User, { _: 'user' }>> = {}): User => ({ _: 'user', id: 7, ...over })

const send = (peerId: PeerId, peer: User | Chat | undefined) => filterByRights(peerId, peer, ['send_messages'])

describe('filterByRights — получатель пересылки', () => {
  it('канал, где зритель подписчик, не виден', () => {
    expect(send(-42, channel({ pFlags: { broadcast: true }, default_banned_rights: OPEN }))).toBe(false)
  })

  it('свой канал и канал, где зритель админ с post_messages, видны', () => {
    expect(send(-42, channel({ pFlags: { broadcast: true, creator: true }, default_banned_rights: OPEN }))).toBe(true)
    expect(send(-42, channel({
      pFlags: { broadcast: true },
      admin_rights: { _: 'chatAdminRights', pFlags: { post_messages: true } },
      default_banned_rights: OPEN,
    }))).toBe(true)
  })

  it('канал, где админ без post_messages, не виден', () => {
    expect(send(-42, channel({
      pFlags: { broadcast: true },
      admin_rights: { _: 'chatAdminRights', pFlags: { pin_messages: true } },
      default_banned_rights: OPEN,
    }))).toBe(false)
  })

  it('группа с запретом писать не видна участнику, но видна своему создателю и админу', () => {
    expect(send(-42, channel({ pFlags: { megagroup: true }, default_banned_rights: NO_TEXT }))).toBe(false)
    expect(send(-42, channel({ pFlags: { megagroup: true, creator: true }, default_banned_rights: NO_TEXT }))).toBe(true)
    expect(send(-42, channel({
      pFlags: { megagroup: true },
      admin_rights: { _: 'chatAdminRights', pFlags: { pin_messages: true } },
      default_banned_rights: NO_TEXT,
    }))).toBe(true)
  })

  it('обычная группа видна', () => {
    expect(send(-42, channel({ pFlags: { megagroup: true }, default_banned_rights: OPEN }))).toBe(true)
  })

  it('покинутый канал и карточка без прав не видны (hasRights: прав нет — нельзя)', () => {
    expect(send(-42, channel({ pFlags: { megagroup: true, left: true }, default_banned_rights: OPEN }))).toBe(true) // супергруппа: left не отсекает
    expect(send(-42, channel({ pFlags: { broadcast: true, left: true, creator: true } }))).toBe(true) // создатель — да
    expect(send(-42, channel({ pFlags: { broadcast: true, left: true }, default_banned_rights: OPEN }))).toBe(false)
    expect(send(-42, channel({ pFlags: { megagroup: true } }))).toBe(false)
    expect(send(-42, undefined)).toBe(false)
  })

  it('личка видна, удалённый аккаунт — нет', () => {
    expect(send(7, user())).toBe(true)
    expect(send(7, user({ pFlags: { deleted: true } }))).toBe(false)
    expect(send(7, undefined)).toBe(false)
  })

  it('медиа-действие проверяет запрет медиа, а пользователей не отсекает (tweb: только send_plain)', () => {
    const noMedia = channel({ pFlags: { megagroup: true }, default_banned_rights: NO_MEDIA })
    expect(filterByRights(-42, noMedia, ['send_media'])).toBe(false)
    expect(filterByRights(-42, noMedia, ['send_messages'])).toBe(true)
    expect(filterByRights(7, user({ pFlags: { deleted: true } }), ['send_media'])).toBe(true)
  })
})

describe('canSendToUser', () => {
  it('порт `canSendToUser.ts`: нельзя только удалённому (и Replies, которого у нас нет)', () => {
    expect(canSendToUser(user())).toBe(true)
    expect(canSendToUser(user({ pFlags: { bot: true } }))).toBe(true)
    expect(canSendToUser(user({ pFlags: { deleted: true } }))).toBe(false)
    expect(canSendToUser({ _: 'userEmpty', id: 7 })).toBe(false)
    expect(canSendToUser(undefined)).toBe(false)
  })
})

// Порт `resolveChatRightsActions` (tweb `popups/forward.tsx:20-91`): что
// получатель должен мочь, решают сами пересылаемые сообщения.
describe('resolveChatRightsActions', () => {
  const geo = { _: 'messageMediaGeo' as const, geo: { _: 'geoPoint' as const, long: 0, lat: 0 } }

  it('текст и карточка ссылки — текст; вложение — медиа; ничего — текст', () => {
    expect(resolveChatRightsActions([makeMessage({ id: 1, peerId: 7, text: 'привет' })])).toEqual(['send_messages'])
    expect(resolveChatRightsActions([makeMessage({ id: 1, peerId: 7, media: geo })])).toEqual(['send_media'])
    expect(resolveChatRightsActions([
      makeMessage({ id: 1, peerId: 7, text: 'a' }),
      makeMessage({ id: 2, peerId: 7, media: geo }),
    ])).toEqual(['send_messages', 'send_media'])
    expect(resolveChatRightsActions([])).toEqual(['send_messages'])
  })
})
