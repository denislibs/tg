/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/editFolder.tsx:1-733` и
 * `editFolderInput/index.tsx:1-44` (812502980) — редактор папки
 * (`AppEditFolderTab`, `solidJsTabs/tabs.ts`). Задача 24 плана волны 2D
 * (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`), дамп
 * `14-left-18b-folder-edit`.
 *
 *   header: … + button.btn-icon.btn-confirm.blue(check)[.hide] + ⋮ (FilterMenuDelete)  (:274-300)
 *   div.sticker-container (Folders_2) + div.caption «FilterIncludeExcludeInfo»          (:264-270)
 *   Section[caption EditFolder.EmojiAsIconTip при tabsInSidebar] > поле имени (12)      (:302-323)
 *   Section.folder-list.folder-list-included «FilterInclude» (+ caption, noDelimiter)   (:387)
 *     -content.folder-categories > button.folder-category-button ×6 (Add Chats + типы)
 *     [-content > ul.chatlist (до 4 чатов)] [-content > button.load-more «Show N More»]
 *   Section.folder-list.folder-list-excluded «FilterExclude» (Remove Chats + Muted, Read) (:406)
 *   Section.folder-list.folder-list-links «InviteLinks» (Create a New Link + строки ссылок) (:408-412)
 *
 * Открывают вкладку «Новая папка» и строки списка «Папки» (`chatFolders.solid.tsx`),
 * пункт «Edit folder» меню папки (`helpers/dom/createFolderContextMenu.ts`).
 *
 * Расхождения с оригиналом:
 *  1. Папка — наша `Folder` (`core/managers/foldersManager.ts`): флаги плоскими
 *     полями (соответствие имён tweb — `FOLDER_PFLAGS`, `editFolderShared.ts`),
 *     списки — `includeChats`/`excludeChats` (ключи пиров), без `pinned_peers`/
 *     `include_peers`-входных пиров и `updatedTime`/`localId`; сравнение на
 *     изменения — `deepEqual` папок целиком (`:66-75`). Типа
 *     `dialogFilterChatlist` нет — секция исключённых не прячется
 *     (`toggleExcludedPeers`, `:77-79`).
 *  2. (О-21) Кнопки «Archived» (`exclude_archived`, `:397-401`) нет: флага нет
 *     ни в модели, ни на проводе (`domain/folder.go`). Закреплённых в папке
 *     (`pinned_peers`, `reloadMissingPeerIds` `:509-513`) нет тоже.
 *  3. Поле имени — `InputFieldTsx` (contenteditable `InputField`) без
 *     `InputFieldEmoji` и `defineSolidElement` (`editFolderInput/index.tsx`):
 *     rich-путь поля не портирован (О-28), а название на проводе — строка без
 *     сущностей (`Folder.title`), поэтому `getRichValueWithCaret`/
 *     `trimRichText` → `value.trim()`. Лимит 12 — тот же (`MAX_FOLDER_NAME_LENGTH`
 *     = `domain.MaxFolderNameLength`).
 *  4. (О-22) Лимиты не проверяются на клиенте: бэкенд не отдаёт `folders`/
 *     `folderPeers`/`chatlistInvites` (`getLimit`, `:515-517`, `:563-564`,
 *     `:635-638`), а `PopupLimit` — волна 2C. Отказ сервера по числу папок
 *     (`ErrTooMany`, текст `folders limit reached` — у tweb
 *     `DIALOG_FILTERS_TOO_MUCH`, `:480-481`) показывается уже существующим
 *     тостом с ключом tweb `LimitReached` вместо `showLimitPopup('folders')`.
 *  5. Сохранение: `managers.folders.create/update` + `foldersStore.upsert` вместо
 *     `filtersStorage.createDialogFilter/updateDialogFilter` (`:456-465`);
 *     `filter_update` (`:499-507`) — подписка на `appState.folders` (папку
 *     поменяли в другой вкладке/пушем — перечитывается, как у оригинала).
 *  6. Ссылки: `managers.folders.listInvites/createInvite/revokeInvite` вместо
 *     `getExportedInvites`/`exportChatlistInvite`/`deleteExportedInvite`. У нашей
 *     ссылки путь относительный (`/addlist/<slug>`) — строка показывает его
 *     с хостом, копируется полный адрес. Вкладки «Share Folder»
 *     (`AppSharedFolderTab`, `openChatlistInvite`, `:702-724`) нет — это задача 25
 *     плана, и выбор чатов ссылки заблокирован бэкендом (О-23): клик по строке
 *     ссылки ничего не открывает, созданная ссылка сразу встаёт строкой
 *     (`wrapLink` без `openChatlistInvite`), а отказ «нечем делиться» (наш
 *     `ErrNoShareable`, у tweb `PEERS_LIST_EMPTY` → `openChatlistInvite()`) —
 *     тостом нашего ключа `Folder.Share.Empty` до задачи 25.
 *  7. `toggleDisability` (`:662`) снят у нас задачей 9 — кнопка выключается
 *     атрибутом `disabled`, как его и ставит `toggleDisability`.
 *  8. Флаг `deleting` (`:275-290`) у tweb никогда не взводится — защита от
 *     двойного удаления мертва; здесь взводится. Отказ в подтверждении гасится
 *     (у tweb — необработанное отклонение).
 *  9. `aria-label` кнопок шапки ставится атрибутом: у нашего `ButtonIcon` нет
 *     опции `ariaLabel` (шапка `components/buttonCorner.ts`).
 * 10. Заставка — как в `chatFolders.solid.tsx`, расхождение 8.
 * 11. Строки чатов — наш `dialogRow.ts::addDialogNew` с `managers`; фильтр
 *     «пиры, из которых нас выгнали» (`:127-129`) — по зеркалу диалогов:
 *     пользователь остаётся всегда (удалённых карточек `userEmpty` у нас нет).
 */
import { onCleanup } from 'solid-js'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import { renderStaticAssetFallback } from '@lib/lottie/lottieAssetFallback'
import { toastNew } from '@components/toast'
import InputField from '@components/inputField'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import ButtonIcon from '@components/buttonIcon'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import type { ButtonMenuItemOptions } from '@components/buttonMenu'
import Button from '@components/button'
import Icon from '@components/icon'
import Section, { appendSectionContent } from '@components/section.solid'
import RowTsx from '@components/rowTsx.solid'
import { addDialogNew, createChatList } from '@components/dialogRow'
import type SidebarSlider from '@components/slider'
import { AppIncludedChatsTab, type AppEditFolderTab } from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import { deleteFolder, FOLDER_PFLAGS, type FolderPFlag } from '@components/sidebarLeft/tabs/editFolderShared'
import copy from '@helpers/object/copy'
import deepEqual from '@helpers/object/deepEqual'
import filterAsync from '@helpers/array/filterAsync'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import createContextMenu from '@helpers/dom/createContextMenu'
import findUpClassName from '@helpers/dom/findUpClassName'
import { copyTextToClipboard } from '@helpers/clipboard'
import { unwrapSolidElement, mountSolidComponent } from '@helpers/solid/wrapSolidComponent'
import noop from '@helpers/noop'
import { HttpError } from '@core/net/restClient'
import { isUser } from '@core/peers/peerId'
import type { Folder, FolderInvite } from '@core/managers/foldersManager'
import type { IconName } from '@core/tgico-icons'
import { useAppSettings } from '@stores/appSettings.solid'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersStore } from '@stores/foldersStore'

type EditFolderButton = {
  icon: IconName
  name?: FolderPFlag
  withRipple?: true
  text: LangPackKey
}

type EditFolderFlags = { [k in FolderPFlag]?: HTMLElement }

/** tweb `editFolderInput/index.tsx:11` = `domain.MaxFolderNameLength` */
const MAX_FOLDER_NAME_LENGTH = 12

/** Отказ сервера «папок слишком много» (`usecase/folders.ErrTooMany`). */
const FOLDERS_TOO_MUCH = 'folders limit reached'
/** Отказ «нечем делиться» (`usecase/folders.ErrNoShareable`). */
const NO_SHAREABLE = 'folder has no shareable public group/channel chats'

const hasFlag = (filter: Folder, flag: FolderPFlag) => !!filter[FOLDER_PFLAGS[flag]]

const inviteUrl = (invite: FolderInvite) => location.origin + invite.url

const EditFolder = () => {
  const [tab] = useSuperTab<typeof AppEditFolderTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!
  const p = tab.payload

  const flags: EditFolderFlags = {}
  let animation: LottiePlayer | undefined
  let filter!: Folder
  let originalFilter!: Folder
  let type!: 'edit' | 'create'
  let tempId = 0
  let showMoreClicked: { [key in 'includeChats' | 'excludeChats']?: boolean } = {}
  let nameInputField!: InputField

  const editCheckForChange = () => {
    if(type === 'edit') {
      const changed = !deepEqual(originalFilter, filter)
      confirmBtn.classList.toggle('hide', !changed)
      menuBtn.classList.toggle('hide', changed)
    }
  }

  const onCreateOpen = () => {
    tab.title.replaceChildren(i18n('FilterNew'))
    menuBtn.classList.add('hide')
    confirmBtn.classList.remove('hide')

    for(const flag in flags) {
      flags[flag as FolderPFlag]!.style.display = 'none'
    }
  }

  const onEditOpen = () => {
    const _tempId = ++tempId
    tab.title.replaceChildren(i18n(type === 'create' ? 'FilterNew' : 'FilterHeaderEdit'))

    if(type === 'edit') {
      menuBtn.classList.remove('hide')
      confirmBtn.classList.add('hide')
    }

    const _filter = filter

    nameInputField.value = _filter.title

    for(const flag in flags) {
      const good = hasFlag(_filter, flag as FolderPFlag)
      flags[flag as FolderPFlag]!.style.display = good ? '' : 'none'
    }

    const promises = (['includeChats', 'excludeChats'] as const).map(async(key) => {
      let peers = _filter[key]
      if(!peers) {
        return
      }

      const section = key === 'includeChats' ? includePeerIds : excludePeerIds
      const ul = createChatList()

      // filter peers where we're kicked (расхождение 11)
      const hasPeer = (peerId: PeerId) => {
        return isUser(peerId) || useChatsStore.getState().dialogs.some((dialog) => dialog.peerId === peerId)
      }

      const filtered = peers.filter((peerId) => hasPeer(peerId))
      peers.length = 0
      peers.push(...filtered)

      peers = peers.slice()

      const renderMore = async(_length: number) => {
        const peerIds = peers.splice(0, _length)
        const filtered = await filterAsync(peerIds, (peerId) => hasPeer(peerId))

        if(_tempId !== tempId) return

        const containers = filtered.map((peerId) => {
          const dialogElement = addDialogNew({
            peerId,
            rippleEnabled: false,
            meAsSaved: true,
            avatarSize: 'small',
            autonomous: true,
            container: false,
            wrapOptions: {
              middleware: tab.middlewareHelper.get(),
            },
            managers,
          })
          const { dom } = dialogElement
          dom.lastMessageSpan.parentElement!.remove()
          return dom.containerEl
        })

        if(_tempId !== tempId) return
        ul.append(...containers)

        if(showMore) {
          if(peers.length) {
            showMore.lastElementChild!.replaceWith(i18n('FilterShowMoreChats', [peers.length]))
            showMore.classList.remove('hide')
          } else {
            showMore.remove()
          }
        }
      }

      let showMore: HTMLElement | undefined
      if(peers.length && !showMoreClicked[key]) {
        showMore = Button('folder-category-button btn btn-primary btn-transparent hide', { icon: 'down' })
        showMore.classList.add('load-more', 'rp-overflow')
        attachClickEvent(showMore, () => {
          showMoreClicked[key] = true
          void renderMore(Infinity)
        }, { listenerSetter: tab.listenerSetter })
        showMore.append(i18n('FilterShowMoreChats', [peers.length]))
      }

      return renderMore(showMoreClicked[key] ? Infinity : 4).then(() => {
        if(_tempId !== tempId) return

        return () => {
          appendSectionContent(section).append(ul)

          if(showMore && peers.length) {
            const content = appendSectionContent(section)
            content.append(showMore)
          }
        }
      })
    })

    return Promise.all(promises).then((callbacks) => {
      if(_tempId !== tempId) return

      if(tab.container) {
        // cleanup
        Array.from(tab.container.querySelectorAll('.chatlist, .load-more')).forEach((el) => el.parentElement!.remove())
      }

      callbacks.forEach((callback) => callback?.())
    })
  }

  const setFilter = (_filter: Folder, firstTime: boolean) => {
    if(firstTime) {
      originalFilter = _filter
      filter = copy(_filter)
    } else {
      filter = _filter
      void onEditOpen()
      editCheckForChange()
    }
  }

  const setInitFilter = (_filter?: Folder) => {
    if(_filter === undefined) {
      setFilter({
        id: 0,
        title: '',
        pos: 0,
        contacts: false,
        nonContacts: false,
        groups: false,
        broadcasts: false,
        bots: false,
        excludeMuted: false,
        excludeRead: false,
        includeChats: [],
        excludeChats: [],
      }, true)
      type = 'create'
    } else {
      setFilter(_filter, true)
      type = 'edit'
    }
  }

  const updateFilter = (_filter: Folder) => {
    setFilter(_filter, false)
  }

  ;(tab as typeof tab & { _onOpenAfterTimeout?: () => void })._onOpenAfterTimeout = () => {
    void loadAnimationPromise.then(() => {
      if(!animation) return
      animation.autoplay = true
      animation.play()
    })
  }

  if(p.initFilter !== undefined) {
    setInitFilter(p.initFilter)
  }

  tab.container.classList.add('edit-folder-container')
  const caption = document.createElement('div')
  caption.classList.add('caption')
  caption.append(i18n('FilterIncludeExcludeInfo'))
  const stickerContainer = document.createElement('div')
  stickerContainer.classList.add('sticker-container')

  tempId = 0
  showMoreClicked = {}

  const confirmBtn = ButtonIcon('check btn-confirm hide blue')
  confirmBtn.setAttribute('aria-label', I18n.format('Save', true))
  let deleting = false
  const deleteFolderButton: ButtonMenuItemOptions = {
    icon: 'delete',
    className: 'danger',
    text: 'FilterMenuDelete',
    onClick: () => {
      if(deleting) {
        return
      }

      deleting = true
      deleteFolder(managers, filter.id).then(() => {
        tab.close()
      }, noop).finally(() => {
        deleting = false
      })
    },
  }
  const menuBtn = ButtonMenuToggle({
    listenerSetter: tab.listenerSetter,
    direction: 'bottom-left',
    buttons: [deleteFolderButton],
  })
  menuBtn.setAttribute('aria-label', I18n.format('MultiAccount.More', true))
  menuBtn.classList.add('hide')

  tab.header.append(confirmBtn, menuBtn)

  const [appSettings] = useAppSettings()
  const hasFoldersSidebar = appSettings.tabsInSidebar

  const inputSection = unwrapSolidElement(
    <Section caption={hasFoldersSidebar ? 'EditFolder.EmojiAsIconTip' : undefined}>
      <InputFieldTsx
        class="input-wrapper"
        instanceRef={(value) => void (nameInputField = value)}
        label="FilterNameHint"
        maxLength={MAX_FOLDER_NAME_LENGTH}
        value={filter?.title ?? ''}
        onRawInput={() => {
          filter.title = nameInputField.value.trim()
          editCheckForChange()
        }}
      />
    </Section>,
  ) as HTMLElement

  const generateList = (
    className: string,
    h2Text: LangPackKey,
    buttons: EditFolderButton[],
    to: EditFolderFlags,
    captionKey?: LangPackKey,
  ) => {
    const section = unwrapSolidElement(
      <Section
        class={`folder-list ${className}`}
        name={h2Text}
        caption={captionKey}
        noDelimiter
      />,
    ) as HTMLElement

    // the buttons get a content element of their own — `.folder-categories` is queried by class
    const categories = appendSectionContent(section)
    categories.classList.add('folder-categories')

    buttons.forEach((o, idx) => {
      const button = Button('folder-category-button btn btn-primary btn-transparent' + (idx === 0 ? ' primary' : ' disable-hover'), {
        icon: o.icon,
        text: o.text,
        noRipple: o.withRipple ? undefined : true,
      })

      if(o.name) {
        to[o.name] = button
      }

      categories.append(button)
    })

    return section
  }

  const includePeerIdsButtons: EditFolderButton[] = [{
    icon: 'add',
    text: 'ChatList.Filter.Include.AddChat',
    withRipple: true,
  }, {
    text: 'ChatList.Filter.Contacts',
    icon: 'newprivate',
    name: 'contacts',
  }, {
    text: 'ChatList.Filter.NonContacts',
    icon: 'noncontacts',
    name: 'non_contacts',
  }, {
    text: 'ChatList.Filter.Groups',
    icon: 'group',
    name: 'groups',
  }, {
    text: 'ChatList.Filter.Channels',
    icon: 'channel',
    name: 'broadcasts',
  }, {
    text: 'ChatList.Filter.Bots',
    icon: 'bots',
    name: 'bots',
  }]
  const includePeerIds = generateList('folder-list-included', 'FilterInclude', includePeerIdsButtons, flags, 'FilterIncludeInfo')

  const excludePeerIdsButtons: EditFolderButton[] = [{
    icon: 'minus',
    text: 'FilterRemoveChats',
    withRipple: true,
  }, {
    text: 'ChatList.Filter.MutedChats',
    icon: 'mute',
    name: 'exclude_muted',
  }, // (О-21) 'ChatList.Filter.Archive' / `exclude_archived` — расхождение 2
  {
    text: 'ChatList.Filter.ReadChats',
    icon: 'readchats',
    name: 'exclude_read',
  }]
  const excludePeerIds = generateList('folder-list-excluded', 'FilterExclude', excludePeerIdsButtons, flags, 'FilterExcludeInfo')

  const inviteLinks = generateList('folder-list-links', 'InviteLinks', [{
    icon: 'add',
    text: 'SharedFolder.CreateLink',
    withRipple: true,
  }], {}, 'SharedFolder.Description')

  tab.scrollable.append(
    stickerContainer,
    caption,
    inputSection,
    includePeerIds,
    excludePeerIds,
    inviteLinks,
  )

  const includedFlagsContainer = includePeerIds.querySelector('.folder-categories')!
  const excludedFlagsContainer = excludePeerIds.querySelector('.folder-categories')!
  const inviteLinksCreate = inviteLinks.querySelector('.btn') as HTMLElement

  attachClickEvent(includedFlagsContainer.querySelector('.btn') as HTMLElement, () => {
    void (tab.slider as SidebarSlider).createTab(AppIncludedChatsTab).open({ filter, type: 'included', onSetFilter: (f) => setFilter(f, false) })
  }, { listenerSetter: tab.listenerSetter })

  attachClickEvent(excludedFlagsContainer.querySelector('.btn') as HTMLElement, () => {
    void (tab.slider as SidebarSlider).createTab(AppIncludedChatsTab).open({ filter, type: 'excluded', onSetFilter: (f) => setFilter(f, false) })
  }, { listenerSetter: tab.listenerSetter })

  const confirmEditing = (closeAfter?: boolean): Promise<Folder> | undefined => {
    const input = nameInputField.input
    if(input.classList.contains('error')) {
      return
    }

    if(!nameInputField.value.trim()) {
      input.classList.add('error')
      return
    }

    let include = (Array.from(includedFlagsContainer.children) as HTMLElement[]).slice(1).reduce((acc, el) => acc + +!el.style.display, 0)
    include += filter.includeChats.length

    if(!include) {
      toastNew({ langPackKey: 'EditFolder.Toast.ChooseChat' })
      return
    }

    confirmBtn.setAttribute('disabled', 'true')

    const { id, pos: _pos, ...folderInput } = filter
    let promise: Promise<Folder>
    if(!id) {
      promise = managers.folders.create(folderInput)
    } else {
      if(closeAfter) {
        postponeFilterUpdate = true
      }

      promise = managers.folders.update(id, folderInput)
    }

    return promise.then((dialogFilter) => {
      useFoldersStore.getState().upsert(dialogFilter)
      if(closeAfter) {
        tab.close()
      }

      return dialogFilter
    }).catch((err: unknown) => {
      postponeFilterUpdate = false
      if(postponedFilterUpdate) {
        updateFilter(postponedFilterUpdate)
        postponedFilterUpdate = undefined
      }

      if(err instanceof HttpError && err.type === FOLDERS_TOO_MUCH) {
        // (О-22) `showLimitPopup('folders')` — расхождение 4
        toastNew({ langPackKey: 'LimitReached' })
      } else {
        console.error('updateDialogFilter error:', err)
      }

      throw err
    }).finally(() => {
      confirmBtn.removeAttribute('disabled')
    })
  }

  attachClickEvent(confirmBtn, () => {
    confirmEditing(true)?.catch(noop)
  }, { listenerSetter: tab.listenerSetter })

  let postponedFilterUpdate: Folder | undefined
  let postponeFilterUpdate = false

  // tweb :499-507 — `filter_update` (расхождение 5)
  onCleanup(useAppStateStore.subscribe((s, prev) => {
    if(s.folders === prev.folders || !filter?.id) return
    const updatedFilter = s.folders.find((folder) => folder.id === filter.id)
    if(!updatedFilter || updatedFilter === prev.folders.find((folder) => folder.id === filter.id)) return
    if(postponeFilterUpdate) {
      postponedFilterUpdate = updatedFilter
    } else {
      updateFilter(updatedFilter)
    }
  }))

  // tweb :519-531 (расхождение 10)
  const loadAnimationPromise = p.animationData.then(async(cb) => {
    const player = await cb({
      container: stickerContainer,
      loop: false,
      autoplay: false,
      width: 86,
      height: 86,
      middleware: tab.middlewareHelper.get(),
    })

    animation = player

    return lottieLoader.waitForFirstFrame(player)
  }).catch(() => {
    renderStaticAssetFallback(stickerContainer, 'Folders_2')
  })

  promiseCollector.collect(loadAnimationPromise.then(() => {
    if(type === 'edit') {
      setFilter(originalFilter, true)
      void onEditOpen()
    } else {
      setInitFilter()
      onCreateOpen()
    }

    // `getExportedInvites(0)` у tweb — отказ `FILTER_NOT_SUPPORTED` → `[]` (:543-547)
    const invitesPromise = filter.id ?
      managers.folders.listInvites(filter.id).catch(() => [] as FolderInvite[]) :
      Promise.resolve([] as FolderInvite[])

    void invitesPromise.then((chatlistInvites) => {
      const CLASS_NAME = 'usernames'

      const content = appendSectionContent(inviteLinks)
      const map: Map<HTMLElement, FolderInvite> = new Map()
      type InviteRow = {
        container: HTMLElement
        title: HTMLDivElement
        subtitle: HTMLDivElement
        dispose: VoidFunction
      }
      const invitesMap: Map<string, InviteRow> = new Map()

      // `onLinksLengthChange` (:562-564) прячет «Create» по лимиту — лимита
      // нет (О-22, расхождение 4)

      const onLinkDeletion = (link: FolderInvite) => {
        const row = invitesMap.get(link.url)
        if(row) {
          row.dispose()
          row.container.remove()
          invitesMap.delete(link.url)
          map.delete(row.container)
        }
      }

      const updateLink = (row: InviteRow, chatlistInvite: FolderInvite) => {
        const title = chatlistInvite.title && chatlistInvite.title !== filter.title ?
          chatlistInvite.title :
          inviteUrl(chatlistInvite).replace(/(.+?):\/\//, '')
        const subtitle = i18n('SharedFolder.Includes', [i18n('Chats', [chatlistInvite.peerIds.length])])
        row.title.replaceChildren(title)
        row.subtitle.replaceChildren(subtitle)
      }

      const wrapLink = (chatlistInvite: FolderInvite) => {
        let title!: HTMLDivElement
        let subtitle!: HTMLDivElement
        const mounted = mountSolidComponent(() => (
          <RowTsx clickable class={`${CLASS_NAME}-username active`}>
            <RowTsx.Title ref={title} />
            <RowTsx.Subtitle ref={subtitle} />
            <RowTsx.Media size="medium" class={`${CLASS_NAME}-username-icon`}>
              {Icon('link')}
            </RowTsx.Media>
          </RowTsx>
        ), tab.middlewareHelper.get())
        const row = { container: mounted.element, title, subtitle, dispose: mounted.dispose }

        updateLink(row, chatlistInvite)

        content.append(row.container)
        map.set(row.container, chatlistInvite)
        invitesMap.set(chatlistInvite.url, row)
      }

      let target: HTMLElement
      createContextMenu({
        buttons: [{
          icon: 'copy',
          text: 'CopyLink',
          onClick: () => void copyTextToClipboard(inviteUrl(map.get(target)!)),
        }, {
          icon: 'delete',
          className: 'danger',
          text: 'Delete',
          onClick: () => {
            const chatlistInvite = map.get(target)!
            void managers.folders.revokeInvite(chatlistInvite.slug).then(() => {
              onLinkDeletion(chatlistInvite)
            })
          },
        }],
        listenTo: content,
        listenerSetter: tab.listenerSetter,
        findElement: (e) => findUpClassName(e.target!, 'row'),
        onOpen: (_e, _target) => target = _target,
      })

      attachClickEvent(inviteLinksCreate, async() => {
        // (О-22) лимит `chatlistInvites` — расхождение 4

        if(!filter.title) {
          toastNew({ langPackKey: 'SharedFolder.Toast.NeedName' })
          return
        }

        const found = [includePeerIdsButtons, excludePeerIdsButtons].some((buttons) => {
          return buttons.some((button) => button.name && hasFlag(filter, button.name))
        })

        if(found) {
          toastNew({ langPackKey: 'SharedFolder.Toast.NoTypes' })
          return
        }

        if(filter.excludeChats.length) {
          toastNew({ langPackKey: 'SharedFolder.Toast.NoExcluded' })
          return
        }

        // `toggleDisability([inviteLinksCreate], true)` — расхождение 7
        inviteLinksCreate.setAttribute('disabled', 'true')
        const toggle = () => inviteLinksCreate.removeAttribute('disabled')
        let f: Folder
        try {
          const result = confirmEditing(false)
          if(!(result instanceof Promise)) {
            throw ''
          }

          f = await result
          updateFilter(f)
          type = 'edit'
          originalFilter = f
          editCheckForChange()
        } catch {
          toggle()
          return
        }

        managers.folders.createInvite(f.id).then((exportedChatlistInvite) => {
          toggle()
          // `openChatlistInvite(…).finally(() => wrapLink(…))` — вкладки
          // «Share Folder» нет (задача 25, расхождение 6)
          wrapLink(exportedChatlistInvite)
        }, (err: unknown) => {
          toggle()
          if(err instanceof HttpError && err.type === NO_SHAREABLE) {
            // у tweb `PEERS_LIST_EMPTY` → `openChatlistInvite()` (задача 25)
            toastNew({ langPackKey: 'Folder.Share.Empty' })
            return
          }

          throw err
        })
      }, { listenerSetter: tab.listenerSetter })

      // клик по строке ссылки → `openChatlistInvite` (:716-724) — задача 25,
      // расхождение 6

      chatlistInvites.forEach(wrapLink)
    })
  }))

  return null
}

export default EditFolder
