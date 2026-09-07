// Пины разметки и очистки ядра `AppSearchSuper` (`components/appSearchSuper.ts`,
// порт tweb `src/components/appSearchSuper.ts`).
//
// Эталон — не «как у нас получилось», а ЖИВОЙ ДАМП Telegram
// `docs/tweb/dom/dumps/07-right-sidebar.json:120-310`: каждое утверждение ниже
// сверено с конкретной строкой дампа, номер указан рядом.
//
// Все зависимости настоящие: реальный `Scrollable`, реальная `horizontalMenu`
// с реальным `TransitionSlider` внутри, реальные `ripple`/`i18n`/`Section`.
// Подменять их дублёрами здесь нельзя — предмет проверки ровно в том, какое
// дерево они втроём складывают.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import type { LangPackKey } from '@lib/langPack'

/**
 * Набор вкладок — подмножество боевого литерала tweb `sharedMedia.tsx:604-648`
 * в его порядке: `savedDialogs`, `members`, `media`, `gifts`, `files`, `links`,
 * `music`, `voice`. Взяты и «секционные», и «бессекционные» типы — развилка
 * `noSectionTypes` (`tweb:543-546`) проверяется на живом наборе.
 */
function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'savedDialogs', name: 'Chats' as LangPackKey },
    { type: 'members', name: 'Members' as LangPackKey },
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'gifts', name: 'Gifts' as LangPackKey },
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
    { type: 'links', inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2' as LangPackKey },
    { type: 'music', inputFilter: 'inputMessagesFilterMusic', name: 'SharedMusicTab2' as LangPackKey },
    { type: 'voice', inputFilter: 'inputMessagesFilterRoundVoice', name: 'SharedVoiceTab2' as LangPackKey },
  ]
}

/**
 * Ядро в сеть не ходит: эти тесты про разметку и скролл, и загрузку они не
 * запускают вовсе. Ручки — обязательные (`AppSearchSuperOptions`), поэтому
 * стоят заглушки, которые обязаны остаться НЕПОЗВАННЫМИ.
 */
const IDLE_MANAGERS = {
  messages: {
    mediaHistory: () => { throw new Error('ядро не грузит данные') },
    searchCounters: () => { throw new Error('ядро не грузит данные') },
  },
} as unknown as SearchSuperManagers

let scrollable: Scrollable
let host: HTMLElement

function build(options?: { hideEmptyTabs?: boolean }) {
  // Профиль скроллится ОДНИМ контейнером снаружи (tweb `:406`), подсистема
  // лежит внутри него отдельным узлом-хостом — так же, как `.profile-content`
  // в `peerProfile.tsx:121,211`.
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  scrollable = new Scrollable(scrollableEl)

  host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({
    mediaTabs: makeMediaTabs(),
    scrollable,
    managers: IDLE_MANAGERS,
    ...options,
  })
  host.append(searchSuper.container)
  return searchSuper
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('AppSearchSuper: разметка подсистемы', () => {
  it('корень, градиент, липкий ряд и контейнер вкладок — в порядке дампа :120-125,:197', () => {
    const searchSuper = build()
    const root = searchSuper.container

    expect(root.className).toBe('search-super')

    const children = Array.from(root.children) as HTMLElement[]
    expect(children).toHaveLength(3)

    // :121-122 — градиент двумя узлами, вложенными друг в друга
    expect(children[0].className).toBe('menu-horizontal-gradient-container search-super-tabs-gradient-container')
    expect(children[0].children).toHaveLength(1)
    expect((children[0].firstElementChild as HTMLElement).className)
      .toBe('menu-horizontal-gradient menu-horizontal-gradient-color-background search-super-tabs-gradient')

    // :123 — липкий ряд; `sticky` тут КЛАСС, а не инлайновый стиль:
    // позицию задаёт `styles/tweb/_searchSuper.scss:19-25` (`top: var(--super-offset)`),
    // и инлайн его перебивать не должен (наш дефект P1 из `docs/tweb/shared-media.md` § 2.3)
    expect(children[1]).toBe(searchSuper.navScrollableContainer)
    expect(children[1].className).toBe('search-super-tabs-scrollable menu-horizontal-scrollable sticky')
    expect(children[1].getAttribute('style')).toBeNull()

    // :124-125 — ScrollableX внутри липкого ряда, в нём nav
    const navScrollable = children[1].firstElementChild as HTMLElement
    expect(navScrollable.className).toBe('scrollable scrollable-x search-super-nav-scrollable')
    expect(navScrollable.firstElementChild).toBe(searchSuper.nav)
    expect(searchSuper.nav.tagName).toBe('NAV')
    expect(searchSuper.nav.className).toBe('search-super-tabs menu-horizontal-div')

    // :197 — контейнер содержимого
    expect(children[2]).toBe(searchSuper.tabsContainer)
    expect(children[2].className).toBe('search-super-tabs-container tabs-container')
  })

  it('строка ряда: ripple, подчёркивание, название — именно в этом порядке (дамп :126-130)', () => {
    const searchSuper = build()
    const items = Array.from(searchSuper.nav.children) as HTMLElement[]
    expect(items).toHaveLength(8)

    const first = items[0]
    expect(first.classList.contains('menu-horizontal-div-item')).toBe(true)
    // `rp` вешает сам `ripple()` — дамп :126
    expect(first.classList.contains('rp')).toBe(true)

    const inner = Array.from(first.children) as HTMLElement[]
    expect(inner.map((el) => `${el.tagName.toLowerCase()}.${el.className}`)).toEqual([
      'div.c-ripple',
      'i.menu-horizontal-div-item-background',
      'span.menu-horizontal-div-item-span',
    ])

    // :130 — название лежит ВНУТРИ span'а и это узел i18n, а не голый текст
    const name = inner[2].firstElementChild as HTMLElement
    expect(name.classList.contains('i18n')).toBe(true)
    expect(searchSuper.mediaTabs[0].menuTabName).toBe(name)
    expect(searchSuper.mediaTabs[0].menuTab).toBe(first)
  })

  it('у каждой вкладки свой контейнер с типом в классе (дамп :198,:204,:246,:252)', () => {
    const searchSuper = build()
    const containers = Array.from(searchSuper.tabsContainer.children) as HTMLElement[]
    expect(containers.map((el) => el.className)).toEqual([
      'search-super-tab-container search-super-container-savedDialogs tabs-tab',
      'search-super-tab-container search-super-container-members tabs-tab',
      'search-super-tab-container search-super-container-media tabs-tab',
      'search-super-tab-container search-super-container-gifts tabs-tab',
      'search-super-tab-container search-super-container-files tabs-tab',
      'search-super-tab-container search-super-container-links tabs-tab',
      'search-super-tab-container search-super-container-music tabs-tab',
      'search-super-tab-container search-super-container-voice tabs-tab',
    ])

    containers.forEach((container, i) => {
      const content = container.firstElementChild as HTMLElement
      expect(content).toBe(searchSuper.mediaTabs[i].contentTab)
      expect(content.className)
        .toBe('search-super-content-container search-super-content-' + searchSuper.mediaTabs[i].type)
    })
  })

  it('вкладка media получает грид и НЕ получает карточку секции (дамп :246-248)', () => {
    const searchSuper = build()
    const media = searchSuper.mediaTabs[2]

    expect(media.hideOn).toBeUndefined()
    expect(media.itemsTab!.className).toBe('search-super-content-media-grid')
    expect(media.itemsTab!.parentElement).toBe(media.contentTab)
    // рендер кладёт элементы именно в грид, а не в контейнер содержимого
    expect(searchSuper.tabs.inputMessagesFilterPhotoVideo).toBe(media.itemsTab)
  })

  it('типы вне noSectionTypes получают СКРЫТУЮ карточку Section (дамп :260-265)', () => {
    const searchSuper = build()

    // В noSectionTypes (tweb :543-546) из нашего набора попадают только `media`
    // и `gifts`. `savedDialogs` в набор НЕ входит (там `chats` — другой тип) и
    // карточку получает — дамп :198-203 это и показывает.
    expect(searchSuper.mediaTabs[2].hideOn).toBeUndefined()
    expect(searchSuper.mediaTabs[3].hideOn).toBeUndefined()
    expect(searchSuper.mediaTabs[0].hideOn).toBeDefined()

    const files = searchSuper.mediaTabs[4]
    const hideOn = files.hideOn!
    expect(hideOn.className).toBe('sidebar-left-section-container hide')
    expect(hideOn.parentElement).toBe(files.contentTab)

    const card = hideOn.firstElementChild as HTMLElement
    expect(card.className).toBe('sidebar-left-section no-delimiter')
    const cardContent = card.firstElementChild as HTMLElement
    expect(cardContent.className).toBe('sidebar-left-section-content')
    // список элементов — голый div ВНУТРИ карточки (дамп :265)
    expect(cardContent.firstElementChild).toBe(files.itemsTab)
    expect(files.itemsTab!.className).toBe('')
    expect(searchSuper.tabs.inputMessagesFilterDocument).toBe(files.itemsTab)
  })

  it('карта «тип → вкладка» и стартовая вкладка — первая из списка (tweb :491,:791)', () => {
    const searchSuper = build()
    expect(searchSuper.mediaTabsMap.get('links')).toBe(searchSuper.mediaTabs[5])
    expect(searchSuper.mediaTabsMap.size).toBe(8)
    expect(searchSuper.mediaTab).toBe(searchSuper.mediaTabs[0])
  })
})

describe('AppSearchSuper: cleanupHTML', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('вычищает списки, возвращает hide на карточки и ставит прелоадер вкладкам без кэша', () => {
    const searchSuper = build()

    // как будто вкладки уже отрисованы
    searchSuper.mediaTabs.forEach((tab) => {
      tab.itemsTab!.append(document.createElement('div'))
      tab.hideOn?.classList.remove('hide')
    })
    scrollable.scrollPosition = 240

    // у `links` кэш уже есть — прелоадер ей ставить нельзя (tweb :2779)
    searchSuper.historyStorage.inputMessagesFilterUrl = []

    searchSuper.cleanupHTML()

    searchSuper.mediaTabs.forEach((tab) => {
      expect(tab.itemsTab!.childElementCount).toBe(0)
      if(tab.hideOn) expect(tab.hideOn.classList.contains('hide')).toBe(true)
    })

    const preloaderOf = (tab: SearchSuperMediaTab) =>
      tab.contentTab!.parentElement!.querySelector('.preloader')

    // прелоадер — СОСЕДОМ контейнера содержимого, внутри контейнера вкладки (дамп :249-251)
    const media = preloaderOf(searchSuper.mediaTabs[2])
    expect(media).not.toBeNull()
    expect(media!.parentElement).toBe(searchSuper.mediaTabs[2].contentTab!.parentElement)
    expect(media!.querySelector('svg.preloader-circular circle.preloader-path')).not.toBeNull()

    expect(preloaderOf(searchSuper.mediaTabs[5])).toBeNull() // links — кэш есть
    expect(preloaderOf(searchSuper.mediaTabs[0])).toBeNull() // savedDialogs — без inputFilter

    expect(scrollable.scrollPosition).toBe(0)
  })

  it('второй вызов не плодит второй прелоадер (tweb :2782)', () => {
    const searchSuper = build()
    searchSuper.cleanupHTML()
    searchSuper.cleanupHTML()

    const parent = searchSuper.mediaTabs[2].contentTab!.parentElement!
    expect(parent.querySelectorAll('.preloader')).toHaveLength(1)
  })

  it('при hideEmptyTabs прячет подсистему и метит родителя (tweb :2771-2775)', () => {
    const searchSuper = build()
    searchSuper.cleanupHTML()

    expect(searchSuper.container.classList.contains('hide')).toBe(true)
    expect(host.classList.contains('search-empty')).toBe(true)
  })

  it('при hideEmptyTabs=false не прячет ничего', () => {
    const searchSuper = build({ hideEmptyTabs: false })
    searchSuper.cleanupHTML()

    expect(searchSuper.container.classList.contains('hide')).toBe(false)
    expect(host.classList.contains('search-empty')).toBe(false)
  })
})

describe('AppSearchSuper: cleanup и setQuery', () => {
  it('cleanup помечает кэш неиспользованным, но САМ КЭШ НЕ ТРОГАЕТ (tweb :2726-2732)', () => {
    const searchSuper = build()
    const cached = [{ mid: 7, peerId: 1 }]
    searchSuper.historyStorage.inputMessagesFilterPhotoVideo = cached
    searchSuper.usedFromHistory.inputMessagesFilterPhotoVideo = 1

    searchSuper.cleanup()

    expect(searchSuper.usedFromHistory.inputMessagesFilterPhotoVideo).toBe(-1)
    expect(searchSuper.historyStorage.inputMessagesFilterPhotoVideo).toBe(cached)
    expect(searchSuper.historyStorage.inputMessagesFilterPhotoVideo).toHaveLength(1)
    // у вкладок без фильтра пометки не появляется
    expect(Object.keys(searchSuper.usedFromHistory).sort()).toEqual([
      'inputMessagesFilterDocument',
      'inputMessagesFilterMusic',
      'inputMessagesFilterPhotoVideo',
      'inputMessagesFilterRoundVoice',
      'inputMessagesFilterUrl',
    ])
  })

  it('cleanup обнуляет запомненные позиции скролла', () => {
    const searchSuper = build()
    searchSuper.mediaTabs[0].scroll = { scrollTop: 120, scrollHeight: 900 }

    searchSuper.cleanup()

    expect(searchSuper.mediaTabs.every((tab) => tab.scroll === undefined)).toBe(true)
  })

  it('setQuery пересобирает контекст, подменяет кэш на внешний и чистит состояние', () => {
    const searchSuper = build()
    searchSuper.historyStorage.inputMessagesFilterPhotoVideo = [{ mid: 1, peerId: 1 }]
    searchSuper.usedFromHistory.inputMessagesFilterPhotoVideo = 1

    const outer = { inputMessagesFilterDocument: [{ mid: 5, peerId: 2 }] }
    searchSuper.setQuery({ peerId: 777, threadId: 3, historyStorage: outer })

    expect(searchSuper.searchContext).toEqual({
      peerId: 777,
      query: '',
      // стартовая вкладка `savedDialogs` фильтра не имеет — контекст честно несёт undefined
      inputFilter: { _: undefined },
      threadId: 3,
      folderId: undefined,
      minDate: undefined,
      maxDate: undefined,
    })
    // кэш ПОДМЕНЁН на переданный снаружи, а не слит с прежним
    expect(searchSuper.historyStorage).toBe(outer)
    expect(searchSuper.historyStorage.inputMessagesFilterPhotoVideo).toBeUndefined()
    // и cleanup отработал
    expect(searchSuper.usedFromHistory.inputMessagesFilterPhotoVideo).toBe(-1)
  })

  it('без historyStorage снаружи кэш становится пустым (tweb :2822)', () => {
    const searchSuper = build()
    searchSuper.historyStorage.inputMessagesFilterUrl = [{ mid: 2, peerId: 3 }]

    searchSuper.setQuery({ peerId: 1 })

    expect(searchSuper.historyStorage).toEqual({})
  })
})

describe('AppSearchSuper: destroy', () => {
  it('снимает узлы из DOM и перестаёт слушать клики по ряду вкладок', () => {
    const searchSuper = build()
    const items = Array.from(searchSuper.nav.children) as HTMLElement[]
    const contents = Array.from(searchSuper.tabsContainer.children) as HTMLElement[]
    const first = searchSuper.mediaTab

    searchSuper.destroy()

    expect(searchSuper.container.parentElement).toBeNull()
    expect(host.contains(searchSuper.container)).toBe(false)

    // Клик после destroy не переключает вкладку — слушателя больше нет.
    // Смотрим на СОДЕРЖИМОЕ (его слайдер помечает `active` синхронно, первый
    // переход всегда без анимации), а не на строку ряда: там класс переставляет
    // `fastRaf`, и в тесте он до проверки просто не успел бы.
    items[3].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(contents.some((el) => el.classList.contains('active'))).toBe(false)
    expect(searchSuper.mediaTab).toBe(first)
  })
})
