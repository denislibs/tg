// Порт tweb `src/components/autonomousDialogList/dialogs.ts` (812502980, 854 строки):
// список диалогов ОДНОЙ папки (`xd`) — скроллер, `SortedDialogList`, правило
// принадлежности папке, строка «Архив» в «Всех чатах», онлайн-точка, бейджи на
// аватарах узкой колонки. Создаёт его `appDialogsManager.l(filter)`
// (`lib/appDialogsManager.ts`), он же держит `xds[filterId]`. Задача 1-4 волны 7.
//
// ИСТОЧНИК ДАННЫХ — Отступление В7-5 плана волны 7 (и Отступление 2 спеки
// `2026-08-12-dialogs-ownership-and-virtual-list-design.md`): событий tweb
// (`dialogs_multiupdate`, `dialog_drop`, `dialog_unread`, `dialog_draft`,
// `dialog_flush`, `dialog_notify_settings`, `peer_typings`, `user_update`,
// `filter_update`) у нас нет — их факты приезжают операциями воркера `dialog_op`
// в зеркало `chatsStore`, и второй шины не заводится. Список читает зеркало
// мостом (п. 1 «Мостов чтения» плана — подписка на стор и снимок `getState()`):
//   • сменились диалоги или их индексы — разница с прошлым снимком: изменённый
//     или новый диалог → `updateDialog` (`dialogs_multiupdate`/`dialog_unread`/
//     `dialog_draft`/`dialog_flush`), пропавший → снятие (`dialog_drop`);
//   • `typing` → `setTyping`/`unsetTyping` (`peer_typings`);
//   • `presence` → онлайн-точка (`user_update`);
//   • настройки уведомлений по типам (`notifyStore`) → `updateDialog` всем строкам
//     (`dialog_notify_settings`: мьют типа — общее правило `isDialogMuted`);
//   • определения папок, контакты и карточки пиров (правило пользовательской
//     папки читает тип пира) → `validateListForFilter` + `updateDialog`
//     (`filter_update`);
//   • статус рукопожатия секретного чата → `updateDialog` строки (наш, В7-1).
// Слой данных (воркер `dialogsManager`, зеркало, `dialog_op`, пагинация, `count`) не
// трогается: здесь только представление.
//
// Расхождения с оригиналом:
//  1. Принадлежность папке — правило, а не наличие индекса папки в хранилище
//     (`testDialogForFilter`: `getDialogIndex(dialog, indexKey) === undefined`): у
//     пользовательской папки своего индекса в зеркале нет. Правило ОДНО на
//     приложение и то же, что у владельца (`dialogsManager.ts::forFilter`):
//     «Все чаты» — всё, кроме архива; «Архив» — только архив; папка — не архив +
//     `dialogMatchesFolder` с мьютом по `isDialogMuted` (пин
//     `stores/noDuplicateMuteRule.test.ts`). Определения папки ещё нет — папка
//     пуста, а не «показать всё».
//  2. Строка «Архив» — `ArchiveDialog` в `CustomPinnedDialog`, как tweb (`:101-120`);
//     её состояние и расхождения — шапка `components/archiveDialog.solid.tsx`.
//     Первую страницу архива (`ensureHydrated`) список «Всех чатов» тянет на
//     первой своей загрузке: страницы «Всех чатов» уходят с `folder_id=0` и
//     архива не приносят никогда (спека `2026-08-13-dialogs-count-and-refresh-design.md`,
//     «Дополнение: вход в архив»).
//  3. Не портировано, с номерами: иконка звонка в группе (`processDialogForCallStatus`,
//     `setCallStatus`, `groupCallActiveIcon`) — `call_active` у чата в модели нет —
//     `// О-96 волна 7`; сообщества (`CommunityProjection`, `setupCommunityProjection`,
//     `communityProjectionRows`, `getCollapsedCommunityId`) — О-5; стриминговые
//     черновики (`streamed_message_*`) — `// О-97 волна 7`; таймер автоудаления на
//     аватаре (`auto_delete_period_update`) — `avatarNew` его не рисует;
//     `processContact`/`loadContacts` (контакты под коротким списком) и
//     `onListLengthChange` (пустые плейсхолдеры) — задача 1-8; `fetchChatlistUpdates`
//     — расхождение 14 менеджера.
//  4. `pinnedPeerIds` фильтра (`filterPinnedPeerIds`) — О-70.
import ArchiveDialog, { archiveDialogTagName, createArchiveDialogState, type DisposableArchiveDialogState } from '@components/archiveDialog.solid'
import { AutonomousDialogListBase, type BaseConstructorArgs, type LoadDialogsInnerArgs } from '@components/autonomousDialogList/base'
import Scrollable from '@components/scrollable'
import SortedDialogList, { CustomPinnedDialog } from '@components/sortedDialogList'
import { setTransition } from '@core/dom/setTransition'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import { dialogMatchesFolder } from '@core/folderFilter'
import { isDialogArchived, type Dialog } from '@core/models'
import { cachedChat, cachedPeer, subscribePeerMirror } from '@core/peerCache'
import { isForum } from '@core/peers/predicates'
import { isUserStatusOnline } from '@core/peers/peer'
import rootScope from '@lib/rootScope'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersStore } from '@stores/foldersStore'
import { isDialogMuted, useNotifyStore } from '@stores/notifyStore'
import { useSecretChatStore } from '@stores/secretChatStore'

type ConstructorArgs = BaseConstructorArgs & {
  filterId: number,
}

// ВРЕМЕННО до влития П-2 «ядро»: клик списка (`lib/appDialogsManager.ts`) берёт тег
// отсюда; у tweb — из `archiveDialog` (`appDialogsManager.ts:117`), запрос в контракте П-2
export { archiveDialogTagName as ARCHIVE_DIALOG_TAG_NAME }

export class AutonomousDialogList extends AutonomousDialogListBase {
  protected filterId: number
  private archiveDialogState?: DisposableArchiveDialogState
  private customPinnedDialog?: CustomPinnedDialog
  private unsubscribers: (() => void)[] = []

  constructor({ filterId, ...args }: ConstructorArgs) {
    super(args)

    this.filterId = filterId

    if(filterId === ALL_FOLDER_ID) {
      this.customPinnedDialog = new CustomPinnedDialog({
        render: () => {
          const element = new ArchiveDialog()
          element.feedProps({
            state: this.archiveDialogState!.state,
          })

          return element
        },
      })

      this.archiveDialogState = createArchiveDialogState({
        managers: this.managers,
        onHasArchiveDialogChanged: (hasDialogs) => {
          void this.onHasArchiveDialogChanged(hasDialogs)
        },
      })
    }

    this.needPlaceholderAtFirstTime = true

    const chatsUnsubscribe = useChatsStore.subscribe((state, prev) => {
      if(state.dialogs !== prev.dialogs || state.dialogIndexById !== prev.dialogIndexById) {
        this.onDialogsChange(prev.dialogs, state.dialogs, prev.dialogIndexById, state.dialogIndexById)
      }

      if(state.typing !== prev.typing) {
        this.onTypingChange(prev.typing, state.typing)
      }

      if(state.presence !== prev.presence) {
        this.onPresenceChange(prev.presence, state.presence)
      }
    })

    // `dialog_notify_settings` — мьют по типу чатов задевает все строки сразу
    const notifyUnsubscribe = useNotifyStore.subscribe((state, prev) => {
      if(state.settings !== prev.settings) this.updateAllDialogs()
    })

    // `filter_update` (расхождение 1): определения папок и контакты
    const foldersUnsubscribe = useAppStateStore.subscribe((state, prev) => {
      if(state.folders !== prev.folders) this.onFilterUpdate()
    })
    const contactsUnsubscribe = useFoldersStore.subscribe((state, prev) => {
      if(state.contactIds !== prev.contactIds) this.onFilterUpdate()
    })
    // правило пользовательской папки читает тип пира (группа/канал/бот)
    const peersUnsubscribe = subscribePeerMirror(() => {
      if(this.filterId !== ALL_FOLDER_ID && this.filterId !== ARCHIVE_FOLDER_ID) this.onFilterUpdate()
    })

    // В7-1: подпись строки секретного чата до рукопожатия
    const secretUnsubscribe = useSecretChatStore.subscribe((state, prev) => {
      if(state.byChat === prev.byChat) return
      const { dialogs } = useChatsStore.getState()
      Object.keys(state.byChat).forEach((key) => {
        if(state.byChat[+key] === prev.byChat[+key]) return
        const dialog = dialogs.find((d) => d.peerId === +key)
        if(dialog && this.isActive) this.updateDialog(dialog)
      })
    })

    this.unsubscribers.push(
      chatsUnsubscribe,
      notifyUnsubscribe,
      foldersUnsubscribe,
      contactsUnsubscribe,
      peersUnsubscribe,
      secretUnsubscribe,
    )
  }

  private get isActive() {
    return this.appDialogsManager.xd === this
  }

  protected getFilterId() {
    return this.filterId
  }

  /** `dialogs_multiupdate` + `dialog_drop` + `dialog_unread` + `dialog_draft` + `dialog_flush` (В7-5) */
  private onDialogsChange(
    prevDialogs: readonly Dialog[],
    dialogs: readonly Dialog[],
    prevIndexById: Record<number, number>,
    indexById: Record<number, number>,
  ) {
    if(!this.isActive) {
      return
    }

    const prevByPeerId = new Map(prevDialogs.map((dialog) => [dialog.peerId, dialog]))
    for(const dialog of dialogs) {
      const prev = prevByPeerId.get(dialog.peerId)
      prevByPeerId.delete(dialog.peerId)
      if(prev === dialog && prevIndexById[dialog.peerId] === indexById[dialog.peerId]) {
        continue
      }

      this.updateDialog(dialog)
    }

    // `dialog_drop`
    prevByPeerId.forEach((dialog) => this.deleteDialog(dialog))
  }

  /** `peer_typings` (`:120-133`): у форума набор показывают темы, не строка */
  private onTypingChange(prev: Record<number, unknown>, typing: Record<number, unknown>) {
    const peerIds = new Set([...Object.keys(prev), ...Object.keys(typing)].map(Number))
    const { dialogs } = useChatsStore.getState()
    peerIds.forEach((peerId) => {
      if(prev[peerId] === typing[peerId]) return
      const dialog = dialogs.find((d) => d.peerId === peerId)
      if(!dialog || isForum(cachedChat(peerId))) return

      if(typing[peerId] && Object.keys(typing[peerId]).length) {
        this.setTyping(dialog)
      } else {
        this.unsetTyping(dialog)
      }
    })
  }

  /** `user_update` (`:135-149`) */
  private onPresenceChange(prev: Record<number, unknown>, presence: ReturnType<typeof useChatsStore.getState>['presence']) {
    if(!this.isActive) {
      return
    }

    const now = Math.floor(Date.now() / 1000)
    Object.keys(presence).forEach((key) => {
      const userId = +key
      if(prev[userId] === presence[userId]) return
      const dom = this.getDialogDom(userId)
      if(!dom?.avatarEl) return
      // `getUserStatus` оригинала (appUsersManager.ts:864-866) у себя статуса не
      // отдаёт — «Избранное» без онлайн-точки
      const online = userId !== rootScope.myId && isUserStatusOnline(presence[userId], now)
      this.setOnlineStatus(dom.avatarEl.node, online)
    })
  }

  /** `dialog_notify_settings` всем строкам */
  private updateAllDialogs() {
    if(!this.isActive) {
      return
    }

    useChatsStore.getState().dialogs.forEach((dialog) => this.updateDialog(dialog))
  }

  /** `filter_update` (`:240-257`) */
  private onFilterUpdate() {
    if(!this.isActive) {
      return
    }

    this.validateListForFilter()
    this.updateAllDialogs()
  }

  /** tweb `:282-296` */
  public setOnlineStatus(element: HTMLElement, online: boolean) {
    const className = 'is-online'
    const hasClassName = element.classList.contains(className)
    if(!hasClassName && online) element.classList.add(className)
    setTransition({
      element: element,
      className: 'is-visible',
      forwards: online,
      duration: 250,
      onTransitionEnd: online ? undefined : () => {
        element.classList.remove(className)
      },
      useRafs: online && !hasClassName ? 2 : 0,
    })
  }

  /** tweb `:298-336` (расхождения 3, 4) */
  public generateScrollable(filter: { id: number }) {
    const filterId = filter.id
    const scrollable = new Scrollable(undefined, 'CL', 500)
    scrollable.container.dataset.filterId = '' + filterId

    const sortedDialogList = new SortedDialogList({
      appDialogsManager: this.appDialogsManager,
      log: this.log,
      scrollable: scrollable,
      filterId,
      requestItemForIdx: this.requestItemForIdx,
      onListShrinked: this.onListShrinked,
      itemSize: 72,
      onListLengthChange: () => {
        scrollable.onSizeChange()
      },
    })

    this.scrollable = scrollable
    this.sortedList = sortedDialogList
    this.bindScrollable()

    return { scrollable, list: sortedDialogList.list }
  }

  /** tweb `:338-354` (расхождение 1) */
  public testDialogForFilter(dialog: Dialog) {
    const { filterId } = this
    if(filterId === ARCHIVE_FOLDER_ID ? !isDialogArchived(dialog) : isDialogArchived(dialog)) {
      return false
    }

    if(filterId === ALL_FOLDER_ID || filterId === ARCHIVE_FOLDER_ID) {
      return true
    }

    const folder = useAppStateStore.getState().folders.find((f) => f.id === filterId)
    if(!folder) {
      return false
    }

    const muted = isDialogMuted(dialog, cachedChat(dialog.peerId), useNotifyStore.getState().settings)
    return dialogMatchesFolder(dialog, cachedPeer(dialog.peerId), folder, useFoldersStore.getState().contactIds, muted)
  }

  /** tweb `:356-380` */
  protected async loadDialogsInner({ offsetIndex, canFinish }: LoadDialogsInnerArgs) {
    const isFirstLoad = !offsetIndex

    const unblock = isFirstLoad ? this.sortedList.blockAnimation() : () => {}
    try {
      const [result] = await Promise.all([
        super.loadDialogsInner({
          offsetIndex,
          removePlaceholder: false,
          canFinish,
        }),
        this.ensureArchiveDialogHydrated(),
      ])

      this.placeholder?.detach(this.sortedList.itemsLength())

      return result.count ? {
        ...result,
        totalCount: this.sortedList.itemsLength(),
      } : result
    } finally {
      unblock()
    }
  }

  /** tweb `:413-425`: страница строки «Архив» — один раз; уже есть — закрепить строку (после `clear()` её нет) */
  private async ensureArchiveDialogHydrated() {
    if(!this.archiveDialogState) return

    const promise = this.archiveDialogState.state.ensureHydrated()
    if(!promise) {
      await this.onHasArchiveDialogChanged(this.archiveDialogState.hasArchiveDialog())
      return
    }

    await promise
  }

  /** tweb `:672-685` */
  public validateListForFilter() {
    const { dialogs } = useChatsStore.getState()
    this.sortedList.getAllDialogElementsMap().forEach((_, key) => {
      const dialog = dialogs.find((d) => d.peerId === key)
      if(!dialog || !this.testDialogForFilter(dialog)) {
        this.deleteDialogByKey(key)
      }
    })
  }

  /** tweb `:687-722` без сообществ (расхождение 3) */
  public updateDialog(dialog: Dialog) {
    if(!this.testDialogForFilter(dialog)) {
      if(this.getDialogElement(dialog.peerId)) {
        this.deleteDialog(dialog)
      }

      return
    }

    return super.updateDialog(dialog)
  }

  /** tweb `:770-809` (`useRafs` оригинал принимает, но не читает) */
  public toggleAvatarUnreadBadges(value: boolean) {
    if(!value) {
      this.sortedList.getAllDialogElementsMap().forEach((dialogElement) => {
        const { dom } = dialogElement
        if(!dom.unreadAvatarBadge) {
          return
        }

        dialogElement.toggleBadgeByKey('unreadAvatarBadge', false, false, false)
      })

      return
    }

    const reuseClassNames = ['unread', 'mention']
    this.sortedList.getAllDialogElementsMap().forEach((dialogElement) => {
      const { dom } = dialogElement
      const unreadContent = dom.unreadBadge?.textContent
      if(
        !unreadContent ||
        dom.unreadBadge!.classList.contains('backwards') ||
        dom.unreadBadge!.classList.contains('dialog-pinned-icon')
      ) {
        return
      }

      const isUnreadAvatarBadgeMounted = !!dom.unreadAvatarBadge
      dialogElement.createUnreadAvatarBadge()
      dialogElement.toggleBadgeByKey('unreadAvatarBadge', true, isUnreadAvatarBadgeMounted)
      dom.unreadAvatarBadge!.textContent = unreadContent
      const unreadAvatarBadgeClassList = dom.unreadAvatarBadge!.classList
      const unreadBadgeClassList = dom.unreadBadge!.classList
      reuseClassNames.forEach((className) => {
        unreadAvatarBadgeClassList.toggle(className, unreadBadgeClassList.contains(className))
      })
    })
  }

  public getDialogKeyFromElement(element: HTMLElement) {
    return +element.dataset.peerId!
  }

  /** tweb `:821-824` (`migratedTo` — миграции чатов у нас нет) */
  protected canUpdateDialog(dialog: Dialog): boolean {
    if(!this.testDialogForFilter(dialog)) return false
    return super.canUpdateDialog(dialog)
  }

  /** tweb `:825-834` */
  private async onHasArchiveDialogChanged(hasArchiveDialog: boolean) {
    if(!this.customPinnedDialog || !this.archiveDialogState) return

    if(hasArchiveDialog) {
      await this.sortedList.ensurePinned(this.customPinnedDialog)
    } else {
      this.sortedList.removePinned(this.customPinnedDialog)
    }
  }

  /** tweb `:848-853` */
  public destroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    super.destroy()
    this.archiveDialogState?.dispose()
  }
}
