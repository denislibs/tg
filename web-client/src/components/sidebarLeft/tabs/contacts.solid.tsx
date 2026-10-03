/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/contacts.tsx` (812502980) — вкладка «Контакты»
 * (`AppContactsTab`, `solidJsTabs/tabs.ts`, tweb :209-222): поле поиска на месте заголовка,
 * кнопка сортировки в шапке, список `ContactsList` (`sidebarLeft/contactsList.solid.tsx`),
 * угловая «добавить контакт». Её же открывает «Новый личный чат» (tweb `sidebarLeft/index.ts:1079-1083`,
 * `:1105-1109`) — отдельного экрана «Новое сообщение» у оригинала нет. Клик по строке открывает
 * чат пира, вкладка при этом остаётся открытой, как у оригинала (`setListClickListener` →
 * `appImManager.setPeer`; колонку закрывает только `closeEverythingInside`).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Выделения контактов нет — `ContactsSelection` (:30-39), меню строки
 *     `attachContactsContextMenu` (:47-51) и `selection` в `setListClickListener` (:43-46): база
 *     `DialogsSelectionBase` (коммит 60a83a6f1) не портирована — О-30 волны 7 (шапка
 *     `contactsList.solid.tsx`, расхождение 1).
 *  2. `highlight: 'sort'` (:84-89, `flashControl`) не заведена — О-31 волны 7, шапка `AppContactsTab` в
 *     `solidJsTabs/tabs.ts`.
 *  3. `ariaLabel` у кнопки сортировки и угловой кнопки (:55, :66) не передаётся — опции нет у
 *     нашего `Button` (a11y-правка 472e3e76b не портирована, шапка `components/buttonCorner.ts`).
 *  4. `showCreateContactPopup` — `// ВРЕМЕННО до 2C-26` мост на React-попап
 *     (`sidebarLeft/createContactPopupBridge.tsx`).
 *  5. Отступление В7-1: с `{secret: true}` («Новый секретный чат», E2E — у tweb пары нет) клик
 *     по контакту начинает секретный чат (`startSecretChat` ниже), а не открывает
 *     личный.
 *  6. `setListClickListener` — наш порт (`lib/appDialogsManager.ts`).
 */
import { createEffect, createSignal, onMount, type Component } from 'solid-js'
import appDialogsManager from '@lib/appDialogsManager'
import InputSearch from '@components/inputSearch'
import { IS_MOBILE } from '@environment/userAgent'
import { canFocus } from '@helpers/dom/canFocus'
import ButtonCorner from '@components/buttonCorner'
import ButtonIcon from '@components/buttonIcon'
import { replaceButtonIcon } from '@components/button'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import showCreateContactPopup from '@components/sidebarLeft/createContactPopupBridge'
import ContactsList from '@components/sidebarLeft/contactsList.solid'
import { useAppSettings } from '@stores/appSettings.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppContactsTab, AppContactsTabOptions } from '@components/solidJsTabs/tabs'
import appImManager from '@lib/appImManager'
import { useSecretChatStore } from '@stores/secretChatStore'
import type { Managers } from '@/client/bootstrap'

/**
 * Отступление В7-1 (наша фича, E2E): рукопожатие `managers.secret.start` с выбранным
 * контактом, статус «ожидание» и открытие созданного чата — как только что созданной
 * группы: `appImManager.setInnerPeer` и перечитывание списка.
 */
async function startSecretChat(managers: Pick<Managers, 'secret' | 'dialogs'>, userId: PeerId): Promise<void> {
  const { peerId } = await managers.secret.start(userId)
  useSecretChatStore.getState().setStatus(peerId, 'awaiting')
  void appImManager.setInnerPeer({ peerId })
  // `.catch`: fire-and-forget, `refresh()` пробрасывает HttpError
  void managers.dialogs.refresh().catch(() => {})
}

const Contacts: Component = () => {
  const [tab] = useSuperTab<typeof AppContactsTab>()
  const managers = tab.managers!

  const [query, setQuery] = createSignal('')
  // * by last seen until switched, and then the way it was switched to on the next visit too
  const [appSettings, setAppSettings] = useAppSettings()
  const sortMode = () => appSettings.contactsSortMode

  const onList = (list: HTMLUListElement) => {
    appDialogsManager.setListClickListener({
      list,
      autonomous: true,
      // Отступление В7-1: секретный чат вместо личного
      onFound: (tab.payload as AppContactsTabOptions)?.secret ? (element) => { void startSecretChat(managers, +element.dataset.peerId!); return false } : undefined,
    })
  }

  // * tdesktop's button: it shows the order it switches to, not the one that is on
  const sortButton = ButtonIcon('sort_name sidebar-header-right', { noRipple: true })
  createEffect(() => {
    replaceButtonIcon(sortButton, sortMode() === 'online' ? 'sort_name' : 'sort_online')
  })
  attachClickEvent(sortButton, () => {
    void setAppSettings('contactsSortMode', sortMode() === 'online' ? 'name' : 'online')
  }, { listenerSetter: tab.listenerSetter })

  onMount(() => {
    tab.container.id = 'contacts-container'

    const btnAdd = ButtonCorner({ icon: 'add', className: 'is-visible' })
    tab.content.append(btnAdd)

    attachClickEvent(btnAdd, () => {
      showCreateContactPopup()
    }, { listenerSetter: tab.listenerSetter })

    const inputSearch = new InputSearch({
      placeholder: 'Search',
      onChange: setQuery,
    })

    tab.title.replaceWith(inputSearch.container)
    tab.header.append(sortButton)

    // Focusing while the tab is still sliding in scrolls it, so the field waits
    // for the tab to be on screen — the promise the slider resolves for it.
    void tab.shown.then(() => {
      if(IS_MOBILE || !canFocus(true)) return
      inputSearch.input.focus()
    })
  })

  return (
    <ContactsList
      managers={managers}
      query={query()}
      sortMode={sortMode()}
      scrollable={tab.scrollable.container}
      indexContainer={tab.content}
      ref={onList}
    />
  )
}

export default Contacts
