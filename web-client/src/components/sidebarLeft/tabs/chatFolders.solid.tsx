/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/chatFolders.tsx:1-433` (812502980) —
 * вкладка «Папки» (`AppChatFoldersTab`, `solidJsTabs/tabs.ts`). Задача 24 плана
 * волны 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`),
 * разбор — `docs/tweb/settings-rows.md` § 6.1, дамп `14-left-18-…folders`.
 *
 *   div.sticker-container (Folders_1, 86×86)            (:381)
 *   div.caption «ChatList.Filter.Header»                 (:382)
 *   button.btn-primary.btn-color-primary.btn-control + «ChatList.Filter.NewTitle»  (:383-394)
 *   Section Filters[.hide без папок] > div > Row clickable (Title + Subtitle)       (:395-397)
 *   Section FiltersView > form > 2 × Row + Row.RadioField (settings.tabsInSidebar)  (:403-428)
 *
 * Открывают вкладку строка корня настроек (tweb `settings.tsx:256`), меню «Все
 * чаты» (`createFolderContextMenu.ts:42-50`) и кнопка настроек вертикальной
 * колонки папок (`foldersSidebarContent/index.tsx:203-216`).
 *
 * Расхождения с оригиналом:
 *  1. Порядок папок перетаскивается через `Sortable` (`:353-372`) с
 *     `moveInDom: false`: список рисует `For` из модели, и его разностный проход
 *     по руками сдвинутому DOM ставит строки неверно (так сказано у самого
 *     `Sortable`). У tweb строку двигает сам `Sortable`, а порядок в хранилище
 *     появляется по ответу (`filters.ts:424-433`) — здесь строка встаёт на место
 *     тоже по ответу, до него она возвращается на прежнее (видимая разница на
 *     время запроса). `onSort` собирает `order` из строк (`:355-363`), у
 *     не-премиум `0` вырезается (`:365-367`), `foldersStore.updateOrder` шлёт
 *     запрос и только ПО ОТВЕТУ применяет порядок; отказ порядка не меняет.
 *     Строка «Все чаты» (`:108-110`, `toggleAllChats` `:200-203`) есть только у
 *     премиума, стоит на месте `appState.allChatsPos` (решение В-6) и несёт в
 *     `order` id `0`. События `filter_order` (`:325-331`) нет — порядок приходит
 *     кадром `updateDialogFilterOrder` в `foldersStore.applyOrder`, `For` двигает
 *     строки сам. Подпись «Все чаты» — число чатов всех не-архивных диалогов
 *     (`getFolderDialogs(0)`, `:91-97`).
 *  2. (О-20) Секции «Рекомендованные папки» (`FilterRecommended`, `:215-255`,
 *     `:398-402`) нет: нет `getSuggestedDialogFilters`. Прежний React-экран
 *     рисовал вместо неё два своих пресета — выдумка, в порт не перенесена.
 *  3. (О-22) Лимит папок не проверяется до открытия редактора (`canCreateFolder`
 *     + `showLimitPopup('folders')`, `:205-213`, `:388-389`): бэкенд лимитов не
 *     отдаёт (`MaxFoldersPerUser` зашит в `domain/folder.go`), а `PopupLimit` —
 *     волна 2C. Превышение ловит сохранение редактора (`editFolder.solid.tsx`).
 *  4. Строки — `For` по `appState.folders` (подписка на zustand), а не
 *     императивные `mountSolidComponent` + `filter_update`/`filter_delete`
 *     (`:59-198`, `:300-323`): папки у нас держит главный поток, и
 *     единственный писатель `foldersStore.applyFolders` уже отдаёт порядок по
 *     `pos` (роль `localId`/`positionElementByIndex`, `:187-195`).
 *  5. Подпись строки считается по зеркалу диалогов (`useChatsStore.dialogs`) тем
 *     же правилом, что список папки и её счётчик (`dialogMatchesFolder`, архив
 *     не входит — `core/folders/folderUnreadCounts.ts`, расхождение 3), а не
 *     `dialogsStorage.getFolderDialogs` (`:91-97`): воркерного набора диалогов
 *     папки у главного потока нет.
 *  6. Название папки — `filter.title` текстом, а не `wrapFolderTitle` (кастомные
 *     эмодзи в названии): на проводе `Folder.title` — строка без сущностей.
 *  7. `settings_updated` по `tabsInSidebar` (`:275-282`: `setHasFoldersSidebar`,
 *     `adjustChatPatternBackground`, `showCtrlFTip`) не слушается: режим папок
 *     колонка (`Sidebar.tsx`) читает из той же настройки сама, подписчиком.
 *     Радио пишут настройку `checked`/`onChange` через `useAppSettings` —
 *     `stateKey`/`valueForState` у нашего `RadioFieldTsx` нет (как у
 *     `CheckboxFieldTsx`, итог задачи 7).
 *  8. Заставка: плееру дана миддлварь вкладки (у tweb плеер без неё); без WASM
 *     SIMD — статичный кадр (`renderStaticAssetFallback`), а отказ загрузки
 *     коллектору не отдаётся — иначе вкладка не открылась бы вовсе.
 */
import { createMemo, For, onMount, Show } from 'solid-js'
import { i18n, join, type LangPackKey } from '@lib/langPack'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import { renderStaticAssetFallback } from '@lib/lottie/lottieAssetFallback'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import Button from '@components/buttonTsx.solid'
import Section from '@components/section.solid'
import { IconTsx } from '@components/iconTsx.solid'
import Sortable from '@helpers/dom/sortable'
import Row from '@components/rowTsx.solid'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import type SidebarSlider from '@components/slider'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import { AppEditFolderTab, type AppChatFoldersTab } from '@components/solidJsTabs/tabs'
import { useAppSettings } from '@stores/appSettings.solid'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { updateOrder, useFoldersStore } from '@stores/foldersStore'
import { isDialogMuted, useNotifyStore } from '@stores/notifyStore'
import { cachedChat, cachedPeer } from '@core/peerCache'
import { isDialogArchived } from '@core/models'
import { ALL_FOLDER_ID } from '@core/folderIds'
import { dialogMatchesFolder } from '@core/folderFilter'
import { isAnyGroup, isBroadcast } from '@core/peers/predicates'
import type { Folder } from '@core/managers/foldersManager'

/** tweb `:77-84` — папка ровно с одним флагом типа подписана им. */
const SINGLE_FLAG_KEYS: [keyof Folder, LangPackKey][] = [
  ['contacts', 'FilterAllContacts'],
  ['nonContacts', 'FilterAllNonContacts'],
  ['groups', 'FilterAllGroups'],
  ['broadcasts', 'FilterAllChannels'],
  ['bots', 'FilterAllBots'],
]

const FLAG_FIELDS: (keyof Folder)[] = ['contacts', 'nonContacts', 'groups', 'broadcasts', 'bots', 'excludeMuted', 'excludeRead']

/**
 * tweb `renderFolder` `:66-103` — подпись строки папки (расхождение 5).
 * Без `filter` — строка «Все чаты»: без флагов, чаты считаются все не-архивные.
 */
export function getFolderSubtitle(filter: Folder | undefined): (string | Node)[] | undefined {
  const d: HTMLElement[] = []
  const enabledFilters = filter ? FLAG_FIELDS.filter((key) => filter[key]).length : 0
  if(filter && enabledFilters === 1) {
    const found = SINGLE_FLAG_KEYS.find(([key]) => filter[key])
    if(found) {
      d.push(i18n(found[1]))
    }
  }

  if(!d.length) {
    const contactIds = useFoldersStore.getState().contactIds
    const notifySettings = useNotifyStore.getState().settings
    let chats = 0, channels = 0, groups = 0
    for(const dialog of useChatsStore.getState().dialogs) {
      if(isDialogArchived(dialog)) continue
      const chat = cachedChat(dialog.peerId)
      const muted = isDialogMuted(dialog, chat, notifySettings)
      if(filter && !dialogMatchesFolder(dialog, cachedPeer(dialog.peerId), filter, contactIds, muted)) continue
      if(isAnyGroup(dialog.peerId, chat)) ++groups
      else if(isBroadcast(chat)) ++channels
      else ++chats
    }

    if(chats) d.push(i18n('Chats', [chats]))
    if(channels) d.push(i18n('Channels', [channels]))
    if(groups) d.push(i18n('Groups', [groups]))
  }

  return d.length ? join(d) : undefined
}

const ChatFolders = () => {
  const [tab] = useSuperTab<typeof AppChatFoldersTab>()
  const promiseCollector = usePromiseCollector()
  const [appSettings, setAppSettings] = useAppSettings()
  const p = tab.payload

  let animation: LottiePlayer | undefined
  let loadAnimationPromise: Promise<unknown>
  let stickerContainer!: HTMLDivElement

  // Расхождение 4 — папки из единственного владельца, в его порядке.
  const folders = subscribeExternal(
    (onChange) => useAppStateStore.subscribe((s, prev) => { if(s.folders !== prev.folders) onChange() }),
    () => useAppStateStore.getState().folders,
  )
  const isPremium = subscribeExternal(
    useChatsStore.subscribe,
    () => !!useChatsStore.getState().me?.user.pFlags?.premium,
  )
  const allChatsPos = subscribeExternal(
    (onChange) => useAppStateStore.subscribe((s, prev) => { if(s.allChatsPos !== prev.allChatsPos) onChange() }),
    () => useAppStateStore.getState().allChatsPos,
  )
  // Строки списка: папки + «Все чаты» (`undefined`) на сохранённом месте — только
  // у премиума (tweb `toggleAllChats` `:200-203`).
  const rows = createMemo<(Folder | undefined)[]>(() => {
    const list = folders()
    if(!isPremium()) return list
    const at = Math.min(allChatsPos(), list.length)
    return [...list.slice(0, at), undefined, ...list.slice(at)]
  })
  const foldersHidden = createMemo(() => !rows().length)
  let list!: HTMLDivElement

  const openEditFolder = (filter?: Folder) => {
    const initArgs = AppEditFolderTab.getInitArgs()
    void (tab.slider as SidebarSlider).createTab(AppEditFolderTab).open({ ...initArgs, initFilter: filter })
  }

  // tweb :261-266
  ;(tab as typeof tab & { _onOpenAfterTimeout?: () => void })._onOpenAfterTimeout = () => {
    void loadAnimationPromise.then(() => {
      if(!animation) return
      animation.autoplay = true
      animation.play()
    })
  }

  // tweb :268-269
  const name = 'theme'

  onMount(() => {
    tab.container.classList.add('chat-folders-container')
    tab.scrollable.container.classList.add('chat-folders')

    // tweb :337-351 (расхождение 8)
    loadAnimationPromise = p.animationData.then(async(cb) => {
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
      renderStaticAssetFallback(stickerContainer, 'Folders_1')
    })

    promiseCollector.collect(loadAnimationPromise)

    // tweb :353-372 (расхождение 1)
    new Sortable({
      list,
      middleware: tab.middlewareHelper.get(),
      moveInDom: false,
      onSort: (_prevIdx, _newIdx, { from, to }) => {
        const order = rows().map((filter) => filter?.id ?? ALL_FOLDER_ID)
        order.splice(to, 0, ...order.splice(from, 1))
        // tweb :365-367
        const managers = tab.managers!
        const sent = isPremium() ? order : order.filter((filterId) => filterId !== ALL_FOLDER_ID)
        updateOrder(managers, sent).catch(() => {})
      },
      scrollable: tab.scrollable,
    })
  })

  return (
    <>
      <div ref={stickerContainer} class="sticker-container" />
      <div class="caption">{i18n('ChatList.Filter.Header')}</div>
      <Button
        class="btn-primary btn-color-primary btn-control"
        icon="add"
        text="ChatList.Filter.NewTitle"
        onClick={() => {
          // (О-22) `canCreateFolder` + `showLimitPopup('folders')` — расхождение 3
          openEditFolder()
        }}
      />
      <Section name="Filters" classList={{ hide: foldersHidden() }}>
        <div ref={list}>
          <For each={rows()}>{(filter) => {
            const subtitle = getFolderSubtitle(filter)
            return (
              <Row
                class="row-sortable"
                // «Все чаты» без обработчика клика (tweb :149-155)
                clickable={filter ? () => {
                  // tweb :169-172 — редактор получает папку, прочитанную на клике
                  const current = useAppStateStore.getState().folders.find((folder) => folder.id === filter.id)
                  if(current) openEditFolder(current)
                } : true}
              >
                <Row.Title>{filter ? filter.title : i18n('FilterAllChats')}</Row.Title>
                <Show when={subtitle}>
                  <Row.Subtitle>{subtitle}</Row.Subtitle>
                </Show>
                <IconTsx icon="menu" class="row-sortable-icon" />
              </Row>
            )
          }}</For>
        </div>
      </Section>
      {/* (О-20) Section FilterRecommended — расхождение 2 */}
      <Section name="FiltersView">
        <form>
          <Row>
            <Row.RadioField>
              <RadioFieldTsx
                name={name}
                value="true"
                checked={appSettings.tabsInSidebar}
                onChange={(checked) => { if(checked) void setAppSettings('tabsInSidebar', true) }}
              />
            </Row.RadioField>
            <Row.Title>{i18n('FiltersOnLeft')}</Row.Title>
          </Row>
          <Row>
            <Row.RadioField>
              <RadioFieldTsx
                name={name}
                value="false"
                checked={!appSettings.tabsInSidebar}
                onChange={(checked) => { if(checked) void setAppSettings('tabsInSidebar', false) }}
              />
            </Row.RadioField>
            <Row.Title>{i18n('FiltersOnTop')}</Row.Title>
          </Row>
        </form>
      </Section>
    </>
  )
}

export default ChatFolders
