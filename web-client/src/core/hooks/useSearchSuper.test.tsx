// Шов «панель профиля ↔ AppSearchSuper» (задача 13 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`, шаги 1-3).
//
// Панель целиком нерендерибельна в vitest (портал, менеджеры, полдюжины
// сторов — то же основание, что у `UserInfoPanel.shell.test.ts`), поэтому
// здесь — харнесс ТОЙ ЖЕ формы, что и панель: хук `useSearchSuper` даёт класс
// и скроллер, а Solid-корень `.profile-content` (НАСТОЯЩИЙ `PeerProfile` через
// `mountSolid`, как в `peerProfileLiveProps.solid.test.tsx`) пересоздаётся на
// каждый `peerId` и получает `searchSuper.container` пропом
// (`sharedMedia.tsx:166`). Что РЕАЛЬНЫЙ файл панели собран именно так, пинует
// `UserInfoPanel.shell.test.ts` балансом скобок; здесь проверяется, что эта
// форма работает: узел класса — один на всю жизнь панели, переезжает в новый
// корень целиком, а после размонтирования от него не остаётся следов (DoD 5).
//
// Пины — на результат (узлы в документе, кто чей ребёнок, сетевой вызов), не
// на форму вызова.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { createSignal } from 'solid-js'
import type { SearchSuperManagers, SearchSuperMediaTab, SearchSuperMediaType } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import rootScope from '@lib/rootScope'
import { mountSolid } from '@shared/solid/mountSolid.solid'

const peerSignal = createSignal<unknown>(undefined)
const fullPeerSignal = createSignal<unknown>(undefined)
vi.mock('@stores/peers.solid', () => ({ usePeer: () => peerSignal[0] }))
vi.mock('@stores/fullPeers.solid', () => ({ useFullPeer: () => fullPeerSignal[0] }))
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { groups: { setMute: vi.fn() } } }),
}))

const { default: PeerProfile } = await import('@components/peerProfile.solid')
const { useSearchSuper } = await import('./useSearchSuper')

const ME: PeerId = 1
const ALICE: PeerId = 2
const BOB: PeerId = 3

type Counts = Partial<Record<'media' | 'files' | 'links' | 'music' | 'voice', number>>

function fakeBackend(countsByPeer: Record<number, Counts>) {
  const counters: { peerId: number; filters: string[] }[] = []
  const managers = {
    messages: {
      mediaHistory: async () => ({ messages: [], count: 0 }),
      searchCounters: async (peerId: number, filters: string[]) => {
        counters.push({ peerId, filters })
        return filters.map((filter) => ({ filter, count: countsByPeer[peerId]?.[filter as keyof Counts] ?? 0 }))
      },
    },
    peers: { fillMirror: async () => {} },
    groups: {
      channelParticipants: async () => ({ _: 'channels.channelParticipants', count: 0, participants: [], chats: [], users: [] }),
    },
    stories: { pinnedStories: async () => [] },
    stars: { profileGifts: async () => [] },
    chats: { savedDialogs: async () => [] },
  } as unknown as SearchSuperManagers
  return { managers, counters }
}

type HarnessProps = {
  peerId: PeerId
  managers: SearchSuperManagers
  onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  onLengthChange?: (type: SearchSuperMediaType, length: number) => void
  /** наружу — чтобы тест видел то же, что видит панель */
  expose: (seam: ReturnType<typeof useSearchSuper>) => void
}

/** Та же форма, что `UserInfoPanel.tsx`: хук ДО эффекта Solid-корня, корень —
 *  keyed на `[peerId, searchSuper]`, узел класса — проп `searchSuperContainer`. */
function Harness({ peerId, managers, onChangeTab, onLengthChange, expose }: HarnessProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const seam = useSearchSuper({ scrollableRef: bodyRef, setCollapsedOnRef: bodyRef, peerId, managers, onChangeTab, onLengthChange })
  expose(seam)
  const searchSuper = seam?.searchSuper ?? null

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !searchSuper) return
    const { dispose } = mountSolid(host, PeerProfile, {
      peerId,
      isDialog: true,
      scrollable: bodyRef.current!,
      setCollapsedOn: bodyRef.current!,
      searchSuperContainer: searchSuper.container,
    })
    return dispose
  }, [peerId, searchSuper])

  return (
    <div ref={bodyRef} className="scrollable scrollable-y">
      <div ref={hostRef} />
    </div>
  )
}

const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
})

beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  applyPeerOps([{
    op: 'upsert',
    peers: [
      { _: 'user', id: ME, first_name: 'Я', pFlags: {} },
      { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
      { _: 'user', id: BOB, first_name: 'Боб', pFlags: {} },
    ],
  }])
  rootScope.myId = ME
})

afterEach(() => {
  cleanup()
  rootScope.myId = 0
  document.body.replaceChildren()
})

function mountHarness(countsByPeer: Record<number, Counts> = { [ALICE]: { media: 2 }, [BOB]: { files: 1 } }) {
  const backend = fakeBackend(countsByPeer)
  let seam: ReturnType<typeof useSearchSuper> = null
  const onChangeTab = vi.fn()
  const onLengthChange = vi.fn()
  const props = { managers: backend.managers, onChangeTab, onLengthChange, expose: (s: typeof seam) => { seam = s } }
  const view = render(<Harness peerId={ALICE} {...props} />)
  return { ...backend, view, props, onChangeTab, onLengthChange, seam: () => seam! }
}

const profileContent = () => document.querySelector<HTMLElement>('.profile-content')

describe('useSearchSuper — шов с Solid-карточкой (шаг 1)', () => {
  it('узел класса — `.search-super`, созданный классом, и он ПОСЛЕДНИЙ ребёнок `.profile-content`', async () => {
    const h = mountHarness()
    await settle()
    const { searchSuper } = h.seam()
    expect(searchSuper.container.classList.contains('search-super')).toBe(true)
    expect(profileContent(), 'Solid-корень смонтирован').not.toBeNull()
    expect(profileContent()!.lastElementChild).toBe(searchSuper.container)
  })

  it('скроллер хозяина стоит ПОВЕРХ узла панели, без обёртки: container — сам bodyRef', async () => {
    const h = mountHarness()
    await settle()
    const { scrollable } = h.seam()
    const body = document.querySelector<HTMLElement>('.scrollable-y')!
    expect(scrollable.container).toBe(body)
    expect(body.querySelector(':scope > .scrollable'), 'new Scrollable(el) переложил бы детей в новый div').toBeNull()
  })

  it('первый показ идёт через класс: кэш пира из sharedMediaHistories, onChangeTab/onLengthChange хоста позваны', async () => {
    const h = mountHarness()
    await settle()
    const { searchSuper } = h.seam()
    expect(searchSuper.historyStorage).toBe(getHistoryStorage(ALICE))
    expect(searchSuper.searchContext.peerId).toBe(ALICE)
    expect(h.counters.map((c) => c.peerId)).toEqual([ALICE])
    expect(h.onChangeTab.mock.calls.map(([t]) => (t as SearchSuperMediaTab).type)).toContain('media')
    expect(h.onLengthChange).toHaveBeenCalledWith('media', 2)
  })

  it('смена peerId: Solid-корень пересоздан, а узел класса — ТОТ ЖЕ и переехал в новый корень целиком (с DOM вкладок)', async () => {
    const h = mountHarness()
    await settle()
    const before = h.seam()
    const oldRoot = profileContent()!
    const mediaContent = before.searchSuper.mediaTabsMap.get('media')!.contentTab!

    h.view.rerender(<Harness peerId={BOB} {...h.props} />)
    await settle()

    const after = h.seam()
    expect(after.searchSuper, 'инстанс класса переживает смену пира').toBe(before.searchSuper)
    const newRoot = profileContent()!
    expect(newRoot, 'корень пересоздан на новый peerId').not.toBe(oldRoot)
    expect(oldRoot.isConnected).toBe(false)
    expect(newRoot.lastElementChild).toBe(before.searchSuper.container)
    expect(mediaContent.isConnected, 'DOM вкладки переехал вместе с узлом').toBe(true)
    expect(newRoot.contains(mediaContent)).toBe(true)
    expect(document.querySelectorAll('.search-super'), 'второго узла класса нет').toHaveLength(1)
    // контекст переключён на нового пира, его кэш — из модульного хранилища
    expect(after.searchSuper.searchContext.peerId).toBe(BOB)
    expect(after.searchSuper.historyStorage).toBe(getHistoryStorage(BOB))
    expect(h.counters.map((c) => c.peerId)).toEqual([ALICE, BOB])
  })

  it('колбэки хоста читаются живыми: новый onLengthChange после rerender получает следующий счётчик', async () => {
    const h = mountHarness()
    await settle()
    const late = vi.fn()
    h.view.rerender(<Harness peerId={ALICE} {...h.props} onLengthChange={late} />)
    h.seam().searchSuper.setCounter('media', 5)
    expect(late).toHaveBeenCalledWith('media', 5)
  })
})

describe('useSearchSuper — владение узлом (шаг 2) и липкость (шаг 3)', () => {
  it('после размонтирования узлов класса в документе нет, класс погашен (destroy), скроллер хозяина тоже', async () => {
    const h = mountHarness()
    await settle()
    const { scrollable, searchSuper } = h.seam()
    // Узел снимает и dispose Solid-корня — поэтому «узлов нет» само по себе не
    // доказывает, что класс убит. Доказывает актуальность: `destroy()` →
    // `cleanup()` → `middleware.clean()` гасит все висящие async-ветки класса.
    const middleware = searchSuper.middleware.get()
    expect(middleware()).toBe(true)
    h.view.unmount()
    expect(document.querySelector('.search-super')).toBeNull()
    expect(document.querySelector('.search-super-tabs-scrollable')).toBeNull()
    expect(middleware(), 'мутация «не звать searchSuper.destroy()» оставила бы класс живым').toBe(false)
    expect(scrollable.onScrolledBottom).toBeUndefined()
    expect(scrollable.onAdditionalScroll).toBeUndefined()
  })

  it('у `.search-super-tabs-scrollable` нет инлайнового top — липкость держит `top: var(--super-offset)` из _searchSuper.scss', async () => {
    const h = mountHarness()
    await settle()
    const nav = h.seam().searchSuper.navScrollableContainer
    expect(nav.classList.contains('search-super-tabs-scrollable')).toBe(true)
    expect(nav.style.top).toBe('')
    expect(nav.getAttribute('style')).toBeNull()
  })
})
