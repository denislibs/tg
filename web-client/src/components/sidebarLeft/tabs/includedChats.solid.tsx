/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/includedChats.tsx:1-252` (812502980) —
 * выбор чатов папки (`AppIncludedChatsTab`, `solidJsTabs/tabs.ts`, заголовок по
 * `type`: `FilterAlwaysShow`/`FilterNeverShow`) на `AppSelectPeers`.
 *
 * Это кусок задачи 25 плана волны 2D, взятый в задачу 24 минимально: без него
 * редактор папки (`editFolder.solid.tsx`) не собрать — «Add Chats»/«Remove
 * Chats» открывают именно эту вкладку, а React-выбор (`FolderChatsPicker.tsx`)
 * Solid-вкладка открыть не может (обратного моста нет). Вкладка ссылки папки
 * (`sharedFolder.tsx`) остаётся задаче 25.
 *
 *   header: … + button.btn-icon.btn-confirm.blue(check)                       (:145-148)
 *   div.selector… (`AppSelectPeers`, `peerType: ['dialogs']`, секция FilterChats)
 *     Section.folder-categories «FilterChatTypes» > button.folder-category-button[data-peer-id] + чекбокс  (:85-102)
 *
 * Расхождения с оригиналом:
 *  1. Папка — наша `Folder`: флаги плоскими полями (`FOLDER_PFLAGS`,
 *     `editFolderShared.ts`), выбранные пиры — `includeChats`/`excludeChats`;
 *     входных пиров (`include_peers` через `getInputPeerById`, `:210`) и
 *     закреплённых (`pinnedPeerIds`, `:191-196`) у нас нет.
 *  2. (О-21) Категории «Archived» (`exclude_archived`, `:61`) нет.
 *  3. (О-22) Лимит чатов в папке (`dialog_filters_chats_limit_*` из
 *     `app_config`, `showLimitPopup('folderPeers')`, `:112-115`, `:216-235`) не
 *     проверяется: бэкенд лимита не отдаёт, `PopupLimit` — волна 2C.
 *     Обёртка `selector.add` оставлена ради подписи и иконки категории.
 *  4. Подпись строки — папки, в которых чат уже есть (`getSubtitleForElement`,
 *     `:34-45`): принадлежность считается по зеркалу диалогов тем же правилом,
 *     что список папки (`dialogMatchesFolder`, архив не входит), а не
 *     `dialogsStorage.getFolderDialogs`; название — текстом (`wrapFolderTitle`
 *     не нужен: `Folder.title` без сущностей). `getContacts` (`:224`) не
 *     зовётся: контакты правилам папок уже отдал `loadFolders`
 *     (`foldersStore.contactIds`).
 *  5. `aria-label` кнопки «Save» ставится атрибутом (как в `editFolder.solid.tsx`).
 */
import { onCleanup, onMount } from 'solid-js'
import I18n, { i18n, join, type LangPackKey } from '@lib/langPack'
import AppSelectPeers from '@components/appSelectPeers.solid'
import ButtonIcon from '@components/buttonIcon'
import Button from '@components/button'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppIncludedChatsTab } from '@components/solidJsTabs/tabs'
import { FOLDER_PFLAGS, type FolderPFlag } from '@components/sidebarLeft/tabs/editFolderShared'
import copy from '@helpers/object/copy'
import { attachClickEvent, simulateClickEvent } from '@helpers/dom/clickEvent'
import { unwrapSolidElement } from '@helpers/solid/wrapSolidComponent'
import { isDialogArchived } from '@core/models'
import { dialogMatchesFolder } from '@core/folderFilter'
import { cachedChat, cachedPeer } from '@core/peerCache'
import type { IconName } from '@core/tgico-icons'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersStore } from '@stores/foldersStore'
import { isDialogMuted, useNotifyStore } from '@stores/notifyStore'

type CategoryDetails = { [flag in FolderPFlag]?: { ico: IconName, icoFilled?: IconName, text: LangPackKey } }

const IncludedChats = () => {
  const [tab] = useSuperTab<typeof AppIncludedChatsTab>()

  const { type, onSetFilter } = tab.payload
  const originalFilter = tab.payload.filter
  const filter = copy(originalFilter)

  let confirmBtn!: HTMLElement
  let selector: AppSelectPeers | undefined

  // :34-45 (расхождение 4)
  const getSubtitleForElement = (peerId: PeerId) => {
    const dialog = useChatsStore.getState().dialogs.find((d) => d.peerId === peerId)
    const titles: HTMLElement[] = []
    if(dialog && !isDialogArchived(dialog)) {
      const chat = cachedChat(peerId)
      const contactIds = useFoldersStore.getState().contactIds
      const muted = isDialogMuted(dialog, chat, useNotifyStore.getState().settings)
      for(const folder of useAppStateStore.getState().folders) {
        if(!dialogMatchesFolder(dialog, cachedPeer(peerId), folder, contactIds, muted)) continue
        const span = document.createElement('span')
        span.append(folder.title)
        titles.push(span)
      }
    }

    const subtitle = document.createDocumentFragment()
    subtitle.append(...join(titles, false))
    return subtitle
  }

  const onSelectChange = (length: number) => {
    if(type === 'included') {
      confirmBtn.style.display = length ? '' : 'none'
    }
  }

  const buildSelector = () => {
    confirmBtn.style.display = type === 'excluded' ? '' : 'none'
    // title is set by the scaffold (function of payload.type)

    let details: CategoryDetails
    if(type === 'excluded') {
      details = {
        exclude_muted: { ico: 'mute', text: 'ChatList.Filter.MutedChats' },
        // (О-21) exclude_archived — расхождение 2
        exclude_read: { ico: 'readchats', text: 'ChatList.Filter.ReadChats' },
      }
    } else {
      details = {
        contacts: { ico: 'newprivate', icoFilled: 'newprivate_filled', text: 'ChatList.Filter.Contacts' },
        non_contacts: { ico: 'noncontacts', text: 'ChatList.Filter.NonContacts' },
        groups: { ico: 'group', icoFilled: 'group_filled', text: 'ChatList.Filter.Groups' },
        broadcasts: { ico: 'newchannel', icoFilled: 'channel_filled', text: 'ChatList.Filter.Channels' },
        bots: { ico: 'bots', icoFilled: 'bot_filled', text: 'ChatList.Filter.Bots' },
      }
    }

    const _selector = selector = new AppSelectPeers({
      middleware: tab.middlewareHelper.get(),
      appendTo: tab.container,
      onChange: onSelectChange,
      peerType: ['dialogs'],
      getSubtitleForElement: async(peerId) => getSubtitleForElement(peerId as PeerId),
      placeholder: 'Search',
      sectionNameLangPackKey: 'FilterChats',
      managers: tab.managers!,
    })

    const categoryButtons = (Object.keys(details) as FolderPFlag[]).map((key) => {
      const button = Button('btn-primary btn-transparent folder-category-button', { icon: details[key]!.ico, text: details[key]!.text })
      button.dataset.peerId = key
      button.append(_selector.checkbox())
      return button
    })

    let categoriesContent!: HTMLElement
    const categoriesSection = unwrapSolidElement(
      <Section
        class="folder-categories"
        noDelimiter
        name="FilterChatTypes"
        contentProps={{ ref: (element) => categoriesContent = element }}
      >
        {categoryButtons}
      </Section>,
    ) as HTMLElement

    const selectedPeers = (type === 'included' ? filter.includeChats : filter.excludeChats).slice()

    _selector.selected = new Set(selectedPeers)

    const _add = _selector.add.bind(_selector)
    _selector.add = ({ key, title, scroll }) => {
      const d = typeof key === 'string' ? details[key as FolderPFlag] : undefined
      // (О-22) лимит `folderPeers` — расхождение 3

      const ret = _add({
        key,
        title: d ? i18n(d.text) : title,
        scroll,
        fallbackIcon: d ? d.icoFilled || d.ico : undefined,
      })
      return ret
    }

    _selector.scrollable.append(
      categoriesSection,
      _selector.scrollable.container.lastElementChild!,
    )

    _selector.addInitial(selectedPeers)

    for(const flag in details) {
      if(filter[FOLDER_PFLAGS[flag as FolderPFlag]]) {
        simulateClickEvent(categoriesContent.querySelector(`[data-peer-id="${flag}"]`) as HTMLElement)
      }
    }
  }

  onMount(() => {
    tab.content.remove()
    tab.container.classList.add('included-chatlist-container')
    confirmBtn = ButtonIcon('check btn-confirm blue', { noRipple: true })
    confirmBtn.setAttribute('aria-label', I18n.format('Save', true))
    confirmBtn.style.display = 'none'

    tab.header.append(confirmBtn)

    attachClickEvent(confirmBtn, () => {
      const selected = selector!.getSelected()

      // :153-172 — снять флаги своей половины (включение/исключение)
      for(const key in FOLDER_PFLAGS) {
        const isExclude = key.indexOf('exclude_') === 0
        if(type === 'included' ? isExclude : !isExclude) {
          continue
        }

        filter[FOLDER_PFLAGS[key as FolderPFlag]] = false
      }

      const peerIds: PeerId[] = []
      for(const key of selected) {
        if(typeof key === 'number') {
          peerIds.push(key)
        } else {
          filter[FOLDER_PFLAGS[key as FolderPFlag]] = true
        }
      }

      // :198-207 — чат не может быть и включён, и исключён
      const other = type === 'included' ? 'excludeChats' : 'includeChats'
      filter[other] = filter[other].filter((peerId) => !peerIds.includes(peerId))

      filter[type === 'included' ? 'includeChats' : 'excludeChats'] = peerIds

      onSetFilter(filter)
      tab.close()
    }, { listenerSetter: tab.listenerSetter })

    // :222-239 — у tweb сбор контактов, папок и `app_config`; у нас всё уже в
    // зеркалах (расхождения 3, 4)
    buildSelector()
  })

  onCleanup(() => {
    if(selector) {
      selector.container.remove()
      selector = undefined
    }
  })

  return null
}

export default IncludedChats
