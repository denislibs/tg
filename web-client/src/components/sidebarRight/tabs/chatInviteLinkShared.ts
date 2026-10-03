/**
 * Порт tweb `src/components/sidebarRight/tabs/chatInviteLinkShared.ts:1-153`
 * (812502980) — общее у трёх вкладок ссылок-приглашений правой колонки
 * (`chatInviteLinks.solid.tsx`, `chatInviteLink.solid.tsx`,
 * `editChatInviteLink.solid.tsx`, задача 0б-3 волны 7): тип ссылки, её
 * «активность», виджет `ChatInviteLink` над `InviteLink`, загрузчик
 * вступивших и предзагрузка вкладки списка.
 *
 * Ссылка — конструктор провода `chatInviteExported` в форме оригинала:
 * `link` — полный публичный адрес `t.me/+<хеш>` на нашем хосте ссылок
 * (`core/publicLink.ts`; страницу `/+{hash}` рендерит бэкенд), его отдают
 * ручки `appChatInvitesManager` (`core/managers/groupsManager.ts`).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. (О-120) Постоянной ссылки нет на бэкенде: у `chatInviteExported` нет
 *     `pFlags.permanent`, у `channelFull` — `exported_invite`, отзыв не отдаёт
 *     `messages.exportedChatInviteReplaced`. Поэтому `getChatInviteLinksInitArgs`
 *     вместо `chatFull` (`:151`) несёт `exportedInvite` — порт
 *     `appProfileManager.getChatInviteLink` (`getChatInviteLink` ниже): «постоянная»
 *     — самая старая неотозванная ссылка без имени, срока, лимита и одобрения
 *     (такую сервер выдаёт группе при рождении), нет её — выпускается новая.
 *     Для публичного чата (с именем) она не нужна и не выпускается (`:575`).
 *  2. (О-121) Ссылок других админов нет на бэкенде (`getAdminsWithInvites`,
 *     фильтр `admin_id` у `getExportedChatInvites`): `adminsInvites` — `false`
 *     (`:150`, как у оригинала без права `change_type`), `adminId` у выборок не
 *     передаётся.
 *  3. (О-122) Заявок ПО ССЫЛКЕ нет на проводе (`requested` у ссылки). Заявки
 *     чата целиком (`requested` без ссылки, вкладка «Заявки»
 *     `chatRequests.solid.tsx`, 0б-7) — ручка `/join_requests`
 *     (`groups.getChatInviteImporters`), `deleteImporter` (`:132-135`) портирован.
 *  4. (О-124) Вступившие — одна страница сервера (первые 50, без смещения и
 *     поиска `q`): `load` отдаёт `isEnd: true` сразу, иначе селектор переспросил
 *     бы ту же страницу.
 *  5. Имя чата в `setChatInvite(username)` — публичный адрес нашего хоста
 *     (`publicUsernameLink`), а не литерал `'t.me/' + username` (`:57`).
 *  6. `managers` — параметр (`AppManagers` у оригинала берётся из `rootScope`
 *     синглтоном, у нас DI-ручки вне вкладки нет — тот же приём, что у
 *     `editFolderShared.ts`); ключ пира — `toPeerId(chatId as number, true)`.
 */
import tsNow from '@helpers/tsNow'
import { i18n, type LangPackKey } from '@lib/langPack'
import lottieLoader from '@lib/lottie/lottieLoader'
import noop from '@helpers/noop'
import { InviteLink } from '@components/sidebarLeft/tabs/inviteLink'
import { cachedChat } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import { publicUsernameLink } from '@core/publicLink'
import type { Channel } from '@core/peers/peer'
import type { ChatInviteExported, ChatInviteImporter } from '@core/managers/groupsManager'
import type { Managers } from '@/client/bootstrap'

export type ChatInvite = ChatInviteExported

export type ChatInviteActions = {
  revokeLink: () => void,
  deleteLink: () => void,
  editLink: () => void
}

export function isActiveInvite(invite: ChatInvite) {
  if(invite.pFlags?.revoked) {
    return false
  }

  if(invite.expire_date && invite.expire_date <= tsNow(true)) {
    return false
  }

  if(invite.usage_limit && invite.usage_limit <= (invite.usage || 0)) {
    return false
  }

  return true
}

export class ChatInviteLink extends InviteLink {
  public subtitle!: HTMLElement

  constructor(public options: ConstructorParameters<typeof InviteLink>[0] & {
    actions: ChatInviteActions,
    withSubtitle?: boolean
  }) {
    super({
      ...options,
    })

    if(options.withSubtitle) {
      this.subtitle = document.createElement('div')
      this.subtitle.classList.add('invite-link-subtitle', 'hide')
      this.container.append(this.subtitle)
    }
  }

  public setChatInvite(chatInvite: ChatInvite | string) {
    const isUsername = typeof(chatInvite) === 'string'
    // расхождение 5
    this.setUrl(isUsername ? publicUsernameLink(chatInvite) : chatInvite.link)

    if(this.subtitle) {
      if(!isUsername && chatInvite?.usage) {
        this.subtitle.replaceChildren(i18n('InviteLink.JoinedNew', [chatInvite.usage]))
      }

      this.subtitle.classList.toggle('hide', isUsername || !chatInvite?.usage)
    }

    let hasSomething: LangPackKey | undefined
    if(!isUsername) {
      if(chatInvite.pFlags?.revoked) {
        this.onButtonClick = () => this.options.actions.deleteLink()
        hasSomething = 'DeleteLink'
      } else if(!isActiveInvite(chatInvite)) {
        this.onButtonClick = () => this.options.actions.editLink()
        hasSomething = 'InviteLinks.Reactivate'
      }
    }

    if(!hasSomething) {
      hasSomething = 'ShareLink'
      this.onButtonClick = undefined
    }

    this.buttonText!.replaceChildren(i18n(hasSomething))
  }
}

/** Порт `getImportersLoader` (`:87-143`) — расхождения 3, 4. */
export function getImportersLoader({
  chatId,
  managers,
  requested,
  link,
}: {
  chatId: ChatId,
  managers: Managers,
  requested?: boolean,
  link: string | undefined
}) {
  const importers: ChatInviteImporter[] = []
  const importersMap: Map<PeerId, ChatInviteImporter> = new Map()
  let lastQuery = ''
  const load = async(q: string, _middleware: () => boolean) => {
    if(lastQuery !== q) {
      importers.length = 0
      importersMap.clear()
      lastQuery = q
    }

    const result = await managers.groups.getChatInviteImporters({ chatId, link, requested })

    importers.push(...result.importers)

    return {
      result: result.importers.map((importer) => {
        const peerId = toPeerId(importer.user_id, false)
        importersMap.set(peerId, importer)
        return peerId
      }),
      isEnd: true, // расхождение 4
    }
  }

  const deleteImporter = (peerId: PeerId) => {
    importers.splice(importers.findIndex((importer) => toPeerId(importer.user_id, false) === peerId), 1)
    importersMap.delete(peerId)
  }

  return {
    importers,
    importersMap,
    load,
    deleteImporter,
  }
}

/** Неотозванная ссылка «как постоянная» (расхождение 1): без имени, срока, лимита и одобрения. */
const isPermanentLike = (invite: ChatInvite) =>
  !invite.title && !invite.expire_date && !invite.usage_limit && !invite.pFlags?.request_needed

/**
 * Порт `appProfileManager.getChatInviteLink(chatId, force)` (tweb
 * `appProfileManager.ts:561-582`) — расхождение 1: `force` отзывает текущую
 * «постоянную» и выпускает новую (у оригинала — `exportChatInvite` с
 * `legacy_revoke_permanent`). Выдача сервера — от новых к старым, поэтому
 * «постоянная» — последняя подходящая.
 */
export async function getChatInviteLink(managers: Managers, chatId: ChatId, force?: boolean): Promise<ChatInvite> {
  const { invites } = await managers.groups.getExportedChatInvites({ chatId })
  const permanent = invites.filter(isPermanentLike).pop()
  if(!force && permanent) {
    return permanent
  }

  if(permanent) {
    await managers.groups.editExportedChatInvite({ chatId, link: permanent.link, revoked: true })
  }

  return managers.groups.exportChatInvite({ chatId })
}

export function getChatInviteLinksInitArgs(managers: Managers, chatId: ChatId) {
  const animationData = lottieLoader.loadAnimationFromURLManually('UtyanLinks')
  // отказ (нет WASM SIMD) гасит сама вкладка статичным кадром; здесь — чтобы
  // обещание не считалось необработанным до её подписки (как `preloadFolderAnimation`)
  animationData.catch(noop)
  const chat = cachedChat(toPeerId(chatId as number, true)) as Channel | undefined
  return {
    animationData,
    invites: managers.groups.getExportedChatInvites({ chatId }),
    invitesRevoked: managers.groups.getExportedChatInvites({ chatId, revoked: true }),
    adminsInvites: false as const, // расхождение 2
    // расхождение 1: публичному чату постоянная ссылка не показывается (`chatInviteLinks.tsx:575`)
    exportedInvite: chat?.username ? Promise.resolve(undefined) : getChatInviteLink(managers, chatId),
  }
}
