// Пины разметки и очистки ядра `AppSearchSuper` (`components/appSearchSuper.ts`,
// порт tweb `src/components/appSearchSuper.ts`).
//
// Эталон — не «как у нас получилось», а ЖИВОЙ ДАМП Telegram
// `docs/tweb/dom/dumps/07-right-sidebar.json:121-308`: каждое утверждение ниже
// сверено с конкретной строкой дампа, номер указан рядом. Дамп — ОДНА
// физическая строка JSON, поэтому нумерация везде по РАЗВЁРНУТОМУ тексту
// (`json.load(...).split('\n')`), начиная с первой строки.
//
// Все зависимости настоящие: реальный `Scrollable`, реальная `horizontalMenu`
// с реальным `TransitionSlider` внутри, реальные `ripple`/`i18n`/`Section`.
// Подменять их дублёрами здесь нельзя — предмет проверки ровно в том, какое
// дерево они втроём складывают.
//
// ЕДИНСТВЕННАЯ подмена — обёртка вокруг настоящего `createRoot` из `solid-js`
// (ниже): она ничего не меняет в поведении, только считает открытые и закрытые
// корни. Иначе расхождение 2 в шапке `appSearchSuper.ts` («корни Solid-секций
// утилизируются в `destroy()`») не проверить вовсе: наш `Section` реактивных
// уборок не регистрирует, и утилизация корня в DOM никак не видна.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const solidRoots = vi.hoisted(() => ({ opened: 0, disposed: 0 }))

vi.mock('solid-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('solid-js')>()
  return {
    ...actual,
    createRoot: <T>(fn: (dispose: () => void) => T, detachedOwner?: never) =>
      actual.createRoot((dispose) => {
        ++solidRoots.opened
        return fn(() => {
          ++solidRoots.disposed
          dispose()
        })
      }, detachedOwner),
  }
})

import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import type { LangPackKey } from '@lib/langPack'

/**
 * Набор вкладок — подмножество боевого литерала ПРАВОЙ колонки
 * `sharedMedia.tsx:604-648` в его порядке: `savedDialogs`, `members`, `media`,
 * `gifts`, `files`, `links`, `music`, `voice`. Взяты и «секционные», и
 * «бессекционные» типы — развилка `noSectionTypes` (`tweb:545-553`) проверяется
 * на живом наборе.
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

/**
 * Набор ЛЕВОЙ колонки — подмножество литерала `sidebarLeft/index.ts:1129-1160`
 * в его порядке. Нужен ради типа `chats`: в правой колонке его нет вовсе (там
 * `savedDialogs`), а класс один на обе колонки, и у `chats` две особенности —
 * он в `noSectionTypes` (`tweb:549`) и он единственный с ранним выходом в
 * `cleanupHTML` (`tweb:2776-2778`). Фильтр `inputMessagesFilterEmpty` — не
 * выдумка теста, он ровно такой в оригинале (`sidebarLeft/index.ts:1130`).
 */
function makeLeftColumnTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'chats', inputFilter: 'inputMessagesFilterEmpty', name: 'FilterChats' as LangPackKey },
    { type: 'channels', name: 'ChannelsTab' as LangPackKey },
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
  ]
}

let scrollable: Scrollable
let host: HTMLElement

function build(options?: { hideEmptyTabs?: boolean, mediaTabs?: SearchSuperMediaTab[] }) {
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
  it('корень, градиент, липкий ряд и контейнер вкладок — в порядке дампа :121-126,:198', () => {
    const searchSuper = build()
    const root = searchSuper.container

    expect(root.className).toBe('search-super')

    const children = Array.from(root.children) as HTMLElement[]
    expect(children).toHaveLength(3)

    // :122-123 — градиент двумя узлами, вложенными друг в друга
    expect(children[0].className).toBe('menu-horizontal-gradient-container search-super-tabs-gradient-container')
    expect(children[0].children).toHaveLength(1)
    expect((children[0].firstElementChild as HTMLElement).className)
      .toBe('menu-horizontal-gradient menu-horizontal-gradient-color-background search-super-tabs-gradient')

    // узел градиента ЗАПОМНЕН полем (tweb `:437`, `:596-600`): при одной
    // доступной вкладке задача 10 прячет его вместе с `is-single` на ряду
    // (`tweb:2509-2511`, `:2523-2525`) — без ссылки прятать будет нечего
    expect(searchSuper.menuGradient).toBe(children[0])

    // :124 — липкий ряд; `sticky` тут КЛАСС, а не инлайновый стиль:
    // позицию задаёт `styles/tweb/_searchSuper.scss:19-25` (`top: var(--super-offset)`),
    // и инлайн его перебивать не должен (наш дефект P1 из `docs/tweb/shared-media.md` § 2.3)
    expect(children[1]).toBe(searchSuper.navScrollableContainer)
    expect(children[1].className).toBe('search-super-tabs-scrollable menu-horizontal-scrollable sticky')
    expect(children[1].getAttribute('style')).toBeNull()

    // :125-126 — ScrollableX внутри липкого ряда, в нём nav
    const navScrollable = children[1].firstElementChild as HTMLElement
    expect(navScrollable.className).toBe('scrollable scrollable-x search-super-nav-scrollable')
    expect(navScrollable.firstElementChild).toBe(searchSuper.nav)
    expect(searchSuper.nav.tagName).toBe('NAV')
    expect(searchSuper.nav.className).toBe('search-super-tabs menu-horizontal-div')

    // :198 — контейнер содержимого
    expect(children[2]).toBe(searchSuper.tabsContainer)
    expect(children[2].className).toBe('search-super-tabs-container tabs-container')
  })

  it('строка ряда: ripple, подчёркивание, название — именно в этом порядке (дамп :127-131)', () => {
    const searchSuper = build()
    const items = Array.from(searchSuper.nav.children) as HTMLElement[]
    expect(items).toHaveLength(8)

    const first = items[0]
    expect(first.classList.contains('menu-horizontal-div-item')).toBe(true)
    // `rp` вешает сам `ripple()` — дамп :127
    expect(first.classList.contains('rp')).toBe(true)

    const inner = Array.from(first.children) as HTMLElement[]
    expect(inner.map((el) => `${el.tagName.toLowerCase()}.${el.className}`)).toEqual([
      'div.c-ripple',
      'i.menu-horizontal-div-item-background',
      'span.menu-horizontal-div-item-span',
    ])

    // :131 — название лежит ВНУТРИ span'а и это узел i18n, а не голый текст
    const name = inner[2].firstElementChild as HTMLElement
    expect(name.classList.contains('i18n')).toBe(true)
    expect(searchSuper.mediaTabs[0].menuTabName).toBe(name)
    expect(searchSuper.mediaTabs[0].menuTab).toBe(first)
  })

  it('у каждой вкладки свой контейнер с типом в классе (дамп :199,:205,:247,:253)', () => {
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

  it('вкладка media получает грид и НЕ получает карточку секции (дамп :247-249)', () => {
    const searchSuper = build()
    const media = searchSuper.mediaTabs[2]

    expect(media.hideOn).toBeUndefined()
    expect(media.itemsTab!.className).toBe('search-super-content-media-grid')
    expect(media.itemsTab!.parentElement).toBe(media.contentTab)
    // рендер кладёт элементы именно в грид, а не в контейнер содержимого
    expect(searchSuper.tabs.inputMessagesFilterPhotoVideo).toBe(media.itemsTab)
  })

  it('типы вне noSectionTypes получают СКРЫТУЮ карточку Section (дамп :261-266)', () => {
    const searchSuper = build()

    // В noSectionTypes (tweb :545-553) из нашего набора попадают только `media`
    // и `gifts`. `savedDialogs` в набор НЕ входит (там `chats` — другой тип) и
    // карточку получает — дамп :199-204 это и показывает.
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
    // список элементов — голый div ВНУТРИ карточки (дамп :266)
    expect(cardContent.firstElementChild).toBe(files.itemsTab)
    expect(files.itemsTab!.className).toBe('')
    expect(searchSuper.tabs.inputMessagesFilterDocument).toBe(files.itemsTab)
  })

  it('вкладка chats рисует свою разметку целиком — карточки Section у неё нет (tweb :549)', () => {
    const searchSuper = build({ mediaTabs: makeLeftColumnTabs() })
    const [chats, channels, , files] = searchSuper.mediaTabs

    // chats и channels — оба в noSectionTypes, и оба кладут элементы прямо в
    // контейнер содержимого; чатлист рисует строки сам, карточка ему помешала бы
    expect(chats.hideOn).toBeUndefined()
    expect(chats.itemsTab).toBe(chats.contentTab)
    expect(searchSuper.tabs.inputMessagesFilterEmpty).toBe(chats.contentTab)
    expect(channels.hideOn).toBeUndefined()

    // соседняя «секционная» вкладка того же набора карточку получает —
    // значит дело именно в наборе типов, а не в том, что карточек нет вовсе
    expect(files.hideOn).toBeDefined()
    expect(files.itemsTab).not.toBe(files.contentTab)
  })

  it('карта «тип → вкладка» и стартовая вкладка — первая из списка (tweb :490,:791)', () => {
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

    // у `links` кэш уже есть — прелоадер ей ставить нельзя (tweb :2780)
    searchSuper.historyStorage.inputMessagesFilterUrl = []

    searchSuper.cleanupHTML()

    searchSuper.mediaTabs.forEach((tab) => {
      expect(tab.itemsTab!.childElementCount).toBe(0)
      if(tab.hideOn) expect(tab.hideOn.classList.contains('hide')).toBe(true)
    })

    const preloaderOf = (tab: SearchSuperMediaTab) =>
      tab.contentTab!.parentElement!.querySelector('.preloader')

    // прелоадер — СОСЕДОМ контейнера содержимого, внутри контейнера вкладки (дамп :250-252)
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

  it('снимает прежнее пустое состояние — иначе «ничего не найдено» останется поверх загрузки (tweb :2786-2787)', () => {
    const searchSuper = build()
    const files = searchSuper.mediaTabs[4]
    const empty = document.createElement('div')
    empty.className = 'content-empty'
    files.contentTab!.parentElement!.append(empty)

    searchSuper.cleanupHTML()

    expect(files.contentTab!.parentElement!.querySelector('.content-empty')).toBeNull()
    expect(empty.parentElement).toBeNull()
    // и на её место встал прелоадер
    expect(files.contentTab!.parentElement!.querySelector('.preloader')).not.toBeNull()
  })

  it('вкладке chats прелоадер НЕ ставится, хотя фильтр у неё есть и кэша нет (tweb :2776-2778)', () => {
    const searchSuper = build({ mediaTabs: makeLeftColumnTabs() })
    const [chats, , media] = searchSuper.mediaTabs

    searchSuper.cleanupHTML()

    // условие `tab.inputFilter && !historyStorage[...]` у chats выполнено —
    // не будь раннего выхода, прелоадер лёг бы прямо в чатлист
    expect(chats.inputFilter).toBe('inputMessagesFilterEmpty')
    expect(searchSuper.historyStorage.inputMessagesFilterEmpty).toBeUndefined()
    expect(chats.contentTab!.parentElement!.querySelector('.preloader')).toBeNull()

    // соседняя вкладка того же набора прелоадер получает — значит выход именно по типу
    expect(media.contentTab!.parentElement!.querySelector('.preloader')).not.toBeNull()
  })

  it('при hideEmptyTabs прячет подсистему и метит родителя (tweb :2770-2774)', () => {
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
  it('cleanup помечает кэш неиспользованным, но САМ КЭШ НЕ ТРОГАЕТ (tweb :2725-2732)', () => {
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

  it('cleanup закрывает зону актуальности — всё, что успело начаться, больше не имеет права рисовать (tweb :2745)', () => {
    const searchSuper = build()
    // так рендер (задачи 6-9) и держится за «свою» загрузку: взял middleware
    // до сети, проверил после — и не трогает разметку, если пир уже сменился
    const middleware = searchSuper.middleware.get()
    let cancelled = false
    middleware.onClean(() => {
      cancelled = true
    })

    expect(middleware()).toBe(true)

    searchSuper.cleanup()

    expect(middleware()).toBe(false)
    expect(cancelled).toBe(true)
    // и новая зона выдаётся живой — следующая загрузка рисовать вправе
    expect(searchSuper.middleware.get()()).toBe(true)
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

  it('без historyStorage снаружи кэш становится пустым (tweb :2823)', () => {
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

  it('утилизирует ВСЕ корни Solid, которые открыл (расхождение 2 в шапке файла)', () => {
    solidRoots.opened = solidRoots.disposed = 0

    const searchSuper = build()
    // по корню на каждую «секционную» вкладку: savedDialogs, members, files,
    // links, music, voice — шесть из восьми (media и gifts в noSectionTypes)
    expect(solidRoots.opened).toBe(6)
    expect(solidRoots.disposed).toBe(0)

    searchSuper.destroy()

    expect(solidRoots.disposed).toBe(solidRoots.opened)

    // повторный destroy не зовёт dispose второй раз — список опустошён
    searchSuper.destroy()
    expect(solidRoots.disposed).toBe(solidRoots.opened)
  })
})
