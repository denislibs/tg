// Пины РЕНДЕРА ССЫЛОК `AppSearchSuper` — `processUrlFilter`, порт tweb
// `src/components/appSearchSuper.ts:964-1094` (задача 9 плана этапа 3).
//
// Предмет проверок — узлы и текст в DOM, не вызовы: какая строка `Row`
// получилась из сообщения, что у неё в заголовке, подзаголовке и превью.
// Три предмета оригинала:
//  • сообщение С карточкой (`messageMediaWebPage`) — заголовок карточки,
//    описание + якорь на url, превью `wrapPhoto` в `div.preview`;
//  • сообщение БЕЗ карточки, но с url в тексте/сущностях — карточка собирается
//    СИНТЕТИЧЕСКИ (`:1010-1017`): превью — абвиатура, описание — весь текст;
//  • заголовка нет — его место занимает ХОСТ (`:1055-1058`).
//
// Фейковый бэкенд — курсорная ручка, как в `appSearchSuper.load.test.ts`.
// Граница медиа замокана так же, как в `wrappers/photo.test.ts`: подменён
// только владелец URL (`managers.media.downloadMediaURL`), сам `wrapPhoto`
// настоящий — предмет пина в том, что превью строит именно он.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageMedia, MyPhoto, WebPage } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { LangPackKey } from '@lib/langPack'

vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL: async () => 'blob:preview' } } }),
}))

const PEER: PeerId = 1

const photo = (): MyPhoto => ({
  _: 'photo',
  id: 5,
  sizes: [
    { _: 'photoSize', type: 'y', w: 400, h: 225, size: 1 },
    { _: 'photoSize', type: 'w', w: 1280, h: 720, size: 1 },
  ],
})

const webPageMedia = (webpage: Omit<WebPage, '_'>): MessageMedia => ({
  _: 'messageMediaWebPage',
  webpage: { _: 'webPage', ...webpage },
})

function fakeBackend(all: MyMessage[]) {
  const managers = {
    messages: {
      mediaHistory: async (_peerId: number, _filter: string, offsetId = 0, limit = 30) => {
        const from = offsetId ? all.filter((m) => m.id < offsetId) : all
        return { messages: from.slice(0, limit), count: all.length }
      },
      searchCounters: async (_peerId: number, filters: string[]) =>
        filters.map((filter) => ({ filter, count: all.length })),
    },
  } as unknown as SearchSuperManagers
  return managers
}

const LINKS_TAB: SearchSuperMediaTab = { type: 'links', inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2' as LangPackKey }

function build(all: MyMessage[]) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({ mediaTabs: [{ ...LINKS_TAB }], scrollable, managers: fakeBackend(all) })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  return searchSuper
}

/** Дать отработать отложенной предзагрузке (`tweb:2329-2348` — `setTimeout(…, 0)`). */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function renderOne(message: MyMessage) {
  const searchSuper = build([message])
  await searchSuper.load(true)
  await settle()
  const items = searchSuper.tabs.inputMessagesFilterUrl!.querySelectorAll('.search-super-item')
  expect(items.length).toBe(1)
  return items[0] as HTMLElement
}

beforeEach(() => resetSharedMediaHistories())
afterEach(() => document.body.replaceChildren())

describe('AppSearchSuper: рендер ссылок', () => {
  it('сообщение с карточкой: строка-ссылка с заголовком, описанием, якорем и превью-фото', async () => {
    const item = await renderOne(makeMessage({
      id: 1, peerId: PEER, fromId: PEER, date: 1_700_000_000,
      text: 'https://example.com/page?q=%D0%B0',
      media: webPageMedia({
        url: 'https://example.com/page?q=%D0%B0', display_url: 'example.com/page',
        title: 'Заголовок', description: 'Описание', photo: photo(),
      }),
    }))

    // строка — сама ссылка (`asLink`), с адресом карточки и уходом в новую вкладку
    expect(item.tagName).toBe('A')
    expect(item.classList.contains('row')).toBe(true)
    expect((item as HTMLAnchorElement).href).toBe('https://example.com/page?q=%D0%B0')
    expect((item as HTMLAnchorElement).target).toBe('_blank')
    expect((item as HTMLAnchorElement).rel).toBe('noopener noreferrer')

    // заголовок карточки, дата справа
    expect(item.querySelector('.row-title-row > .row-title')!.textContent).toBe('Заголовок')
    expect(item.querySelector('.row-title-right .sent-time')).not.toBeNull()

    // описание, перевод строки и якорь с ДЕКОДИРОВАННЫМ адресом
    const subtitle = item.querySelector('.row-subtitle')!
    const anchor = subtitle.querySelector('a.anchor-url') as HTMLAnchorElement
    expect(anchor).not.toBeNull()
    expect(anchor.href).toBe('https://example.com/page?q=%D0%B0')
    expect(anchor.textContent).toBe('https://example.com/page?q=а')
    expect(subtitle.textContent).toBe('Описание\nhttps://example.com/page?q=а')

    // превью — фото в `div.preview` силами `wrapPhoto`, не абвиатура
    const preview = item.querySelector('.row-media.row-media-big.preview')!
    expect(preview).not.toBeNull()
    expect(preview.classList.contains('empty')).toBe(false)
    expect(preview.classList.contains('media-container')).toBe(true)
    expect(preview.querySelector('img.media-photo')).not.toBeNull()
  })

  it('без карточки: url из текста собирает синтетическую карточку с превью-абвиатурой', async () => {
    const item = await renderOne(makeMessage({
      id: 2, peerId: PEER, fromId: PEER, date: 1_700_000_000,
      text: 'смотри https://example.com/path/x',
    }))

    expect(item.tagName).toBe('A')
    expect((item as HTMLAnchorElement).href).toBe('https://example.com/path/x')

    // заголовка у синтетической карточки нет — его место занимает хост
    expect(item.querySelector('.row-title-row > .row-title')!.textContent).toBe('example.com')

    // описание — ВЕСЬ текст сообщения (он не равен самому url), затем якорь
    const subtitle = item.querySelector('.row-subtitle')!
    expect(subtitle.textContent).toBe('смотри https://example.com/path/x\nhttps://example.com/path/x')
    expect((subtitle.querySelector('a.anchor-url') as HTMLAnchorElement).href).toBe('https://example.com/path/x')

    // превью — абвиатура хоста, а не фото
    const preview = item.querySelector('.row-media.row-media-big.preview')!
    expect(preview.classList.contains('empty')).toBe(true)
    expect(preview.querySelector('.media-container')).toBeNull()
    expect(preview.textContent).toBe('e')
  })

  it('без карточки: url из сущности textUrl, текст равен url — описания нет', async () => {
    const item = await renderOne(makeMessage({
      id: 3, peerId: PEER, fromId: PEER, date: 1_700_000_000,
      text: 'https://example.com/a',
      entities: [{ _: 'messageEntityTextUrl', offset: 0, length: 21, url: 'https://example.com/a' }],
    }))

    expect((item as HTMLAnchorElement).href).toBe('https://example.com/a')
    // текст сообщения совпал с url — описание не дублируется, остаётся один якорь
    expect(item.querySelector('.row-subtitle')!.textContent).toBe('https://example.com/a')
    expect(item.querySelector('.row-title-row > .row-title')!.textContent).toBe('example.com')
  })

  it('карточка без заголовка: заголовком становится хост из display_url', async () => {
    const item = await renderOne(makeMessage({
      id: 4, peerId: PEER, fromId: PEER, date: 1_700_000_000,
      text: 'https://sub.example.org/x/y',
      media: webPageMedia({ url: 'https://sub.example.org/x/y', display_url: 'sub.example.org/x/y', description: 'Описание' }),
    }))

    expect(item.querySelector('.row-title-row > .row-title')!.textContent).toBe('sub.example.org')
    // абвиатура тоже от display_url — заголовка нет
    expect(item.querySelector('.preview.empty')!.textContent).toBe('s')
  })

  it('сообщение без url вовсе строки не даёт', async () => {
    const searchSuper = build([])
    const length = await searchSuper.performSearchResult({
      messages: [makeMessage({ id: 5, peerId: PEER, fromId: PEER, text: 'просто текст' })],
      mediaTab: searchSuper.mediaTab,
    })

    expect(length).toBe(0)
    expect(searchSuper.tabs.inputMessagesFilterUrl!.children.length).toBe(0)
  })
})
