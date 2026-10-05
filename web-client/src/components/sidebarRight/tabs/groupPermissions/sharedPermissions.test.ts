/**
 * Кит вкладок прав — порт tweb `groupPermissions/sharedPermissions.ts` (812502980),
 * задача 0б-6 волны 7. Вкладка прав группы (`groupPermissions.solid.test.tsx`)
 * покрывает `ChatPermissions` с `forChat` и `createSolidTabState`; здесь — то, что
 * читает следующая вкладка (права участника, задача 0б-7): `ChatPermissions` с
 * участником (запреты поверх запретов чата, замок у запрещённого всем) и
 * `ChatAdministratorRights` (набор строк группы и канала, `canEdit`, `takeOut`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ListenerSetter from '@helpers/listenerSetter'
import type { Channel } from '@core/peers/peer'
import type { Managers } from '@/client/bootstrap'
import lang from '@/lang'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { adminRightsMask } from '@core/peers/rights'
import { ChatAdministratorRights, ChatPermissions } from './sharedPermissions'

const GROUP: Channel = {
  _: 'channel',
  id: 30,
  title: 'Group',
  photo: { _: 'chatPhotoEmpty' },
  date: 0,
  pFlags: { megagroup: true, creator: true },
  default_banned_rights: { _: 'chatBannedRights', until_date: 0, pFlags: { change_info: true } },
} as Channel

const CHANNEL: Channel = { ...GROUP, id: 40, pFlags: { broadcast: true, creator: true }, default_banned_rights: undefined } as Channel

let listenerSetter: ListenerSetter
let appendTo: HTMLElement

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [GROUP, CHANNEL] }])
  listenerSetter = new ListenerSetter()
  appendTo = document.createElement('div')
  document.body.append(appendTo)
})

afterEach(() => {
  listenerSetter.removeAll()
  document.body.replaceChildren()
})

const titles = () => [...appendTo.querySelectorAll(':scope > .row .row-title:not(.row-title-right)')].map((el) => el.textContent)
const inputs = () => [...appendTo.querySelectorAll<HTMLInputElement>(':scope > .row input.checkbox-field-input')]

describe('ChatPermissions — права участника', () => {
  it('запреты участника поверх запретов чата; запрещённое всем — замок «отключено в правах группы»', () => {
    const permissions = new ChatPermissions({
      chatId: 30,
      listenerSetter,
      appendTo,
      participant: {
        _: 'channelParticipantBanned',
        peer: { _: 'peerUser', user_id: 7 },
        kicked_by: 1,
        date: 0,
        banned_rights: { until_date: 1700000000, pFlags: { send_media: true } },
      },
    }, {} as Managers)

    expect(titles()).toEqual([
      lang.UserRestrictionsSend,
      lang.UserRestrictionsSendMedia,
      lang.UserRestrictionsInviteUsers,
      lang.UserRestrictionsPinMessages,
      lang.UserRestrictionsChangeInfo,
    ])
    // `change_info` запрещён всем — снят и у участника (combineParticipantBannedRights)
    expect(inputs().map((input) => input.checked)).toEqual([true, false, true, true, false])
    // :103-104 — запрещённое всем менять у участника нельзя
    const changeInfo = permissions.fields.find((field) => field.flags[0] === 'change_info')!
    expect(changeInfo.restrictionText).toBe('UserRestrictionsDisabled')
    expect(changeInfo.checkboxField!.input.disabled).toBe(true)
    expect(permissions.fields.filter((field) => field.restrictionText)).toHaveLength(1)

    // срок участника сохраняется в собранных правах
    expect(permissions.takeOut()).toEqual({
      _: 'chatBannedRights',
      until_date: 1700000000,
      pFlags: { send_media: true, change_info: true },
    })
  })

  it('setUntilDate меняет срок собранных прав и сообщает об изменении', () => {
    let changes = 0
    const permissions = new ChatPermissions({ chatId: 30, listenerSetter, appendTo, forChat: true, onSomethingChanged: () => ++changes }, {} as Managers)
    expect(permissions.takeOut().until_date).toBe(0x7FFFFFFF)

    permissions.setUntilDate(1800000000)
    expect(changes).toBe(1)
    expect(permissions.takeOut().until_date).toBe(1800000000)
  })
})

describe('ChatAdministratorRights', () => {
  it('группа: строки в порядке оригинала, создатель — всё отмечено и закрыто «нельзя изменить»', () => {
    const rights = new ChatAdministratorRights({
      chatId: 30,
      listenerSetter,
      appendTo,
      chat: GROUP,
      canEdit: true,
      participant: { _: 'channelParticipantCreator', user_id: 1, admin_rights: { _: 'chatAdminRights', pFlags: {} } },
    })

    expect(titles()).toEqual([
      lang.EditAdminChangeGroupInfo,
      lang.EditAdminGroupDeleteMessages,
      lang.EditAdminBanUsers,
      lang.EditAdminAddUsersViaLink,
      lang.EditAdminPinMessages,
      lang.EditAdminSendAnonymously,
      lang.EditAdminAddAdmins,
    ])
    // `CREATOR_EXCEPTIONS` (:278-280): анонимность владелец себе меняет сам
    const locked = rights.fields.filter((field) => field.restrictionText === 'EditCantEditPermissions').map((field) => field.flags[0])
    expect(locked).toEqual(['change_info', 'delete_messages', 'ban_users', 'invite_users', 'pin_messages', 'add_admins'])
  })

  it('форум: строка «Управление темами»; анонимность и темы уходят в права (биты 256 и 512 бэкенда)', () => {
    const forum = { ...GROUP, id: 31, pFlags: { megagroup: true, creator: true, forum: true } } as Channel
    applyPeerOps([{ op: 'upsert', peers: [forum] }])
    const rights = new ChatAdministratorRights({
      chatId: 31,
      listenerSetter,
      appendTo,
      chat: forum,
      canEdit: true,
      rights: { _: 'chatAdminRights', pFlags: { anonymous: true } },
    })

    expect(titles()).toEqual([
      lang.EditAdminChangeGroupInfo,
      lang.EditAdminGroupDeleteMessages,
      lang.EditAdminBanUsers,
      lang.EditAdminAddUsersViaLink,
      lang.EditAdminPinMessages,
      lang.ManageTopicsPermission,
      lang.EditAdminSendAnonymously,
      lang.EditAdminAddAdmins,
    ])
    rights.fields.find((field) => field.flags[0] === 'manage_topics')!.checkboxField!.checked = true
    const out = rights.takeOut()
    expect(out.pFlags).toEqual({ anonymous: true, manage_topics: true })
    expect(adminRightsMask(out.pFlags)).toBe(256 | 512)
  })

  it('канал: «Управление сообщениями» — группа с тремя вложенными; права админа — отметки и takeOut', () => {
    const rights = new ChatAdministratorRights({
      chatId: 40,
      listenerSetter,
      appendTo,
      chat: CHANNEL,
      canEdit: true,
      rights: { _: 'chatAdminRights', pFlags: { change_info: true, post_messages: true, edit_messages: true } },
    })

    expect(titles()).toEqual([
      lang.EditAdminChangeChannelInfo,
      expect.stringContaining(lang['AdminRights.ManageMessages']),
      lang['Channel.EditAdmin.PermissionInviteSubscribers'],
      lang.EditAdminAddAdmins,
    ])
    const nested = [...appendTo.querySelectorAll('.accordion .row')].map((row) => row.textContent)
    expect(nested).toEqual([lang.EditAdminPostMessages, lang.EditAdminEditMessages, lang.EditAdminDeleteMessages])
    expect(rights.fields.some((field) => field.restrictionText)).toBe(false)

    const deleteMessages = rights.fields.find((field) => field.flags[0] === 'delete_messages')!
    deleteMessages.checkboxField!.checked = true
    // все три вложенных отмечены — отмечена и группа; её синтетический флаг
    // `post_messages_nested` уходит в права, как у оригинала (:314-326), а бэкенд
    // отбрасывает незнакомое имя (`domain/mtchat.go::keepPFlags`)
    expect(rights.takeOut()).toEqual({
      _: 'chatAdminRights',
      pFlags: { change_info: true, post_messages: true, edit_messages: true, delete_messages: true, post_messages_nested: true },
    })
  })

  it('canEdit: false — каждая строка «нельзя изменить права этого админа»', () => {
    const rights = new ChatAdministratorRights({ chatId: 30, listenerSetter, appendTo, chat: GROUP, canEdit: false })
    expect(rights.fields.every((field) => field.restrictionText === 'EditAdminCantEdit')).toBe(true)
  })
})
