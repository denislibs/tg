// Порт tweb `src/components/sortedUserList.ts` (134) — сортированный список
// пользователей/чатов строками чатлиста: вкладка «Участники» shared media
// (`appSearchSuper.ts::loadMembers`) и, дальше, «общие группы».
//
// Что делает: `SortedList` (`helpers/sortedList.ts`) с индексом по присутствию
// (`getUserStatusForSort`, у чатов 0 — они не сортируются) и убывающим
// порядком — онлайн первыми; строка — `addDialogNew` (`components/dialogRow.ts`,
// порт `appDialogsManager.addDialogNew`); подпись — статус пользователя
// (`userStatusLabel`) либо «N участников» у чата; ранг — правым слотом
// заголовка (`wrapParticipantRank`). Раз в `SORT_INTERVAL` (30 с) список
// пересортировывается — но только когда в нём есть пользователи, он в DOM и
// экран не занят тяжёлой анимацией (`updateListWith`, tweb :97-113).
//
// Расхождения с оригиналом:
//   • `lazyLoadQueue`, `withStories`, `meAsSaved` в `addDialogNew` (tweb :75-87)
//     — не передаются: у нашей строки этих опций нет (шапка `dialogRow.ts`);
//   • статус пользователя берётся из ЗЕРКАЛА карточек (`cachedUser`), а не
//     запросом к менеджеру (`appUsersManager.getUser`, :59): карточки участников
//     едут вектором `users` того же контейнера, и владелец публикует их в
//     зеркало до того, как ответ доедет до списка;
//   • подпись пользователя — `userStatusLabel(status)` (`core/presence.ts`,
//     порт `getUserStatusString` в объёме ветки по статусу) — ветки по самой
//     карточке (бот/поддержка/служебные) там не портированы, ЗАДАЧА #130;
//   • `createChatListOptions` (:31, :119) не портированы: `createChatList` у
//     нас без опций (`dialogRow.ts`).
// Правки под строгий tsconfig: `safeAssign(this, options)` (:117) выписан по
// полям — у `options` есть `managers`/`middleware`, которые на инстанс лечь не
// должны.
import { addDialogNew, createChatList, type DialogElement, type DialogElementSize, type DialogDom, type DialogRowManagers } from '@components/dialogRow'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import isInDOM from '@helpers/dom/isInDOM'
import positionElementByIndex from '@helpers/dom/positionElementByIndex'
import replaceContent from '@helpers/dom/replaceContent'
import { fastRaf } from '@helpers/schedulers'
import SortedList, { type SortedElementBase } from '@helpers/sortedList'
import type { Middleware } from '@helpers/middleware'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'
import wrapParticipantRank from '@components/wrappers/participantRank'
import type { getParticipantRank } from '@core/peers/participant'
import { cachedChat, cachedUser } from '@core/peerCache'
import { isAnyChat, isUser } from '@core/peers/peerId'
import { getUserStatusForSort, userStatusLabel } from '@core/presence'
import { useI18nStore } from '@/i18n'

/** Статус — только у настоящей карточки (`userEmpty` его не несёт). */
const userStatus = (peerId: PeerId) => {
  const user = cachedUser(peerId)
  return user?._ === 'user' ? user.status : undefined
}

interface SortedUser extends SortedElementBase<PeerId> {
  dom: DialogDom,
  dialogElement: DialogElement
}

export type SortedUserListManagers = DialogRowManagers

export default class SortedUserList extends SortedList<SortedUser, PeerId> {
  protected static SORT_INTERVAL = 30e3
  public list: HTMLUListElement
  public ranks: Map<PeerId, ReturnType<typeof getParticipantRank>> = new Map()

  protected avatarSize: DialogElementSize = 'abitbigger'
  protected rippleEnabled = true
  protected autonomous = true
  protected onListLengthChange?: () => void
  protected managers: SortedUserListManagers

  constructor(options: Partial<{
    avatarSize: SortedUserList['avatarSize'],
    rippleEnabled: SortedUserList['rippleEnabled'],
    autonomous: SortedUserList['autonomous'],
    onListLengthChange: SortedUserList['onListLengthChange'],
    getIndex: SortedUserList['getIndex'],
    onUpdate: SortedUserList['onUpdate']
  }> & {
    managers: SortedUserListManagers,
    middleware: Middleware
  }) {
    super({
      getIndex: options.getIndex || ((element) => isAnyChat(element.id) ? 0 : getUserStatusForSort(userStatus(element.id))),
      onDelete: (element) => {
        element.dialogElement.remove()
        this.onListLengthChange?.()
      },
      onUpdate: options.onUpdate || ((element) => {
        if(isAnyChat(element.id)) {
          const status = getChatMembersString(cachedChat(element.id), useI18nStore.getState().tArgs)
          replaceContent(element.dom.lastMessageSpan, status)
        } else {
          const status = userStatusLabel(userStatus(element.id))
          replaceContent(element.dom.lastMessageSpan, status)

          const rank = this.ranks.get(element.id)
          element.dialogElement.titleRight.replaceChildren(...(rank ? [wrapParticipantRank(rank)] : []))
        }
      }),
      onSort: (element, idx) => {
        const willChangeLength = element.dom.listEl.parentElement !== this.list
        positionElementByIndex(element.dom.listEl, this.list, idx)

        if(willChangeLength && this.onListLengthChange) {
          this.onListLengthChange()
        }
      },
      onElementCreate: (base) => {
        const dialogElement = addDialogNew({
          peerId: base.id,
          container: false,
          avatarSize: this.avatarSize,
          autonomous: this.autonomous,
          rippleEnabled: this.rippleEnabled,
          wrapOptions: {
            middleware: this.middlewareHelper.get(),
          },
          managers: this.managers,
        })

        const rank = this.ranks.get(base.id)
        dialogElement.titleRight.replaceChildren(...(rank ? [wrapParticipantRank(rank)] : []))

        ;(base as SortedUser).dom = dialogElement.dom
        ;(base as SortedUser).dialogElement = dialogElement
        return base as SortedUser
      },
      updateElementWith: fastRaf,
      updateListWith: async(callback) => {
        if(!Array.from(this.elements.values()).some((element) => isUser(element.id))) {
          return callback(false)
        }

        if(!isInDOM(this.list)) {
          return callback(false)
        }

        await getHeavyAnimationPromise()

        if(!isInDOM(this.list)) {
          return callback(false)
        }

        callback(true)
      },
      middleware: options.middleware,
    })

    if(options.avatarSize !== undefined) this.avatarSize = options.avatarSize
    if(options.rippleEnabled !== undefined) this.rippleEnabled = options.rippleEnabled
    if(options.autonomous !== undefined) this.autonomous = options.autonomous
    this.onListLengthChange = options.onListLengthChange
    this.managers = options.managers

    this.list = createChatList()

    // tweb `:121-132` — цикл пересортировки; глохнет сам, как только
    // `updateList` ответит «нельзя» (список не в DOM или middleware протух).
    const doTimeout = () => {
      window.setTimeout(() => {
        this.updateList((good) => {
          if(good) {
            doTimeout()
          }
        })
      }, SortedUserList.SORT_INTERVAL)
    }

    doTimeout()
  }
}
