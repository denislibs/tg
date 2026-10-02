/** @jsxImportSource solid-js */
// Порт tweb `src/components/archiveDialog.tsx` (812502980, 467 строк) — строка
// «Архив» закреплённым элементом списка «Всех чатов» (`CustomPinnedDialog`,
// `autonomousDialogList/dialogs.ts:101-120`) и её состояние. Задача 1-5 волны 7
// (строки Б-1, Б-2 бэклога плана каркаса).
//
// Строка — custom element `archive-dialog` (`defineSolidElement`): по тегу её
// находит клик списка (`appDialogsManager.setListClickListener`, tweb `:2135-2139`)
// и открывает вкладку архива `appSidebarLeft.openArchiveTab()`.
//
// Расхождения с оригиналом:
//  1. Источник — зеркало диалогов главного потока (`useChatsStore`), а не события
//     `dialog_flush`/`dialogs_multiupdate`/`dialog_drop`/`dialog_unread`/
//     `dialog_draft` (`useDialogEvents` `:222-298`) — тот же мост чтения, что у
//     списка (Отступление В7-5, шапка `autonomousDialogList/dialogs.ts`). Первую
//     страницу архива (`ensureHydrated`, `:186-192`) владелец объявляет в зеркало
//     сам (`dialog_op`); ответ запроса читается лишь как «готово» и «конец».
//     Поэтому правило `canKeepDialog` (`:228-237`, держать только первую страницу)
//     не нужно: строка показывает архивные диалоги зеркала, первые `limit`.
//  2. Перезапрос страницы, когда архивные диалоги ушли (`:174-183`), — только на
//     УБЫЛЬ архива в зеркале, а не на каждое расхождение длины со страницей:
//     ответ запроса и операция зеркала приходят разными путями, и сравнение
//     «длина страницы > длины зеркала» в промежутке между ними зациклило бы запрос.
//     Упавший запрос не ставит «готово» — следующая загрузка списка спросит снова
//     (у tweb ресурс остаётся ошибочным навсегда).
//  3. Счётчик (`useTotalUnreadCount`, `:300-326`) — диалоги архива с
//     непрочитанным по зеркалу (`archiveUnreadCount`, `core/folders/folderUnreadCounts.ts`):
//     папочного `getFolderUnreadCount` в воркере нет (расхождение 1 того файла).
//     Жирность имени — `isDialogUnread` синхронно, без кэша `cachedDialogUnread`
//     (`:64-68`): у оригинала это RPC в воркер на каждого пира.
//  4. Не портировано: истории архива (`ArchiveAvatar` с `StoriesSegments`,
//     `useStoriesSegments`, `useOpenArchiveStories`, `controls.openStory`) —
//     Б-51; настройка `showArchiveInChatList` (`:136`, её пишет меню архива
//     `archiveDialogContextMenu.ts`) — Б-50, строка видна всегда, когда архив не
//     пуст; сообщества (`isCollapsedCommunity`, `:158-161`) — О-5.
import { createEffect, createMemo, createRoot, createSignal, For, on, onCleanup, Show } from 'solid-js'
import defineSolidElement, { type PassedProps } from '@shared/solid/defineSolidElement.solid'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { linkKeyDown } from '@helpers/solid/buttonKeyDown'
import { getMiddleware } from '@helpers/middleware'
import formatNumber from '@helpers/number/formatNumber'
import { i18n } from '@lib/langPack'
import { isDialogUnread } from '@lib/appDialogsManager'
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import Badge from '@components/badge.solid'
import { IconTsx } from '@components/iconTsx.solid'
import { ARCHIVE_FOLDER_ID } from '@core/folderIds'
import { isDialogArchived, type Dialog } from '@core/models'
import { archiveUnreadCount } from '@core/folders/folderUnreadCounts'
import type { DialogsPage } from '@core/managers/dialogsManager'
import { useChatsStore } from '@stores/chatsStore'
import styles from './archiveDialog.module.scss'

/** tweb `:33-34` */
export const ARCHIVE_DIALOG_LIMIT = 10
const limitSymbols = 20

/** Срез менеджеров строки: страница архива у владельца диалогов и имена пиров. */
export type ArchiveDialogManagers = PeerTitleManagers & {
  dialogs: {
    getDialogs(options: { limit: number, filterId: number }): Promise<DialogsPage>,
  },
}

type ArchiveDialogProps = {
  state: DisposableArchiveDialogState['state'],
}

/** tweb `:44` */
export const archiveDialogTagName = 'archive-dialog'

const ArchiveDialog = defineSolidElement({
  name: archiveDialogTagName,
  component: (props: PassedProps<ArchiveDialogProps>) => {
    props.element.classList.add('row', 'no-wrap', 'row-with-padding', 'row-clickable', 'hover-effect', 'chatlist-chat', 'chatlist-chat-bigger', 'row-big')

    // tweb `:51-63`: строка — ссылка, как её соседи; Enter поднимает клик с
    // `detail === 0`, Space остаётся прокрутке списка.
    props.element.setAttribute('role', 'link')
    props.element.tabIndex = 0
    const onKeyDown = (e: KeyboardEvent) => linkKeyDown(e, props.element)
    props.element.addEventListener('keydown', onKeyDown)
    onCleanup(() => props.element.removeEventListener('keydown', onKeyDown))

    const sortedDialogs = createMemo(() => props.state.sortedDialogs().slice(0, ARCHIVE_DIALOG_LIMIT))
    const totalUnreadCount = () => props.state.totalUnreadCount()

    // tweb `<I18nTsx class={styles.Title} key="ArchivedChats" />` — класс на самом
    // узле перевода (`helpers/solid/i18n.tsx`), без обёртки
    const title = i18n('ArchivedChats')
    title.classList.add(styles.Title)

    return (
      <>
        <ArchiveAvatar />
        <div class="row-row row-title-row">
          {title}
        </div>
        <div class="row-row row-subtitle-row">
          <div class={styles.Subtitle}>
            <For each={sortedDialogs()}>
              {(dialog, index) => (
                <>
                  <PeerTitleItem dialog={dialog} managers={props.state.getManagers()} />
                  {index() !== sortedDialogs().length - 1 && ', '}
                </>
              )}
            </For>
          </div>
          <Show when={totalUnreadCount() > 0}>
            <Badge class={styles.UnreadBadge} tag="span" size={22} color="gray">
              {formatNumber(totalUnreadCount(), 1)}
            </Badge>
          </Show>
        </div>
      </>
    )
  },
})

type CreateArchiveDialogStateArgs = {
  managers: ArchiveDialogManagers,
  onHasArchiveDialogChanged: (hasDialogs: boolean) => void,
}

export type DisposableArchiveDialogState = ReturnType<typeof createArchiveDialogState>

/** tweb `:125-145` (расхождение 4: без `showArchiveInChatList`) */
export const createArchiveDialogState = ({ managers, onHasArchiveDialogChanged }: CreateArchiveDialogStateArgs) => createRoot((dispose) => {
  const state = useArchivedDialogsState(managers)

  const hasArchiveDialog = createMemo(() => state.sortedDialogs().length > 0)

  createEffect(() => {
    if(!state.isReady()) return
    onHasArchiveDialogChanged(hasArchiveDialog())
  })

  return {
    state,
    hasArchiveDialog,
    dispose,
  }
})

/** tweb `:147-213` (расхождения 1, 2) */
function useArchivedDialogsState(managers: ArchiveDialogManagers) {
  const mirror = subscribeExternal(useChatsStore.subscribe, useChatsStore.getState)

  const [fetchedDialogs, setFetchedDialogs] = createSignal<DialogsPage>()
  let initialPromise: Promise<unknown> | undefined

  const fetchDialogs = () => {
    return initialPromise = managers.dialogs.getDialogs({
      filterId: ARCHIVE_FOLDER_ID,
      limit: ARCHIVE_DIALOG_LIMIT,
    }).then(setFetchedDialogs, () => {
      initialPromise = undefined
    })
  }

  const isReady = createMemo(() => !!fetchedDialogs())
  const fetchedDialogsLength = () => fetchedDialogs()?.dialogs.length ?? 0
  const isEnd = () => !!fetchedDialogs()?.isEnd

  const sortedDialogs = createMemo(() => {
    const { dialogs, dialogIndexById } = mirror()
    return dialogs
    .filter(isDialogArchived)
    .sort((a, b) => (dialogIndexById[b.peerId] ?? 0) - (dialogIndexById[a.peerId] ?? 0))
  })

  createEffect(on(() => sortedDialogs().length, (length, prevLength) => {
    if(
      prevLength !== undefined &&
      length < prevLength &&
      isReady() &&
      !isEnd() &&
      length < fetchedDialogsLength() && // when some dialogs have been removed
      length < ARCHIVE_DIALOG_LIMIT
    ) {
      void fetchDialogs()
    }
  }))

  /** tweb `:194-200`: страница — один раз; без промиса — уже запрошена */
  function ensureHydrated() {
    if(initialPromise) return
    return fetchDialogs()
  }

  const totalUnreadCount = createMemo(() => archiveUnreadCount(mirror().dialogs))

  return {
    // функцией: пропы строки — `createMutable`, а прокси менеджеров стор оборачивать не должен
    getManagers: () => managers,
    totalUnreadCount,
    ensureHydrated,
    isReady,
    sortedDialogs,
  }
}

/** tweb `:382-399` (расхождение 3) */
function PeerTitleItem(props: { dialog: Dialog, managers: PeerTitleManagers }) {
  const middlewareHelper = getMiddleware()
  onCleanup(() => middlewareHelper.destroy())

  const peerTitle = new PeerTitle({
    peerId: props.dialog.peerId,
    limitSymbols,
    middleware: middlewareHelper.get(),
    managers: props.managers,
  })

  createEffect(() => {
    peerTitle.element.classList.toggle(styles.unreadPeerTitle, isDialogUnread(props.dialog))
  })

  return peerTitle.element
}

/** tweb `:402-437` без сегментов историй (расхождение 4) */
function ArchiveAvatar() {
  return (
    <div class="row-media row-media-bigger dialog-avatar">
      <div class={styles.MediaContent}>
        <IconTsx class={styles.MediaIcon} icon="archive_filled" />
      </div>
    </div>
  )
}

export default ArchiveDialog
