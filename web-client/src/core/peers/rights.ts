// Права зрителя в чате — вопрос к КОНСТРУКТОРУ, а не к плоской карточке.
//
// Порт `appManagers/utils/chats/hasRights.ts` (целиком) и обёртки
// `appChatsManager.hasRights` (`appChatsManager.ts:258+`).
//
// ── Зачем ───────────────────────────────────────────────────────────────────
// Было: витрина отдавала `my_role: 'creator'|'admin'|…` плюс битмаск
// `my_rights`, и каждый экран задавал вопрос по-своему — `myRole === 'creator'
// || (myRights & 64) !== 0` в одном файле, `myRole === 'admin'` в другом,
// `defaultPermissions & 1` в третьем. После шага C ни `my_role`, ни
// `my_rights`, ни `default_permissions` на проводе нет вовсе (решение №3
// разбора): роль — это `pFlags.creator` и НАЛИЧИЕ `admin_rights`, а права
// обычного участника — `default_banned_rights`.
//
// ⚠ ПОЛЯРНОСТЬ. `ChatBannedRights` это ЗАПРЕТЫ: выставленный флаг означает
// «НЕЛЬЗЯ». Прежний `default_permissions` был ровно наоборот — «что МОЖНО».
// Перепутать значит перевернуть права всей группы задом наперёд, поэтому
// единственное место, где знак читается, — этот файл (ветка `send_*`:
// `if (!isAdmin && myFlags[action]) return false`). Инверсию делает бэкенд один
// раз (`domain.NewChatBannedRights`), клиент читает готовые запреты.
//
// Персональные ограничения (`banned_rights` у `channel`, наш
// `MemberRestriction.DeniedRights`) — тоже уже готовые ЗАПРЕТЫ и инверсии не
// требуют; это вторая половина той же ловушки, выписанной в разборе.

import type { Chat, ChatAdminRights, ChatBannedRights } from './peer'

/**
 * Действие, право на которое проверяют. Порт `ChatRights`
 * (`appChatsManager.ts:27-30`) в объёме нашего предмета: восемь флагов
 * `chatAdminRights` (ровно наш прежний битмаск `Rights`), пять флагов
 * `chatBannedRights` (прежний `MemberPerms`) и два синтетических действия
 * оригинала, у которых есть потребитель — `invite_links` и `just_admin`.
 *
 * Не объявлены (предмета нет ни бита, ни механики): `anonymous`, `manage_call`,
 * `manage_topics`, `manage_ranks`, `post/edit/delete_stories`,
 * `manage_direct_messages`, гранулярные запреты новых слоёв
 * (`send_photos`/`send_videos`/…/`view_messages`), а также `change_type`/
 * `delete_chat`/`toggle_forum`/`view_participants`/`create_giveaway`.
 */
export type ChatRights =
  | 'change_info'
  | 'post_messages'
  | 'edit_messages'
  | 'delete_messages'
  | 'ban_users'
  | 'invite_users'
  | 'pin_messages'
  | 'add_admins'
  | 'send_messages'
  | 'send_media'
  | 'invite_links'
  | 'just_admin'

/**
 * Порт `hasRights(chat, action, rights?)`. Ветвление и порядок проверок — как в
 * оригинале, строка в строку по тем действиям, у которых есть предмет.
 *
 * `rights` НЕ передают, когда спрашивают про себя (`isCheckingRightsForSelf`):
 * тогда создатель отвечает «да» на всё сразу, а иначе набор берётся из самого
 * чата — `admin_rights` (я админ), `banned_rights` (моё персональное
 * ограничение) либо `default_banned_rights` (ограничения обычного участника).
 * Третий аргумент нужен там, где проверяют права ЧУЖИЕ (редактор прав
 * участника).
 */
export function hasRights(
  chat: Chat | undefined,
  action: ChatRights,
  rights?: ChatAdminRights | ChatBannedRights,
): boolean {
  if (!chat) return false
  if (chat._ === 'chatEmpty') return false

  if (chat._ === 'chat' && chat.pFlags?.deactivated) return false

  const isCheckingRightsForSelf = rights === undefined
  if (chat._ !== 'chatForbidden' && chat._ !== 'channelForbidden' && chat.pFlags?.creator && isCheckingRightsForSelf) {
    return true
  }

  if (chat._ === 'chatForbidden' || chat._ === 'channelForbidden') return false
  if (chat.pFlags?.left && !(chat._ === 'channel' && chat.pFlags?.megagroup)) return false

  if (!rights) {
    rights = chat.admin_rights ||
      (chat._ === 'channel' ? chat.banned_rights : undefined) ||
      chat.default_banned_rights
    if (!rights) return false
  }

  // `pFlags` обоих конструкторов — это «что можно» у админа и «что НЕЛЬЗЯ» у
  // участника; какой из двух смыслов сейчас в руках, говорит `isAdmin`.
  const myFlags: Partial<Record<string, true>> = rights.pFlags ?? {}
  const isAdmin = rights._ === 'chatAdminRights'

  switch (action) {
    case 'send_media':
    case 'send_messages': {
      if (!isAdmin && myFlags[action]) return false
      if (chat._ === 'channel' && !chat.pFlags?.megagroup && !myFlags.post_messages) return false
      break
    }

    // * revoke foreign messages
    case 'delete_messages':
      return !!myFlags[action]

    case 'pin_messages':
      return isAdmin
        ? !!(myFlags[action] || (!(chat._ === 'channel' && chat.pFlags?.megagroup) && myFlags.post_messages))
        : !myFlags[action]

    case 'invite_links':
      return isAdmin && !!myFlags.invite_users

    case 'change_info':
    case 'invite_users':
      return isAdmin || (chat._ === 'channel' && chat.pFlags?.broadcast) ? !!myFlags[action] : !myFlags[action]

    case 'add_admins':
    case 'post_messages':
    case 'edit_messages':
      return isAdmin && !!myFlags[action]

    case 'ban_users':
      return isAdmin && !!myFlags.ban_users

    case 'just_admin':
      return isAdmin
  }

  return true
}

// ── Битмаск возможностей участника ↔ запреты схемы ──────────────────────────
//
// Наш `MemberPerms` жив только НА ЗАПИСИ: экран «Разрешения» отправляет
// `PUT /chats/{id}/permissions` тем же битмаском, что и раньше (эту ручку
// шаг C не менял). Читать же теперь надо `default_banned_rights` — и это ДРУГОЙ
// ЗНАК, поэтому перевод живёт ровно здесь.

/** Зеркало `backend/internal/domain/mtchat.go::bannedRightFlags` — порядок и
 *  имена те же, чтобы расхождение выражалось правкой одной таблицы. */
const MEMBER_PERM_FLAGS = [
  { bit: 1, flag: 'send_messages' },
  { bit: 2, flag: 'send_media' },
  { bit: 4, flag: 'invite_users' },
  { bit: 8, flag: 'pin_messages' },
  { bit: 16, flag: 'change_info' },
] as const

/** Все пять возможностей (`domain.AllMemberPerms`). */
export const ALL_MEMBER_PERMS = 31

/**
 * Битмаск «что обычному участнику МОЖНО» — из `chat.default_banned_rights`.
 *
 * ⚠ ЗДЕСЬ ЖИВЁТ ИНВЕРСИЯ. Прежнее поле витрины `default_permissions` было
 * «что можно», конструктор схемы — «что НЕЛЬЗЯ»: выставленный флаг означает
 * запрет. Прочитать его как разрешения значит перевернуть права всей группы
 * задом наперёд, поэтому знак читается ровно в одной функции.
 *
 * Карточки чата ещё нет (или запретов у него нет вовсе) — «можно всё»: то же
 * значение по умолчанию, что и у колонки `chats.default_permissions` (31), и
 * тот же оптимистичный ответ, что был у прежнего `?? 31`.
 */
export function allowedMemberPerms(chat: Chat | undefined): number {
  const banned = chat && (chat._ === 'chat' || chat._ === 'channel') ? chat.default_banned_rights : undefined
  if (!banned) return ALL_MEMBER_PERMS
  let out = 0
  for (const { bit, flag } of MEMBER_PERM_FLAGS) if (!banned.pFlags?.[flag]) out |= bit
  return out
}
