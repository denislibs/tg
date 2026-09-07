// Пины ПЕРВОГО ПОКАЗА вкладок `AppSearchSuper` — `loadFirstTime`, предикаты
// `canView*`, `toggleContainerHidden`/`updateContainerHidden` (порт tweb
// `src/components/appSearchSuper.ts:2380-2529`, `:2611-2712`; разбор —
// `docs/tweb/shared-media.md` § 1.7).
//
// Предмет проверок — ФАКТ: классы на узлах ряда, какая вкладка активна, сколько
// запросов ушло. «Менеджер позван с такими аргументами» не проверяется нигде.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, {
  type SearchSuperManagers,
  type SearchSuperMediaTab,
  type SearchSuperMediaType,
} from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import rootScope from '@lib/rootScope'
import type { LangPackKey } from '@lib/langPack'

const ME: PeerId = 1
const ALICE: PeerId = 2
/** Обычная группа (`chat`): участников видит любой участник. */
const GROUP: PeerId = -77
/** Вещательный канал: список участников закрыт (`view_participants` ложен). */
const CHANNEL: PeerId = -88
/** Группа, которую я покинул: не канал, но прав уже нет (`hasRights`, ветка `left`). */
const LEFT_GROUP: PeerId = -99

type Counts = Partial<Record<'media' | 'files' | 'links' | 'music' | 'voice', number>>

type World = {
  counts?: Counts
  pinnedStories?: number
  gifts?: number
  savedDialogs?: number
}

function fakeBackend(world: World) {
  const counters: string[][] = []
  const history: string[] = []
  const managers = {
    messages: {
      mediaHistory: async (_peerId: number, filter: string) => {
        history.push(filter)
        return { messages: [], count: world.counts?.[filter as keyof Counts] ?? 0 }
      },
      searchCounters: async (_peerId: number, filters: string[]) => {
        counters.push(filters)
        return filters.map((filter) => ({ filter, count: world.counts?.[filter as keyof Counts] ?? 0 }))
      },
    },
    peers: { fillMirror: async () => {} },
    // первый показ у группы открывает «Участники» и тут же их грузит (задача 11):
    // пустой список — предмет этого файла лишь в том, КАКАЯ вкладка выбрана
    groups: {
      channelParticipants: async () => ({ _: 'channels.channelParticipants', count: 0, participants: [], chats: [], users: [] }),
    },
    stories: {
      pinnedStories: async () => Array.from({ length: world.pinnedStories ?? 0 }, (_, i) => ({ id: i + 1 })),
    },
    stars: {
      profileGifts: async () => Array.from({ length: world.gifts ?? 0 }, (_, i) => ({ id: i + 1 })),
    },
    chats: {
      savedDialogs: async () => Array.from({ length: world.savedDialogs ?? 0 }, (_, i) => ({ peerId: i + 10 })),
    },
  } as unknown as SearchSuperManagers
  return { managers, counters, history }
}

/** Набор правой колонки в порядке оригинала (`sharedMedia.tsx:604-648`). */
function makeMediaTabs(types: SearchSuperMediaType[]): SearchSuperMediaTab[] {
  const all: SearchSuperMediaTab[] = [
    { type: 'savedDialogs', name: 'SavedDialogsTab' as LangPackKey },
    { type: 'stories', name: 'Stories' as LangPackKey },
    { type: 'members', name: 'PeerMedia.Members' as LangPackKey },
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
    { type: 'links', inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2' as LangPackKey },
    { type: 'gifts', name: 'SharedMedia.Gifts' as LangPackKey },
  ]
  return all.filter((tab) => types.includes(tab.type))
}

const MEDIA_ONLY: SearchSuperMediaType[] = ['media', 'files', 'links']
const FULL: SearchSuperMediaType[] = ['savedDialogs', 'stories', 'members', 'media', 'files', 'links', 'gifts']

let host: HTMLElement

function build(world: World, peerId: PeerId, types: SearchSuperMediaType[] = FULL, options: { hideEmptyTabs?: boolean } = {}) {
  const backend = fakeBackend(world)
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({ mediaTabs: makeMediaTabs(types), scrollable, managers: backend.managers, ...options })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId, historyStorage: getHistoryStorage(peerId) })
  return { searchSuper, ...backend }
}

const tab = (searchSuper: AppSearchSuper, type: SearchSuperMediaType) => searchSuper.mediaTabsMap.get(type)!.menuTab!
const hidden = (searchSuper: AppSearchSuper, type: SearchSuperMediaType) => tab(searchSuper, type).classList.contains('hide')
const visibleTypes = (searchSuper: AppSearchSuper) =>
  searchSuper.mediaTabs.filter((t) => !t.menuTab!.classList.contains('hide')).map((t) => t.type)

beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  applyPeerOps([{
    op: 'upsert',
    peers: [
      { _: 'user', id: ME, first_name: 'Я', pFlags: {} },
      { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
      {
        _: 'chat', id: 77, title: 'Кружок', photo: { _: 'chatPhotoEmpty' }, participants_count: 2, date: 1,
        default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 },
      },
      {
        _: 'channel', id: 88, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 1, pFlags: { broadcast: true },
        default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 },
      },
      {
        _: 'chat', id: 99, title: 'Бывший кружок', photo: { _: 'chatPhotoEmpty' }, participants_count: 2, date: 1,
        pFlags: { left: true },
        default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 },
      },
    ],
  }])
  rootScope.myId = ME
})

afterEach(() => {
  rootScope.myId = 0
  document.body.replaceChildren()
})

describe('AppSearchSuper: первый показ вкладок — счётчики и видимость (tweb :2380-2513)', () => {
  it('счётчики всех медиа-вкладок берутся ОДНИМ запросом; нулевая вкладка получает hide, но остаётся в DOM', async() => {
    const { searchSuper, counters, history } = build({ counts: { files: 3, links: 2 } }, ALICE, MEDIA_ONLY)

    await searchSuper.load(true)

    // один batch на все три фильтра, а не по запросу на вкладку
    expect(counters).toEqual([['media', 'files', 'links']])
    // за содержимым сходили только ради ВЫБРАННОЙ вкладки
    expect(history).toEqual(['files'])

    expect(hidden(searchSuper, 'media')).toBe(true)
    expect(tab(searchSuper, 'media').parentElement).toBe(searchSuper.nav)
    expect(hidden(searchSuper, 'files')).toBe(false)
    expect(hidden(searchSuper, 'links')).toBe(false)

    // счётчики легли в поле ещё до загрузки содержимого
    expect(searchSuper.counters).toMatchObject({ media: 0, files: 3, links: 2 })
  })

  it('у пользователя первой открывается первая НЕПУСТАЯ медиа-вкладка', async() => {
    const { searchSuper } = build({ counts: { links: 5 } }, ALICE, MEDIA_ONLY)

    await searchSuper.load(true)

    expect(searchSuper.mediaTab.type).toBe('links')
    expect(tab(searchSuper, 'links').classList.contains('active')).toBe(true)
    expect(tab(searchSuper, 'media').classList.contains('active')).toBe(false)
    expect(searchSuper.container.classList.contains('hide')).toBe(false)
    expect(host.classList.contains('search-empty')).toBe(false)
  })

  it('единственная видимая вкладка: у ряда is-single, градиент скрыт; две — ни того, ни другого', async() => {
    const single = build({ counts: { files: 1 } }, ALICE, MEDIA_ONLY)
    await single.searchSuper.load(true)
    expect(single.searchSuper.navScrollableContainer.classList.contains('is-single')).toBe(true)
    expect(single.searchSuper.menuGradient.classList.contains('hide')).toBe(true)

    const pair = build({ counts: { files: 1, links: 1 } }, ALICE, MEDIA_ONLY)
    await pair.searchSuper.load(true)
    expect(pair.searchSuper.navScrollableContainer.classList.contains('is-single')).toBe(false)
    expect(pair.searchSuper.menuGradient.classList.contains('hide')).toBe(false)
  })

  it('показывать нечего: все строки ряда со hide, подсистема скрыта, родитель помечен search-empty', async() => {
    const { searchSuper } = build({}, ALICE, MEDIA_ONLY)

    await searchSuper.load(true)

    expect(visibleTypes(searchSuper)).toEqual([])
    expect(searchSuper.container.classList.contains('hide')).toBe(true)
    expect(host.classList.contains('search-empty')).toBe(true)
  })

  it('второй load счётчики не перезапрашивает; после setQuery (смена пира) — снова один запрос', async() => {
    const { searchSuper, counters } = build({ counts: { files: 3 } }, ALICE, MEDIA_ONLY)

    await searchSuper.load(true)
    await searchSuper.load(true)
    expect(counters).toHaveLength(1)

    searchSuper.setQuery({ peerId: ME, historyStorage: getHistoryStorage(ME) })
    await searchSuper.load(true)
    expect(counters).toHaveLength(2)
  })

  it('hideEmptyTabs=false (левая колонка): ни запроса за счётчиками, ни hide', async() => {
    const { searchSuper, counters } = build({}, ALICE, MEDIA_ONLY, { hideEmptyTabs: false })

    await searchSuper.load(true)

    expect(counters).toEqual([])
    expect(visibleTypes(searchSuper)).toEqual(MEDIA_ONLY)
  })
})

describe('AppSearchSuper: приоритет первой открытой вкладки (tweb :2478-2495)', () => {
  it('у группы первой открывается «Участники» — даже при непустых медиа и историях', async() => {
    const { searchSuper } = build({ counts: { media: 9 }, pinnedStories: 2 }, GROUP)

    await searchSuper.load(true)

    expect(searchSuper.mediaTab.type).toBe('members')
    expect(hidden(searchSuper, 'members')).toBe(false)
    expect(tab(searchSuper, 'members').classList.contains('active')).toBe(true)
  })

  it('canViewMembers ложен для канала и для пользователя: вкладка спрятана, первая — непустая медиа', async() => {
    const channel = build({ counts: { media: 9 } }, CHANNEL)
    await channel.searchSuper.load(true)
    expect(hidden(channel.searchSuper, 'members')).toBe(true)
    expect(channel.searchSuper.mediaTab.type).toBe('media')

    const user = build({ counts: { media: 9 } }, ALICE)
    await user.searchSuper.load(true)
    expect(hidden(user.searchSuper, 'members')).toBe(true)
    expect(user.searchSuper.mediaTab.type).toBe('media')

    // не канал, но права нет: покинутая группа — ветка `left` в `hasRights`
    const left = build({ counts: { media: 9 } }, LEFT_GROUP)
    await left.searchSuper.load(true)
    expect(hidden(left.searchSuper, 'members')).toBe(true)
    expect(left.searchSuper.mediaTab.type).toBe('media')
  })

  it('истории пользователя перебивают непустые медиа; без историй вкладка спрятана', async() => {
    const withStories = build({ counts: { media: 9 }, pinnedStories: 1 }, ALICE)
    await withStories.searchSuper.load(true)
    expect(withStories.searchSuper.mediaTab.type).toBe('stories')
    expect(hidden(withStories.searchSuper, 'stories')).toBe(false)

    const without = build({ counts: { media: 9 } }, ALICE)
    await without.searchSuper.load(true)
    expect(hidden(without.searchSuper, 'stories')).toBe(true)
    expect(without.searchSuper.mediaTab.type).toBe('media')
  })

  it('«Чаты» (savedDialogs) видны только в своём профиле и открываются первыми', async() => {
    const mine = build({ counts: { media: 9 }, savedDialogs: 3 }, ME)
    await mine.searchSuper.load(true)
    expect(hidden(mine.searchSuper, 'savedDialogs')).toBe(false)
    expect(mine.searchSuper.mediaTab.type).toBe('savedDialogs')

    const alice = build({ counts: { media: 9 }, savedDialogs: 3 }, ALICE)
    await alice.searchSuper.load(true)
    expect(hidden(alice.searchSuper, 'savedDialogs')).toBe(true)
  })

  it('подарки: вкладка видна при ненулевом числе, первой становится лишь когда больше нечего показать', async() => {
    const onlyGifts = build({ gifts: 4 }, ALICE)
    await onlyGifts.searchSuper.load(true)
    expect(hidden(onlyGifts.searchSuper, 'gifts')).toBe(false)
    expect(onlyGifts.searchSuper.mediaTab.type).toBe('gifts')
    expect(onlyGifts.searchSuper.counters.gifts).toBe(4)
    expect(onlyGifts.searchSuper.container.classList.contains('hide')).toBe(false)

    const withMedia = build({ counts: { files: 1 }, gifts: 4 }, ALICE)
    await withMedia.searchSuper.load(true)
    expect(withMedia.searchSuper.mediaTab.type).toBe('files')
    expect(visibleTypes(withMedia.searchSuper)).toEqual(['files', 'gifts'])

    const none = build({ counts: { files: 1 } }, ALICE)
    await none.searchSuper.load(true)
    expect(hidden(none.searchSuper, 'gifts')).toBe(true)
  })
})

describe('AppSearchSuper: updateContainerHidden (tweb :2521-2529)', () => {
  it('активная вкладка пропала — переключение на первую видимую; пропали все — search-empty', async() => {
    const { searchSuper } = build({ counts: { files: 1, links: 1 } }, ALICE, MEDIA_ONLY)
    await searchSuper.load(true)
    expect(searchSuper.mediaTab.type).toBe('files')

    // вкладка обнулилась живым апдейтом (так делает счётчик подарков, `tweb:2151-2154`)
    tab(searchSuper, 'files').classList.add('hide')
    tab(searchSuper, 'files').classList.remove('active')
    searchSuper.updateContainerHidden(true)

    expect(searchSuper.mediaTab.type).toBe('links')
    expect(searchSuper.navScrollableContainer.classList.contains('is-single')).toBe(true)
    expect(searchSuper.menuGradient.classList.contains('hide')).toBe(true)
    expect(host.classList.contains('search-empty')).toBe(false)

    tab(searchSuper, 'links').classList.add('hide')
    searchSuper.updateContainerHidden(true)

    expect(searchSuper.container.classList.contains('hide')).toBe(true)
    expect(host.classList.contains('search-empty')).toBe(true)
  })
})
