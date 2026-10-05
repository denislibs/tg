/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/chatTips/chatsCard.tsx` (812502980) — карточка «Чаты» пустой
 * колонки (Б-13 бэклога волны 7): сетка пиров под фильтрами «найденные» / «закрытые».
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *  1. Фильтра «Popular» (`'popular'`, топ собеседников `appUsersManager.getTopPeers`,
 *     `:43-45`) нет: ручки топа собеседников у нас нет (расхождение 46
 *     `components/appSearchSuper.ts`). Вместе с ним нет и единственного запроса карточки —
 *     она готова сразу, а «пусто» не ждёт загрузки (`topPeers.loading`, `:63`, `:67`).
 *  2. Списки — ключи State в zustand (`useAppStateStore`), переведённые в сигнал, как у
 *     «Recent» поиска (`appSearchSuper.ts`, расхождение 44); ключ пира там строка
 *     (`core/state/state.ts`).
 *  3. Плитка — `renderTopPeerItem` (`components/topPeersList.ts`) с менеджерами вкладки
 *     (`getProxiedManagers()`); её собственные расхождения — в шапке того файла.
 */
import { createEffect, createMemo, createRoot, createSignal, on, onCleanup, Show } from 'solid-js'
import anchorCallback from '@helpers/dom/anchorCallback'
import createMiddleware from '@helpers/solid/createMiddleware'
import classNames from '@helpers/string/classNames'
import { IS_APPLE } from '@environment/userAgent'
import { i18n, type LangPackKey } from '@lib/langPack'
import type { IconName } from '@core/tgico-icons'
import type { AppState } from '@core/state/state'
import { useAppStateStore } from '@stores/appState'
import { getProxiedManagers } from '@/client/bootstrap'
import appDialogsManager from '@lib/appDialogsManager'
import appSidebarLeft from '@components/sidebarLeft'
import { renderTopPeerItem } from '@components/topPeersList'
import TipCard, { useTipReady, type TipCardButton } from './tipCard.solid'
import styles from './chatTips.module.scss'

/** macOS lays the peers out as a 4×2 grid inside the content slot. */
const PEERS_LIMIT = 8

export type ChatsFilter = 'recent' | 'closed'

// Расхождение 1: без `['popular', 'newprivate', 'ChatTips.Chats.Popular']`.
const FILTERS: [ChatsFilter, IconName, LangPackKey][] = [
  ['recent', 'search', 'ChatTips.Chats.RecentSearch'],
  ['closed', 'close', 'ChatTips.Chats.RecentlyClosed'],
]

// Module-level so the picked filter is shared by the card wherever it is re-created.
const [filter, setFilter] = createRoot(() => createSignal<ChatsFilter>('recent'))

/** Ключ State под фильтром (расхождение 2). */
const STATE_KEYS: Record<ChatsFilter, keyof Pick<AppState, 'recentSearch' | 'recentlyClosedChats'>> = {
  recent: 'recentSearch',
  closed: 'recentlyClosedChats',
}

/**
 * Chats tip — macOS' `WidgetRecentPeersController`: a filter row over a 4×2 grid of peers to jump
 * back into. Here the filters are the ones last searched for, and the ones whose chat was last
 * closed (recorded by `contacts.pushRecentlyClosedChat`, see `appImManager`).
 */
export default function ChatsTipCard() {
  // Расхождение 2: зеркало State — сигналом
  const [appState, setAppState] = createSignal(useAppStateStore.getState())
  onCleanup(useAppStateStore.subscribe((state) => setAppState(state)))

  const listOf = (value: ChatsFilter): PeerId[] =>
    (appState()[STATE_KEYS[value]] ?? []).map((key) => +key)

  // macOS only offers a filter that has something behind it, and moves off one that empties out.
  const available = createMemo(() => FILTERS.filter(([value]) => listOf(value).length))
  const current = createMemo<ChatsFilter>(() => {
    const list = available()
    return list.some(([value]) => value === filter()) ? filter() : list[0]?.[0] ?? filter()
  })

  // Сравнение по составу — расхождение 2: сигнал зеркала меняется от записи ЛЮБОГО ключа State,
  // и без него сетка пересобиралась бы на каждую (у tweb стор гранулярен по ключу).
  const peerIds = createMemo<PeerId[]>(() => listOf(current()).slice(0, PEERS_LIMIT), [], {
    equals: (a, b) => a.length === b.length && a.every((peerId, i) => peerId === b[i]),
  })

  const isEmpty = () => !peerIds().length

  // Расхождение 1: запроса нет — готова сразу.
  useTipReady()()

  const buttons = (): TipCardButton[] => available().map(([value, icon, langKey]) => ({
    icon,
    text: i18n(langKey),
    selected: current() === value,
    onClick: () => setFilter(value),
  }))

  // The tiles are the left sidebar search's own "people" items, built by the shared renderer so
  // avatar, title and ripple match it exactly. Each pass gets a fresh middleware so the previous
  // batch is torn down.
  let peersEl: HTMLDivElement | undefined

  // Opening a peer is the list's job, not the tile's: `addDialogNew` builds the row, and it is
  // `setListClickListener` on the container that turns a press into `setPeer`. The search's
  // groups get this from `createSearchGroup`; the grid is ours, so wire it here — on the ref
  // rather than in `onMount`, because the grid only exists once there is something to put in it,
  // the empty state replaces it.
  const bindPeersList = (el: HTMLDivElement) => {
    peersEl = el
    appDialogsManager.setListClickListener({ list: el, autonomous: true })
  }

  createEffect(on(peerIds, (ids) => {
    if(!peersEl) return

    peersEl.replaceChildren()

    const middleware = createMiddleware()
    onCleanup(() => middleware.destroy())

    const managers = getProxiedManagers()
    ids.forEach((peerId) => renderTopPeerItem({
      peerId,
      container: peersEl!,
      middleware: middleware.get(),
      managers,
    }))
  }))

  return (
    <TipCard
      title={i18n('ChatTips.Chats')}
      buttons={buttons()}
      description={i18n(IS_APPLE ? 'ChatTips.Chats.DescriptionMac' : 'ChatTips.Chats.Description', [
        // Search lives under the slider, so a settings tab left open would cover it.
        anchorCallback(async() => {
          await appSidebarLeft.closeAllTabsNaturally()
          appSidebarLeft.initSearch().open()
        }),
      ])}
    >
      <Show
        when={!isEmpty()}
        fallback={<div class={styles.empty}>{i18n('ChatTips.Chats.Empty')}</div>}
      >
        {/* `search-group-people` is what turns the search's row items into the vertical
            avatar-over-name tiles — reuse that instead of restyling them here. */}
        <div class={classNames(styles.peers, 'search-group-people')} ref={bindPeersList} />
      </Show>
    </TipCard>
  )
}
