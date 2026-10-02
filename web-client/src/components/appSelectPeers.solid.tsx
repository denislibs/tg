/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/appSelectPeers.tsx` (812502980) — селектор пиров:
 * поле поиска с чипами выбранных (`SelectorSearch`), список строк чатлиста с
 * чекбоксами, подгрузка страницами по прокрутке, скоуп по папке. Класс, как у
 * оригинала: Solid здесь только разметка секций (`wrapSolidComponent`).
 *
 *   div.selector.selector-{round|square}.selector-{right|left}
 *     div.scrollable.scrollable-y.selector-scrollable
 *       [градиент + секция поиска — `SelectorSearch`, если не `noSearch`]
 *       div.selector-height-container
 *         div.sidebar-left-section-container.is-visible[.selector-list-section-container]
 *           div.sidebar-left-section > hr + div.sidebar-left-section-content[.selector-list-section-content]
 *             ul.chatlist > a.row…chatlist-chat[.selector-row-with-checkbox][data-peer-id]
 *         [div.selector-empty-placeholder]
 *
 * Эталон — дампы `14-left-30*-new-group-members*.json` (квадратный, слева) и
 * `15-right-14-group-members.json` (круглый, справа). Строка —
 * `addDialogNew` (`lib/appDialogsManager.ts`), чип — `renderEntity`
 * (`components/selectorEntity.ts`), поле — `components/selectorSearch.solid.tsx`,
 * заглушка — `components/emptyPlaceholder.solid.tsx`. Ряд папок попапа
 * пересылки (`components/popups/pickUserFolderTabs.ts`) зовёт `setFolderId`
 * этого класса — своего ряда здесь нет, как и у оригинала.
 *
 * Объём порта — потребители волны 2D (план
 * `docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`, задача 16):
 * исключения приватности (`AppAddMembersTab`, `type: 'privacy'`), чаты папки
 * (`includedChats`: `peerType: ['dialogs']`, кнопки категорий `btn-primary` с
 * `data-peer-id` + `checkbox()`), чаты ссылки папки (`sharedFolder`: `noSearch`,
 * `peerType: []` + прямой `renderResultsFunc`, `sectionCaption`,
 * `processElementAfter`) и попап выбора пользователя (2C: `onSelect`,
 * `noInstantLoad`/`loadFirst`, `onFirstRender`, `checkForTriggers`,
 * `setFolderId`/`onSearchChange` ряда папок). С 0б-3 волны 7 — ещё свой
 * источник строк (`peerType: ['custom']` + `getMoreCustom`, :965-993): список
 * вступивших по ссылке (`sidebarRight/tabs/chatInviteLink.solid.tsx`, tweb
 * `chatInviteLink.tsx:212-229`). Ветки, у которых потребителя нет, не
 * портированы — список ниже, п. 14.
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Участники канала (`peerType: 'channelParticipants'`, :909-963) и всё, что
 *     на них держится, — `channelParticipantsFilter`/`…UpdateFilter`/
 *     `…UpdatePeerId`, карта `participants`, слушатели `chat_participant` и
 *     `chat_full_update` (:515-574), `deletePeerId` (:634-650) — не портированы:
 *     потребитель у оригинала — правая колонка (`participantsSelector.ts`,
 *     `chatInviteLink.tsx`), в волне 2D его нет, а наши экраны участников группы
 *     строят список `SortedUserList` (`components/sortedUserList.ts`).
 *  2. Права отправки: `chatRightsActions` + `filterByRights` (:782-787,
 *     :827-834, :878-883) портированы — сам фильтр живёт в
 *     `core/peers/filterByRights.ts` (его же зовёт React-`ForwardPicker`),
 *     карточка пира берётся у владельца (`peers.getPeers`, как в расхождении 9),
 *     а имена действий — наши (`send_messages` вместо `send_plain`, шапка
 *     модуля). НЕ портировано то, что из прав следует дальше (:321-365,
 *     :443-457): звёзды за сообщение (`starsAmountByPeer`,
 *     `onStarsAmountUpdate`, бейдж `dialog-stars-badge`) и замок премиума
 *     (`is-premium-locked`, тост `OnlyPremiumCanMessage`) — у нас нет ни
 *     `getRequirementToContact`, ни платы звёздами за личное сообщение (О-31).
 *  3. Монофорумы и бот-форумы (`excludeMonoforums`/`excludeBotforums`, :265-270)
 *     — предмета нет: таких чатов у нас не бывает. Истории на аватаре
 *     (`withStories`) — наша строка их не рисует (шапка строки `lib/appDialogsManager.ts`).
 *  4. `DialogsPlaceholder` (:137, :233-242 и вызовы `detach`) не заводится: у
 *     оригинала он создаётся, но нигде не вешается в DOM (`attach` не зовёт ни
 *     класс, ни потребители — поле приватное), так что `detach` — пустые вызовы.
 *     Вместе с ним — опции `noPlaceholder`/`placeholderSizes`/
 *     `placeholderElementsGap`/`night`.
 *  5. `placeholder` (:113, :188) принимается и, как у оригинала, не читается:
 *     поле поиска всегда `Search` (`selectorSearch.tsx:41-48`). Опция оставлена,
 *     потому что её передают потребители (`AppAddMembersTab`).
 *  6. `additionalDialogParams` (:94, :1157-1171) и `loadPromises` строки — нет:
 *     у нашей `DialogElement` нет `loadPromises`, а единственный потребитель
 *     параметров у оригинала — сообщества (`communities/`), которых нет.
 *  7. Курсор страницы диалогов — индекс из зеркала
 *     (`useChatsStore.dialogIndexById`), а не `getDialogIndex(dialog)` (:778):
 *     `dialogIndex()` на главном потоке не считается (`stores/noManualOrder.test.ts`),
 *     тот же приём, что у `useDialogListSource.ts`. Если зеркало индекс ещё не
 *     знает, выборка считается дочитанной — иначе следующая страница ушла бы с
 *     тем же курсором и дозапрос по `renderedPeerIds.size < pageCount` (:822)
 *     крутился бы вечно.
 *  8. Архив — `ARCHIVE_FOLDER_ID` (`core/folderIds.ts`, у нас −1), а не `1`
 *     (:812): у нас 1 — id первой пользовательской папки.
 *  9. Тип пира для `filterPeerTypeBy` (:277-301) спрашивается у владельца
 *     карточек (`managers.peers.getPeers`) и решается предикатами
 *     `core/peers/predicates.ts`, а не методами `appPeersManager`: реестра
 *     `IsPeerType`-методов у нас нет. Заведены `isAnyGroup`/`isUser` — их
 *     передаёт вкладка исключений приватности (`addMembers.tsx:79-80`).
 * 10. Поиск «не только контакты» (`searchContacts`, :858) — `channels.search`
 *     (роль `appUsersManager.searchContacts`, шапка `channelsManager.ts`), ответ
 *     несёт `Peer`, а не номер, — номер берётся `getPeerId`.
 * 11. `isNonContactUser` (:1139-1143) — по карточке владельца (`pFlags.contact`,
 *     `bot`, `deleted`), без `support` (флаг в карточке есть с задачи «особые
 *     чаты», но служебный аккаунт — не контакт и так).
 * 12. Подпись строки (`wrapSubtitle`, :1250-1261): чат — `getChatMembersString`
 *     строкой (`components/wrappers/getChatMembersString.ts`, у оригинала — узел
 *     `i18n`), пользователь — `getUserStatusString` (`core/presence.ts`, порт
 *     1:1: служебный аккаунт — «служебные уведомления», бот — «бот»).
 * 13. `checkbox(selected, color, label)` — без `color`: наш `CheckboxField`
 *     цвета не принимает, а `'secondary'` по умолчанию класса не ставит и у
 *     оригинала (`checkboxField.ts:48-49`).
 * 14. Без потребителя в волне (у оригинала их зовут попапы и вкладки вне 2D):
 *     режим `multiSelect: 'hidden'` с меню
 *     «SelectChat»/«Deselect» и `setMultiSelectMode` (:475-507, :1433-1436;
 *     пересылка), `setLimit` (:620-623; бусты, `pickCountry`, `showPickUsersPopup`),
 *     `getPeerIdFromKey` (`reassignBoost`), `prependPeerIds` (дни рождения),
 *     `removeBatch` (форумный селектор), `freezed` (у оригинала пишут его только
 *     закомментированные строки), `filterPeerTypeBy` функцией и методы
 *     `isBot`/`isRegularUser`/`isBroadcast` (`requestPeer` ботов,
 *     `convertPeerTypes` :606-618 — кнопок ботов у нас нет, О-32).
 * 15. `managers` — срез `AppSelectPeersManagers`, а не весь `AppManagers`, —
 *     тот же приём, что у `SortedUserList`/`AppSearchSuper`.
 */
import { createSignal, createRoot, createEffect, type Setter, type JSX } from 'solid-js'
import type { LangPackKey } from '@/lang'
import type { Managers } from '@/client/bootstrap'
import type { MaybePromise } from '@types'
import rootScope from '@lib/rootScope'
import { i18n } from '@lib/langPack'
import { wrapEmojiText } from '@lib/richtext'
import Scrollable from '@components/scrollable'
import CheckboxField from '@components/checkboxField'
import Section, { appendSectionContent, type SectionOptions, type SectionParts } from '@components/section.solid'
import SelectorSearch from '@components/selectorSearch.solid'
import InputSearch from '@components/inputSearch'
import emptyPlaceholder from '@components/emptyPlaceholder.solid'
import { addDialogNew, createChatList, type DialogElement, type DialogElementSize, type DialogRowManagers } from '@lib/appDialogsManager'
import type { SelectorEntityManagers } from '@components/selectorEntity'
import { ROW_SELECTION_CHECKBOX_CLASS, ROW_SELECTION_MEDIA_CLASS, ROW_WITH_CHECKBOX_AND_MEDIA_CLASS } from '@components/rowFieldClasses'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'
import labelControl from '@helpers/dom/labelControl'
import findUpAttribute from '@helpers/dom/findUpAttribute'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent, simulateClickEvent } from '@helpers/dom/clickEvent'
import windowSize from '@helpers/windowSize'
import filterUnique from '@helpers/array/filterUnique'
import { FocusDirection } from '@helpers/fastSmoothScroll'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import classNames from '@helpers/string/classNames'
import type { IconName } from '@core/tgico-icons'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import { getPeerId, isAnyChat, isPeerId, isUser } from '@core/peers/peerId'
import { isAnyGroup } from '@core/peers/predicates'
import { filterByRights } from '@core/peers/filterByRights'
import type { ChatRights } from '@core/peers/rights'
import { peerKey, type Chat, type User } from '@core/peers/peer'
import { getUserStatusString } from '@core/presence'
import { useChatsStore } from '@stores/chatsStore'
import { useI18nStore } from '@/i18n'

/** A row whose trailing checkbox is painted over it — the lane it takes is reserved in `_selector.scss`. */
const ROW_WITH_CHECKBOX_CLASS = 'selector-row-with-checkbox'

/** tweb `REAL_FOLDERS` (`appManagers/constants.ts`) — «Все чаты» и архив (расхождение 8). */
const REAL_FOLDERS = new Set([ALL_FOLDER_ID, ARCHIVE_FOLDER_ID])

export type SelectSearchPeerType = 'contacts' | 'dialogs' | 'custom'
/** tweb `IsPeerType` в заведённом объёме (расхождение 9). */
export type IsPeerType = 'isAnyGroup' | 'isUser'

export type AppSelectPeersManagers = DialogRowManagers & SelectorEntityManagers & {
  dialogs: Pick<Managers['dialogs'], 'getDialogs'>
  contacts: Pick<Managers['contacts'], 'getContactsPeerIds' | 'testSelfSearch'>
  channels: Pick<Managers['channels'], 'search'>
  peers: Pick<Managers['peers'], 'getPeers' | 'fillMirror'>
}

type Changes = { key: PeerId | string, add: boolean }[]

/** tweb `appPeersManager[method]` (расхождение 9) */
const isPeerType: { [k in IsPeerType]: (peerId: PeerId, peer: User | Chat | undefined) => boolean } = {
  isAnyGroup: (peerId, peer) => isAnyGroup(peerId, isUser(peerId) ? undefined : peer as Chat | undefined),
  isUser: (peerId) => isUser(peerId),
}

// TODO: правильная сортировка для addMembers, т.е. для peerType: 'contacts', потому что там идут сначала контакты - потом неконтакты, а должно всё сортироваться по имени

export default class AppSelectPeers {
  public container = document.createElement('div')
  public list = createChatList()
  protected oldList?: HTMLElement
  public scrollable!: Scrollable
  public selectorSearch?: SelectorSearch
  public inputSearch?: InputSearch
  public input?: HTMLInputElement

  public selected = new Set<PeerId | string>()
  private changes: Changes = []

  private folderId = ALL_FOLDER_ID
  private selectedFolderId?: number
  private offsetIndex = 0
  private promise?: Promise<unknown>

  private query = ''
  private cachedContacts?: PeerId[]

  private loadedWhat: Partial<{ [k in 'dialogs' | 'archived' | 'contacts' | 'custom']: boolean }> = {}

  private renderedPeerIds: Set<PeerId> = new Set()
  private pendingLists = new Set<HTMLElement>()

  private appendTo: HTMLElement
  private onChange?: (length: number, changes: Changes) => void
  public onSearchChange?: (query: string) => void
  private peerType: SelectSearchPeerType[] = ['dialogs']
  public renderResultsFunc: (peerIds: PeerId[], append?: boolean) => void | Promise<void>
  public multiSelect: 'enabled' | 'disabled' = 'enabled'
  private noSearch?: boolean
  private rippleEnabled = true
  private avatarSize: DialogElementSize = 'abitbigger'
  private exceptSelf: boolean
  private filterPeerTypeBy?: IsPeerType[]
  private chatRightsActions?: readonly ChatRights[]
  private meAsSaved: boolean
  private onSelect?: (peerId: PeerId | string, adding: boolean, e: MouseEvent) => MaybePromise<void | boolean>
  /** tweb :146 — свой источник строк (`peerType: ['custom']`): страница ключей и признак конца */
  public getMoreCustom?: (q: string, middleware: () => boolean) => Promise<{ result: PeerId[], isEnd: boolean }>

  private tempIds: { [k in keyof AppSelectPeers['loadedWhat']]?: number } = {}

  private selfPresence: LangPackKey = 'Presence.YourChat'

  private needSwitchList = false

  private sectionNameLangPackKey?: SectionOptions['name']
  private sectionCaption?: SectionOptions['caption']

  private getSubtitleForElement?: (
    peerId: PeerId,
  ) => HTMLElement | DocumentFragment | undefined | Promise<HTMLElement | DocumentFragment | undefined>
  private processElementAfter?: (peerId: PeerId, dialogElement: DialogElement) => void | Promise<void>

  private managers: AppSelectPeersManagers

  public middlewareHelper: MiddlewareHelper
  public middlewareHelperLoader: MiddlewareHelper

  private emptySearchPlaceholderMiddlewareHelper?: MiddlewareHelper
  private emptySearchPlaceholderQuerySetter?: Setter<string>
  private emptySearchPlaceholderHideSetter?: Setter<boolean>

  private design: 'round' | 'square' = 'round'
  public section: SectionParts

  private listenerSetter: ListenerSetter

  public searchSection?: SectionParts

  private checkboxSide: 'right' | 'left'

  private excludePeerIds: Set<PeerId>
  public heightContainer: HTMLElement

  public children: Array<HTMLElement>

  private loadedFirst?: boolean
  private onFirstRender?: () => void

  constructor(options: {
    appendTo: HTMLElement,
    managers: AppSelectPeersManagers,
    middleware: Middleware,
    onChange?: AppSelectPeers['onChange'],
    peerType?: SelectSearchPeerType[],
    onFirstRender?: () => void,
    renderResultsFunc?: AppSelectPeers['renderResultsFunc'],
    multiSelect?: AppSelectPeers['multiSelect'] | boolean,
    noSearch?: boolean,
    rippleEnabled?: boolean,
    avatarSize?: DialogElementSize,
    /** расхождение 5 */
    placeholder?: LangPackKey,
    selfPresence?: LangPackKey,
    exceptSelf?: boolean,
    filterPeerTypeBy?: IsPeerType[],
    /** расхождение 2 */
    chatRightsActions?: readonly ChatRights[],
    sectionNameLangPackKey?: SectionOptions['name'],
    sectionCaption?: SectionOptions['caption'],
    design?: 'round' | 'square',
    getSubtitleForElement?: AppSelectPeers['getSubtitleForElement'],
    processElementAfter?: AppSelectPeers['processElementAfter'],
    meAsSaved?: boolean,
    onSelect?: AppSelectPeers['onSelect'],
    getMoreCustom?: AppSelectPeers['getMoreCustom'],
    scrollable?: Scrollable,
    checkboxSide?: 'right' | 'left',
    excludePeerIds?: Set<PeerId>,
    noInstantLoad?: boolean
  }) {
    // :215 `safeAssign(this, options)` — по полям: `middleware`/`noInstantLoad`
    // на инстанс не ложатся (строгий tsconfig, тот же приём, что у `SortedUserList`)
    this.appendTo = options.appendTo
    this.managers = options.managers
    this.onChange = options.onChange
    if(options.peerType) this.peerType = options.peerType
    this.onFirstRender = options.onFirstRender
    this.noSearch = options.noSearch
    if(options.rippleEnabled !== undefined) this.rippleEnabled = options.rippleEnabled
    if(options.avatarSize) this.avatarSize = options.avatarSize
    if(options.selfPresence) this.selfPresence = options.selfPresence
    this.filterPeerTypeBy = options.filterPeerTypeBy
    this.chatRightsActions = options.chatRightsActions
    this.sectionNameLangPackKey = options.sectionNameLangPackKey
    this.sectionCaption = options.sectionCaption
    if(options.design) this.design = options.design
    this.getSubtitleForElement = options.getSubtitleForElement
    this.processElementAfter = options.processElementAfter
    this.onSelect = options.onSelect
    this.getMoreCustom = options.getMoreCustom
    if(options.scrollable) this.scrollable = options.scrollable

    // :217-219
    if(typeof(options.multiSelect) === 'boolean') {
      this.multiSelect = options.multiSelect ? 'enabled' : 'disabled'
    } else if(options.multiSelect) {
      this.multiSelect = options.multiSelect
    }

    // :221-230
    this.listenerSetter = new ListenerSetter()
    this.checkboxSide = options.checkboxSide ?? 'right'
    this.exceptSelf = options.exceptSelf ?? false
    this.meAsSaved = options.meAsSaved ?? true
    this.excludePeerIds = options.excludePeerIds ?? new Set()
    if(this.exceptSelf) this.excludePeerIds.add(rootScope.myId)
    this.children = []

    // :231-232
    this.middlewareHelper = options.middleware.create()
    this.middlewareHelperLoader = this.middlewareHelper.get().create()

    // :244-248
    this.container.classList.add(
      'selector',
      'selector-' + this.design,
      'selector-' + this.checkboxSide,
    )

    // :253-366 (без звёзд за сообщение и замка премиума по правам — расхождение 2)
    const f = (options.renderResultsFunc || this.renderResults).bind(this)
    this.renderResultsFunc = async(peerIds, append?: boolean) => {
      const middleware = this.middlewareHelperLoader.get()
      if(this.needSwitchList) {
        this.needSwitchList = false
      }

      peerIds = peerIds.filter((peerId) => {
        if(this.excludePeerIds.has(peerId)) {
          return false
        }

        const notRendered = !this.renderedPeerIds.has(peerId)
        if(notRendered) this.renderedPeerIds.add(peerId)
        return notRendered
      })

      if(this.filterPeerTypeBy) {
        peerIds = await this.filterByPeerType(peerIds, this.filterPeerTypeBy)

        if(!middleware()) {
          return
        }
      }

      await f(peerIds, append)
      if(!middleware()) {
        return
      }

      // Mount the new list only when we're not waiting on a search promise.
      // The search promise's then() handles the in-flight case. This branch
      // covers callers that invoke renderResultsFunc directly outside of any
      // pending search.
      if(this.oldList && !this.promise) {
        this.oldList.replaceWith(this.list)
        this.oldList = undefined
      }

      if(!this.promise) {
        this.processPlaceholderOnResults()
      }
    }

    // :368-396
    this.heightContainer = document.createElement('div')
    this.heightContainer.classList.add('selector-height-container')
    let content!: HTMLElement
    let title: HTMLElement | undefined
    const container = wrapSolidComponent(() => (
      <Section
        class={classNames(
          'is-visible',
          // it can't have full height then
          !this.sectionCaption && 'selector-list-section-container',
        )}
        name={this.sectionNameLangPackKey}
        caption={this.sectionCaption}
        contentProps={{ ref: (element) => content = element }}
        nameRef={(element) => title = element}
      />
    ), this.middlewareHelper.get())

    // with a title above it the list gets a content element of its own
    if(this.sectionNameLangPackKey) {
      content = appendSectionContent(container)
    }

    if(!this.sectionCaption) {
      content.classList.add('selector-list-section-content')
    }

    content.append(this.list)
    this.section = { container, content, title }
    this.heightContainer.append(container)

    // :398-405
    const hadScrollable = !!this.scrollable
    this.scrollable ||= new Scrollable()
    this.scrollable.container.classList.add('selector-scrollable')
    this.scrollable.container.tabIndex = 0

    this.container.append(this.scrollable.container)

    this.children.push(this.heightContainer)

    // :407-428
    if(!this.noSearch) {
      this.selectorSearch = new SelectorSearch({
        middlewareHelper: this.middlewareHelper,
        managers: this.managers,
        multiSelect: this.multiSelect !== 'disabled',
        onInput: () => this.onInput(),
        onChipClick: (key) => {
          const li = this.getElementByKey(key)
          if(!li) {
            this.remove(key)
          } else {
            simulateClickEvent(li)
          }
        },
      })
      this.searchSection = this.selectorSearch.section
      this.inputSearch = this.selectorSearch.inputSearch
      this.input = this.selectorSearch.input
      this.children.unshift(this.selectorSearch.gradient, this.selectorSearch.section.container)
    } else {
      this.scrollable.attachBorderListeners()
    }

    // :430-473 (без замка премиума — расхождение 2)
    attachClickEvent(this.container, async(e) => {
      const target = findUpAttribute(e.target!, 'data-peer-id') as HTMLElement | null

      if(
        !target ||
        (!target.classList.contains('row') && !target.classList.contains('btn-primary')) // * exception for 'includedChats' buttons
      ) return
      cancelEvent(e)

      const keyStr = target.dataset.peerId!
      const key: PeerId | string = isPeerId(keyStr) ? +keyStr : keyStr

      const adding = !this.selected.has(key)
      if(this.onSelect) {
        const result = await this.onSelect(key, adding, e)
        if(result === false) {
          return
        }
      }

      const result = adding ? this.add({ key }) : this.remove(key)
      if(!result) {
        return
      }

      this.toggleElementCheckboxByKey(key, adding)
    })

    // :509-511
    this.scrollable.onScrolledBottom = () => {
      void this.getMoreResults()
    }

    // :513
    this.appendTo.append(this.container)

    // :576-578
    options.middleware.onDestroy(() => {
      this.destroy()
    })

    // :580-582
    if(!options.noInstantLoad) {
      this.loadFirst()
    }

    // :584-586
    if(!hadScrollable) {
      this.scrollable.append(...this.children)
    }
  }

  // :589-604
  public loadFirst() {
    if(this.loadedFirst) {
      return
    }

    this.loadedFirst = true
    // WARNING TIMEOUT
    setTimeout(() => {
      const getResultsPromise = this.getMoreResults()
      if(this.onFirstRender) {
        void getResultsPromise.then(() => {
          this.onFirstRender!()
        })
      }
    }, 0)
  }

  // :625-632 (без `dialogsPlaceholder` — расхождение 4)
  public destroy() {
    this.middlewareHelper.destroy()
    this.emptySearchPlaceholderMiddlewareHelper?.destroy()
    this.listenerSetter.removeAll()
    this.selectorSearch?.destroy()
    this.inputSearch?.remove()
  }

  /** :277-301 — отбор по типу пира (расхождение 9) */
  private async filterByPeerType(peerIds: PeerId[], filterPeerTypeBy: IsPeerType[]) {
    if(!peerIds.length) {
      return peerIds
    }

    const peers = await this.managers.peers.getPeers(peerIds)
    const byId = new Map(peers.map((peer) => [peerKey(peer), peer]))
    return peerIds.filter((peerId) => {
      const peer = byId.get(peerId)
      return filterPeerTypeBy.some((method) => isPeerType[method](peerId, peer))
    })
  }

  // :652-654
  private _setFolderId(value: string) {
    this.folderId = (value ? ALL_FOLDER_ID : this.selectedFolderId) ?? ALL_FOLDER_ID
  }

  // :656-718
  private onInput = () => {
    const value = this.inputSearch!.value
    if(this.query === value) {
      return
    }

    if(this.peerType.includes('contacts') || this.peerType.includes('dialogs')) {
      this.cachedContacts = undefined
    }

    if(this.peerType.includes('dialogs')) {
      this._setFolderId(value)
      this.offsetIndex = 0
    }

    for(const i in this.tempIds) {
      ++this.tempIds[i as keyof AppSelectPeers['tempIds']]!
    }

    // Keep the currently mounted list reference until the new search resolves.
    // ??= so that rapid re-typing doesn't overwrite the in-DOM list with a
    // detached one from a still-pending previous search.
    this.oldList ??= this.list
    this.list = createChatList()

    this.promise = undefined
    this.query = value
    this.onSearchChange?.(value)
    this.renderedPeerIds.clear()
    this.needSwitchList = true
    this.middlewareHelperLoader.clean()

    this.loadedWhat = {}
    if(this.peerType.includes('dialogs')) {
      this.loadedWhat.dialogs = false
      this.loadedWhat.archived = false
      this.loadedWhat.contacts = false
    }

    if(this.peerType.includes('contacts')) {
      this.loadedWhat.contacts = false
    }

    if(this.peerType.includes('custom')) {
      this.loadedWhat.custom = false
    }

    // Only force the section open (hiding the empty placeholder) when there's
    // actually previous content to show during the new search. If the previous
    // search was empty, leave the placeholder visible — its query text is
    // updated by processPlaceholderOnResults once the new search resolves.
    if(this.oldList?.childElementCount) {
      this.emptySearchPlaceholderHideSetter?.(true)
    }

    void this.getMoreResults()
  }

  // :720-723
  public clearInput() {
    this.inputSearch!.value = ''
    this.onInput()
  }

  // :725-735
  private async renderSaved() {
    if(
      !this.exceptSelf &&
      !this.offsetIndex &&
      this.folderId === ALL_FOLDER_ID &&
      this.peerType.includes('dialogs') &&
      (!this.query || await this.managers.contacts.testSelfSearch(this.query))
    ) {
      await this.renderResultsFunc([rootScope.myId])
    }
  }

  // :737-744
  private getTempId(type: keyof AppSelectPeers['tempIds']) {
    this.tempIds[type] ??= 0
    const tempId = ++this.tempIds[type]!
    return {
      tempId,
      middleware: () => this.tempIds[type] === tempId,
    }
  }

  // :746-825
  private async getMoreDialogs(): Promise<unknown> {
    if(this.loadedWhat.dialogs && this.loadedWhat.archived) {
      return
    }

    // в десктопе - сначала без группы, потом архивные, потом контакты без сообщений
    const pageCount = windowSize.height / 56 * 1.25 | 0

    const { middleware } = this.getTempId('dialogs')
    const promise = this.managers.dialogs.getDialogs({
      query: this.query,
      offsetIndex: this.offsetIndex,
      limit: pageCount,
      filterId: this.folderId,
    })

    promise.catch(() => {
      if(!middleware()) {
        return
      }

      this.loadedWhat[this.loadedWhat.dialogs ? 'archived' : 'dialogs'] = true
    })

    const value = await promise
    if(!middleware()) {
      return
    }

    let dialogs = value.dialogs
    let cursorMoved = true
    if(dialogs.length) {
      // Расхождение 7 — курсор из зеркала.
      const newOffsetIndex = useChatsStore.getState().dialogIndexById[dialogs[dialogs.length - 1].peerId] || 0
      cursorMoved = !!newOffsetIndex && newOffsetIndex !== this.offsetIndex

      // :782-787
      if(this.chatRightsActions) {
        dialogs = await this.filterByRights(dialogs)
        if(!middleware()) {
          return
        }
      }

      await this.renderSaved()
      if(!middleware()) {
        return
      }

      this.offsetIndex = newOffsetIndex
    }

    await this.renderResultsFunc(dialogs.map((dialog) => dialog.peerId))

    if(value.isEnd || !cursorMoved) {
      if(!this.loadedWhat.dialogs) {
        await this.renderSaved()
        if(!middleware()) {
          return
        }

        this.loadedWhat.dialogs = true

        if(this.selectedFolderId !== undefined) {
          this.loadedWhat.archived = true
        } else {
          this.offsetIndex = 0
          this.folderId = ARCHIVE_FOLDER_ID
          return this.getMoreDialogs()
        }
      } else {
        this.loadedWhat.archived = true
      }

      if(this.canLoadContacts()) {
        return this.getMoreContacts()
      }
    } else if(this.renderedPeerIds.size < pageCount) {
      return this.getMoreDialogs()
    }
  }

  /** :827-834 — пачкой: карточки спрашиваются у владельца одним вызовом (расхождение 2). */
  private async filterByRights<T extends { peerId: PeerId }>(items: T[]): Promise<T[]> {
    const peers = await this.managers.peers.getPeers(items.map(({ peerId }) => peerId))
    const byId = new Map(peers.map((peer) => [peerKey(peer), peer]))
    return items.filter(({ peerId }) => filterByRights(peerId, byId.get(peerId), this.chatRightsActions!))
  }

  // :836-838
  private canLoadContacts() {
    return !(this.loadedWhat.contacts || !REAL_FOLDERS.has(this.folderId))
  }

  // :840-907
  private async getMoreContacts() {
    if(!this.canLoadContacts()) {
      return
    }

    const isGlobalSearch = this.peerType.includes('contacts')

    if(!this.cachedContacts) {
      const { middleware } = this.getTempId('contacts')
      const promise = Promise.all([
        isGlobalSearch ? this.managers.contacts.getContactsPeerIds(this.query) : [] as PeerId[],
        this.query ? this.managers.channels.search(this.query) : undefined,
      ])

      promise.catch(() => {
        if(!middleware()) {
          return
        }

        this.loadedWhat.contacts = true
      })

      const [cachedContacts, searchResult] = await promise
      if(!middleware()) {
        return
      }

      if(searchResult) {
        // do not add global result if only dialogs needed
        let resultPeerIds = (isGlobalSearch ?
          searchResult.my_results.concat(searchResult.results) :
          searchResult.my_results).map((peer) => getPeerId(peer))

        // :878-883
        if(this.chatRightsActions) {
          resultPeerIds = (await this.filterByRights(resultPeerIds.map((peerId) => ({ peerId })))).map(({ peerId }) => peerId)
          if(!middleware()) {
            return
          }
        }

        if(!this.peerType.includes('dialogs')) {
          resultPeerIds = resultPeerIds.filter((peerId) => isUser(peerId))
        }

        this.cachedContacts = filterUnique(cachedContacts.concat(resultPeerIds))
      } else this.cachedContacts = cachedContacts.slice()
    }

    const pageCount = windowSize.height / 56 * 1.25 | 0
    const arr = this.cachedContacts.splice(0, pageCount)
    await this.renderResultsFunc(arr)

    if(!this.cachedContacts.length) {
      this.loadedWhat.contacts = true
    }
  }

  // :995-997
  public checkForTriggers = () => {
    this.scrollable.checkForTriggers()
  }

  // :965-993 — страница своего источника (`getMoreCustom`); конец — по `isEnd`
  private async _getMoreCustom() {
    if(this.loadedWhat.custom) {
      return
    }

    const { middleware } = this.getTempId('custom')
    const promise = this.getMoreCustom!(this.query, middleware)

    promise.catch(() => {
      if(!middleware()) {
        return
      }

      this.loadedWhat.custom = true
    })

    const res = await promise
    if(!middleware()) {
      return
    }

    const { result, isEnd } = res

    await this.renderResultsFunc(result)

    if(isEnd) {
      this.loadedWhat.custom = true
    }
  }
  // :999-1021 (без участников канала и `custom` — расхождения 1, 14)
  private _getMoreResults(): Promise<unknown> | undefined {
    if(this.peerType.includes('dialogs') && !this.loadedWhat.archived) { // to load non-contacts
      return this.getMoreSomething('dialogs')
    }

    if((this.peerType.includes('contacts') || this.peerType.includes('dialogs')) && !this.loadedWhat.contacts && this.canLoadContacts()) {
      return this.getMoreSomething('contacts')
    }

    if(this.peerType.includes('custom') && !this.loadedWhat.custom) {
      return this.getMoreSomething('custom')
    }
  }

  // :1023-1074 (без `dialogsPlaceholder.detach` — расхождение 4)
  private processPlaceholderOnResults = () => {
    const length = this.list.childElementCount
    if(!length) {
      if(!this.emptySearchPlaceholderMiddlewareHelper) {
        this.emptySearchPlaceholderMiddlewareHelper = getMiddleware()
        const middleware = this.emptySearchPlaceholderMiddlewareHelper.get()

        createRoot((dispose) => {
          const [query, setQuery] = createSignal(this.query)
          const [description, setDescription] = createSignal<JSX.Element>()
          const [hide, setHide] = createSignal(false)
          this.emptySearchPlaceholderQuerySetter = setQuery
          this.emptySearchPlaceholderHideSetter = setHide
          middleware.onClean(dispose)
          createEffect(() => {
            const query$ = query()
            setDescription(
              query$.trim() ?
                i18n('RequestJoin.List.SearchEmpty', [wrapEmojiText(query$)]) :
                i18n('Search.EmptyQuery'),
            )
          })

          createEffect(() => {
            this.section.container.classList.toggle('is-visible', hide())
          })

          void emptyPlaceholder({
            middleware,
            title: () => i18n('SearchEmptyViewTitle'),
            description,
            hide,
          }).then((container) => {
            if(!middleware() || !container) {
              return
            }

            this.heightContainer.append(container)
          })
        })
        return
      } else {
        this.emptySearchPlaceholderHideSetter!(false)
        this.emptySearchPlaceholderQuerySetter!(this.query)
      }
    } else {
      this.emptySearchPlaceholderHideSetter?.(true)
      this.emptySearchPlaceholderQuerySetter?.(this.query)
    }
  }

  // :1076-1120
  private getMoreResults(): Promise<unknown> {
    if(this.promise) {
      return this.promise
    }

    const loadPromise = this._getMoreResults()
    if(!loadPromise) {
      this.processPlaceholderOnResults()
      return Promise.resolve()
    }

    const middleware = this.middlewareHelperLoader.get()
    const promise: Promise<unknown> = this.promise = loadPromise.catch((err) => {
      console.error('get more result error', err)
    }).then(() => {
      if(this.promise === promise) {
        this.promise = undefined
      }

      if(middleware()) {
        // Search is done — swap the previous list out for the freshly built one.
        if(this.oldList) {
          this.oldList.replaceWith(this.list)
          this.oldList = undefined
        }

        const loadedWhatValues = Object.values(this.loadedWhat)
        const loadedAll = loadedWhatValues.every((v) => v)

        const length = this.list.childElementCount
        if(loadedAll && !length) {
          return this.processPlaceholderOnResults()
        } else if(length || loadedAll) {
          this.emptySearchPlaceholderHideSetter?.(true)
        }
      }

      this.checkForTriggers() // set new promise
      return this.promise
    })

    return promise
  }

  // :1122-1132 (стрелками вместо `map[peerType].call(this)` — `unbound-method` линтера)
  private getMoreSomething(peerType: SelectSearchPeerType) {
    const map: { [type in SelectSearchPeerType]: () => Promise<unknown> } = {
      dialogs: () => this.getMoreDialogs(),
      contacts: () => this.getMoreContacts(),
      custom: () => this._getMoreCustom(),
    }

    const promise = map[peerType]()
    return promise
  }

  // :1134-1248 (без `loadPromises`/`additionalDialogParams`/`getPeerIdFromKey` — расхождения 6, 14)
  private async renderResults(peerIds: PeerId[], append?: boolean) {
    const middleware = this.middlewareHelperLoader.get()
    const list = this.list

    // оставим только неконтакты с диалогов
    if(!this.peerType.includes('dialogs') && this.loadedWhat.contacts) {
      peerIds = await this.filterNonContactUsers(peerIds)
    }

    if(!middleware()) {
      return
    }

    // Keep the whole batch detached until titles, avatars and subtitles are ready.
    const container = document.createElement('div')
    this.pendingLists.add(container)
    // Concurrent participant updates must keep their insertion order, not their load order.
    const position = document.createComment('')
    list[append === false ? 'prepend' : 'append'](position)
    const checkboxes: { key: PeerId, input: HTMLInputElement }[] = []
    const promises = peerIds.map(async(key) => {
      const dialogElement = addDialogNew({
        peerId: key,
        rippleEnabled: this.rippleEnabled,
        avatarSize: this.avatarSize,
        meAsSaved: this.meAsSaved,
        append,
        wrapOptions: {
          middleware,
        },
        container,
        managers: this.managers,
      })
      const rowMiddleware = dialogElement.middlewareHelper!.get()

      const { dom } = dialogElement

      if(this.design === 'square') {
        dom.containerEl.classList.add(ROW_WITH_CHECKBOX_AND_MEDIA_CLASS)
        dialogElement.media?.classList.add(ROW_SELECTION_MEDIA_CLASS)
      }

      if(this.multiSelect !== 'disabled') {
        const selected = this.selected.has(key)
        const checkbox = this.checkbox(selected, dom.titleSpan)
        if(this.design === 'square') {
          checkbox.classList.add(ROW_SELECTION_CHECKBOX_CLASS)
        }
        checkboxes.push({ key, input: checkbox.querySelector('input')! })
        if(this.checkboxSide === 'right') {
          // the checkbox is positioned over the row, so the row itself reserves its lane
          dom.containerEl.classList.add(ROW_WITH_CHECKBOX_CLASS)
          dom.containerEl.append(checkbox)
        } else {
          dom.containerEl.prepend(checkbox)
        }
      }

      const prepare = async() => {
        let subtitleEl: HTMLElement | DocumentFragment | string | undefined
        if(this.getSubtitleForElement) {
          subtitleEl = await this.getSubtitleForElement(key)
        }

        if(!middleware() || !rowMiddleware()) {
          return
        }

        if(!subtitleEl) {
          subtitleEl = await this.wrapSubtitle(key)
        }

        if(!middleware() || !rowMiddleware()) {
          return
        }

        dom.lastMessageSpan.append(subtitleEl)

        if(this.processElementAfter) {
          await this.processElementAfter(key, dialogElement)
        }
      }

      return Promise.race([
        prepare(),
        new Promise<void>((resolve) => rowMiddleware.onClean(resolve)),
      ])
    })

    try {
      await Promise.all(promises)
      if(!middleware()) {
        return
      }

      for(const { key, input } of checkboxes) {
        input.checked = this.selected.has(key)
      }

      position.replaceWith(...container.children)
    } finally {
      position.remove()
      this.pendingLists.delete(container)
    }
  }

  /** :1139-1143 — `appUsersManager.isNonContactUser` (расхождение 11) */
  private async filterNonContactUsers(peerIds: PeerId[]) {
    const peers = await this.managers.peers.getPeers(peerIds.filter((peerId) => isUser(peerId)))
    const nonContacts = new Set(peers.filter((peer) => {
      return peer._ === 'user' && !peer.pFlags?.bot && !peer.pFlags?.deleted && !peer.pFlags?.contact && peer.id !== rootScope.myId
    }).map((peer) => peerKey(peer)))
    return peerIds.filter((peerId) => nonContacts.has(peerId))
  }

  // :1250-1261 (расхождение 12)
  public async wrapSubtitle(peerId: PeerId): Promise<HTMLElement | string> {
    if(isAnyChat(peerId)) {
      const [chat] = await this.managers.peers.getPeers([peerId])
      return getChatMembersString(chat as Chat | undefined, useI18nStore.getState().tArgs)
    } else if(peerId === rootScope.myId) {
      return i18n(this.selfPresence)
    } else {
      const [user] = await this.managers.peers.getPeers([peerId])
      return getUserStatusString(user?._ === 'user' ? user : undefined)
    }
  }

  // :1263-1279 (без `color` — расхождение 13)
  public checkbox(
    selected?: boolean,
    label?: HTMLElement | string,
  ) {
    const checkboxField = new CheckboxField({
      round: this.design === 'round',
    })
    if(selected) {
      checkboxField.input.checked = selected
    }
    if(typeof(label) === 'string') checkboxField.input.setAttribute('aria-label', label)
    else labelControl(checkboxField.input, label)

    return checkboxField.label
  }

  // :1283-1328 (без `limit` — расхождение 14)
  public add({
    key,
    title,
    scroll = true,
    fireOnChange = true,
    fallbackIcon,
  }: {
    key: PeerId | string,
    title?: string | HTMLElement,
    scroll?: boolean,
    fireOnChange?: boolean,
    fallbackIcon?: IconName
  }): boolean | ReturnType<SelectorSearch['addChip']> {
    const added = !this.selected.has(key)
    this.selected.add(key)
    if(added) {
      this.changes.push({ key, add: true })
    }

    if(this.multiSelect !== 'enabled' || !this.input) {
      if(fireOnChange) this.dispatchOnChange()
      return this.multiSelect !== 'disabled'
    }

    if(this.query.trim()) {
      this.clearInput()
    }

    const rendered = this.selectorSearch!.addChip({
      key,
      middleware: this.middlewareHelper.get(),
      title,
      scroll,
      fallbackIcon,
      primary: true,
    })
    if(fireOnChange) this.dispatchOnChange()

    return rendered
  }

  // :1330-1350
  public remove(key: PeerId | string, fireOnChange = true): boolean {
    if(this.multiSelect !== 'enabled') {
      return false
    }

    const onRemoved = () => {
      const removed = this.selected.delete(key)
      if(removed) {
        this.changes.push({ key, add: false })
      }
      if(fireOnChange) this.dispatchOnChange()
    }

    onRemoved()

    if(this.selectorSearch) {
      this.selectorSearch.removeChip(key)
    }

    return true
  }

  // :1352-1354
  public getSelected() {
    return [...this.selected]
  }

  // :1356-1358
  public getElementByKey(key: PeerId | string) {
    return this.container.querySelector<HTMLElement>(`.row[data-peer-id="${key}"]`)
  }

  // :1360-1364
  public toggleElementCheckboxByKey(key: PeerId | string, checked?: boolean) {
    const checkboxes = this.findCheckboxes(key)
    checkboxes.forEach((checkbox) => checkbox.checked = checked ?? !checkbox.checked)
  }

  // :1366-1381
  public addBatch(values: (PeerId | string)[]) {
    if(!values.length) {
      return
    }

    values.forEach((value) => {
      this.add({
        key: value,
        scroll: false,
        fireOnChange: false,
      })
      this.toggleElementCheckboxByKey(value, true)
    })

    this.dispatchOnChange()
  }

  // :1398-1407 (без возврата в режим `hidden` — расхождение 14)
  private dispatchOnChange() {
    const changes = this.changes
    this.changes = []
    this.onChange?.(this.selected.size, changes)
  }

  // :1409-1419
  private findCheckboxes(key: PeerId | string): HTMLInputElement[] {
    return [...this.container.querySelectorAll<HTMLInputElement>(`[data-peer-id="${key}"] input`)]
  }

  // :1421-1431
  public addInitial(values: (PeerId | string)[] | undefined) {
    if(!values?.length) {
      return
    }

    this.addBatch(values)

    if(this.selectorSearch) window.requestAnimationFrame(() => { // ! not the best place for this raf though it works
      this.selectorSearch!.scrollToInput(FocusDirection.Static)
    })
  }

  // :1438-1452
  public setFolderId(folderId: number) {
    const willBeFolderId = folderId || undefined
    if(this.selectedFolderId === willBeFolderId) {
      return
    }

    this.selectedFolderId = willBeFolderId
    if(!this.loadedFirst) {
      this._setFolderId('')
      return
    }

    this.query = '\x01' // force onInput to detect a change
    this.onInput()
  }
}
