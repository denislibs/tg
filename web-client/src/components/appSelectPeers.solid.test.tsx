/** @jsxImportSource solid-js */
/**
 * Пины `AppSelectPeers` (`appSelectPeers.solid.tsx`, порт tweb
 * `components/appSelectPeers.tsx`, 812502980).
 *
 * Предмет — результат: разметка селектора и строк (дамп
 * `14-left-30b-new-group-members-selected.json`), место и классы чекбокса по
 * форме/стороне, чипы выбранных, порядок подгрузки (папка → архив → контакты),
 * курсор страницы, поиск со сменой списка и заглушкой, скоуп по папке.
 * Стабы — только границы: менеджеры воркера, lottie заглушки (сеть), зеркало
 * индексов диалогов (`useChatsStore.dialogIndexById`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import rootScope from '@lib/rootScope'
import lottieLoader from '@lib/lottie/lottieLoader'
import windowSize from '@helpers/windowSize'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'
import { ARCHIVE_FOLDER_ID } from '@core/folderIds'
import type { Chat, User } from '@core/peers/peer'
import AppSelectPeers, { type AppSelectPeersManagers } from './appSelectPeers.solid'

const ME = 1

const user = (id: number, extra: Partial<Extract<User, { _: 'user' }>> = {}): User =>
  ({ _: 'user', id, first_name: 'U' + id, pFlags: {}, ...extra })
const group = (id: number): Chat =>
  ({ _: 'chat', id, title: 'G' + id, participants_count: 3, date: 0, photo: { _: 'chatPhotoEmpty' } } as unknown as Chat)
const channel = (id: number): Chat =>
  ({ _: 'channel', id, title: 'C' + id, participants_count: 30, date: 0, pFlags: { broadcast: true }, photo: { _: 'chatPhotoEmpty' } } as unknown as Chat)

/** Карточки по ключу пира (чаты — отрицательным). */
const PEERS = new Map<PeerId, User | Chat>([
  [ME, user(ME, { pFlags: { self: true } })],
  [2, user(2, { pFlags: { contact: true } })],
  [3, user(3)],
  [4, user(4, { pFlags: { contact: true } })],
  [-10, group(10)],
  [-20, channel(20)],
])

type Page = { dialogs: { peerId: PeerId }[], count: number, isEnd: boolean }

let helper: MiddlewareHelper
let appendTo: HTMLElement
let getDialogs: ReturnType<typeof vi.fn>
let getContactsPeerIds: ReturnType<typeof vi.fn>
let search: ReturnType<typeof vi.fn>

const page = (peerIds: PeerId[], isEnd = true): Page =>
  ({ dialogs: peerIds.map((peerId) => ({ peerId })), count: peerIds.length, isEnd })

function managers(): AppSelectPeersManagers {
  return {
    dialogs: { getDialogs },
    contacts: { getContactsPeerIds, testSelfSearch: vi.fn(async() => false) },
    channels: { search },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => PEERS.get(id)).filter(Boolean)),
      fillMirror: vi.fn(async() => {}),
    },
  } as unknown as AppSelectPeersManagers
}

/** Первая страница уходит из `setTimeout(0)` (`loadFirst`), дальше — цепочка промисов. */
const settle = async() => {
  for(let i = 0; i < 12; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function build(options: Partial<ConstructorParameters<typeof AppSelectPeers>[0]> = {}) {
  return new AppSelectPeers({
    appendTo,
    managers: managers(),
    middleware: helper.get(),
    ...options,
  })
}

const rows = (selector: AppSelectPeers) =>
  [...selector.container.querySelectorAll<HTMLElement>('ul.chatlist > a.row')]
const rowIds = (selector: AppSelectPeers) => rows(selector).map((row) => +row.dataset.peerId!)
const row = (selector: AppSelectPeers, peerId: PeerId) =>
  selector.container.querySelector<HTMLElement>(`ul.chatlist > a.row[data-peer-id="${peerId}"]`)!
const chips = (selector: AppSelectPeers) =>
  [...selector.container.querySelectorAll<HTMLElement>('.selector-search > .selector-user')].map((chip) => chip.dataset.key)

beforeEach(() => {
  rootScope.myId = ME
  // Без анимаций чип снимается сразу (у оригинала — по `animationend`).
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  useChatsStore.setState({ dialogIndexById: { 2: 900, 3: 800, [-10]: 700, [-20]: 600, 4: 500 } })
  vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
  vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
  helper = getMiddleware()
  appendTo = document.createElement('div')
  document.body.append(appendTo)
  getDialogs = vi.fn(async({ filterId }: { filterId: number }) => page(filterId === 0 ? [2, -10, -20] : []))
  getContactsPeerIds = vi.fn(async() => [4])
  search = vi.fn(async() => ({ _: 'contacts.found', my_results: [], results: [], chats: [], users: [] }))
})

afterEach(() => {
  helper.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
})

describe('AppSelectPeers — разметка (дамп 14-left-30b)', () => {
  it('selector-{design}-{side} > scrollable: градиент, секция поиска, контейнер высоты со списком', async() => {
    const selector = build()
    await settle()

    expect([...selector.container.classList]).toEqual(['selector', 'selector-round', 'selector-right'])
    const scrollable = selector.container.firstElementChild as HTMLElement
    expect(scrollable.classList.contains('selector-scrollable')).toBe(true)
    expect([...scrollable.children].map((el) => el.className)).toEqual([
      'menu-horizontal-gradient-container selector-search-gradient-container',
      'sidebar-left-section-container selector-search-section-container',
      'selector-height-container',
    ])

    const listSection = scrollable.querySelector('.selector-height-container > .sidebar-left-section-container')!
    expect([...listSection.classList]).toEqual(['sidebar-left-section-container', 'is-visible', 'selector-list-section-container'])
    const content = listSection.querySelector(':scope > .sidebar-left-section > .sidebar-left-section-content')!
    expect(content.classList.contains('selector-list-section-content')).toBe(true)
    expect(content.lastElementChild!.tagName).toBe('UL')
    expect(content.lastElementChild!.className).toBe('chatlist')
  })

  it('градиент шапки поиска собран внутри корня на middleware владельца: предупреждения Solid нет (расхождение 3 selectorSearch)', async() => {
    const warn = vi.spyOn(console, 'warn')
    build()
    await settle()
    helper.destroy()
    const leaks = warn.mock.calls.filter(([msg]) => String(msg).includes('computations created outside a `createRoot` or `render`'))
    expect(leaks, '`Tabs.MenuGradient` конструктора `SelectorSearch` без владельца').toEqual([])
  })

  it('поле поиска: input-search без крестика, input.selector-search-input, плейсхолдер Search', async() => {
    const selector = build()
    const field = selector.container.querySelector('.selector-search-container .selector-search > .input-search')!
    expect([...field.classList]).toEqual(['input-search', 'selector-search-input-container'])
    expect([...field.children].map((el) => el.className)).toEqual([
      'input-field-input is-empty input-search-input selector-search-input',
      'i18n input-search-placeholder',
      'tgico input-search-part input-search-icon',
    ])
    expect(field.querySelector('.input-search-clear')).toBeNull()
    expect(field.querySelector('.input-search-placeholder')!.textContent).toBe('Search')
  })

  it('круглый справа: чекбокс круглый ПОСЛЕДНИМ ребёнком строки, строка держит полосу selector-row-with-checkbox', async() => {
    const selector = build()
    await settle()

    const r = row(selector, 2)
    expect(r.classList.contains('chatlist-chat-abitbigger')).toBe(true)
    expect(r.classList.contains('selector-row-with-checkbox')).toBe(true)
    expect(r.classList.contains('row-with-checkbox-and-media')).toBe(false)
    const checkbox = r.lastElementChild as HTMLElement
    expect([...checkbox.classList]).toEqual(['checkbox-field', 'checkbox-field-round', 'checkbox-without-caption'])
    // подпись поля — имя пира (labelControl)
    const input = checkbox.querySelector('input')!
    expect(input.getAttribute('aria-labelledby')).toBe(r.querySelector('.peer-title')!.id)
  })

  it('квадратный слева: чекбокс ПЕРВЫМ, классы выделения строки, без полосы справа', async() => {
    const selector = build({ design: 'square', checkboxSide: 'left' })
    await settle()

    expect([...selector.container.classList]).toEqual(['selector', 'selector-square', 'selector-left'])
    const r = row(selector, 2)
    expect(r.classList.contains('row-with-checkbox-and-media')).toBe(true)
    expect(r.classList.contains('selector-row-with-checkbox')).toBe(false)
    const checkbox = r.firstElementChild as HTMLElement
    expect(checkbox.classList.contains('checkbox-field')).toBe(true)
    expect(checkbox.classList.contains('checkbox-field-round')).toBe(false)
    expect(checkbox.classList.contains('row-selection-checkbox')).toBe(true)
    expect(r.querySelector('.dialog-avatar')!.classList.contains('row-selection-media')).toBe(true)
  })

  it('multiSelect: false — строк с чекбоксами нет', async() => {
    const selector = build({ multiSelect: false })
    await settle()
    expect(rows(selector).length).toBeGreaterThan(0)
    expect(selector.container.querySelector('ul.chatlist .checkbox-field')).toBeNull()
  })

  it('подпись строки: пользователь — статус, чат — участники, свой пир — Presence.YourChat', async() => {
    const selector = build()
    await settle()
    expect(row(selector, -10).querySelector('.row-subtitle')!.textContent).toBe('3 members')
    expect(row(selector, ME).querySelector('.row-subtitle')!.textContent).toBe('chat with yourself')
  })
})

describe('AppSelectPeers — выбор', () => {
  it('клик по строке: галочка, чип перед полем, onChange(1, [{key, add}]) ровно один раз', async() => {
    const onChange = vi.fn()
    const selector = build({ onChange })
    await settle()

    row(selector, 2).click()
    await settle()

    expect(selector.getSelected()).toEqual([2])
    expect(row(selector, 2).querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    expect(chips(selector)).toEqual(['2'])
    const chip = selector.container.querySelector('.selector-search > .selector-user')!
    expect(chip.classList.contains('selector-user-primary')).toBe(true)
    expect(chip.nextElementSibling!.classList.contains('input-search')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(1, [{ key: 2, add: true }])
  })

  it('клик по чипу снимает выбор через строку: галочка снята, чипа нет', async() => {
    const onChange = vi.fn()
    const selector = build({ onChange })
    await settle()
    row(selector, 2).click()
    await settle()

    selector.container.querySelector<HTMLElement>('.selector-search > .selector-user')!.click()
    await settle()

    expect(selector.getSelected()).toEqual([])
    expect(row(selector, 2).querySelector<HTMLInputElement>('input')!.checked).toBe(false)
    expect(chips(selector)).toEqual([])
    expect(onChange).toHaveBeenLastCalledWith(0, [{ key: 2, add: false }])
  })

  it('onSelect === false отменяет выбор', async() => {
    const onSelect = vi.fn(() => false)
    const selector = build({ onSelect })
    await settle()
    row(selector, 2).click()
    await settle()
    expect(onSelect).toHaveBeenCalledWith(2, true, expect.anything())
    expect(selector.getSelected()).toEqual([])
  })

  it('addInitial: чипы и галочки у уже выбранных, onChange один раз на пачку', async() => {
    const onChange = vi.fn()
    const selector = build({ onChange })
    selector.addInitial([2, -10])
    await settle()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(chips(selector)).toEqual(['2', '-10'])
    expect(row(selector, -10).querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    expect(row(selector, -20).querySelector<HTMLInputElement>('input')!.checked).toBe(false)
  })

  it('кнопка категории с data-peer-id (includedChats) выбирается как строка', async() => {
    const selector = build()
    await settle()
    const button = document.createElement('button')
    button.className = 'btn-primary btn-transparent folder-category-button'
    button.dataset.peerId = 'contacts'
    button.append(selector.checkbox())
    selector.scrollable.container.prepend(button)

    button.click()
    await settle()
    expect(selector.getSelected()).toEqual(['contacts'])
    expect(button.querySelector('input')!.checked).toBe(true)
  })
})

describe('AppSelectPeers — подгрузка', () => {
  it('папка → архив → (для dialogs) контакты не грузятся; «Избранное» после первой страницы', async() => {
    const selector = build()
    await settle()

    expect(getDialogs.mock.calls.map(([o]) => o.filterId)).toEqual([0, ARCHIVE_FOLDER_ID])
    expect(getContactsPeerIds).not.toHaveBeenCalled()
    expect(rowIds(selector)).toEqual([ME, 2, -10, -20])
  })

  it('exceptSelf: своей строки нет', async() => {
    const selector = build({ exceptSelf: true })
    await settle()
    expect(rowIds(selector)).toEqual([2, -10, -20])
  })

  it('peerType contacts: книга контактов без диалогов', async() => {
    const selector = build({ peerType: ['contacts'] })
    await settle()
    expect(getDialogs).not.toHaveBeenCalled()
    expect(getContactsPeerIds).toHaveBeenCalledWith('')
    expect(rowIds(selector)).toEqual([4])
  })

  it('filterPeerTypeBy [isAnyGroup, isUser]: канал отсеян', async() => {
    const selector = build({ filterPeerTypeBy: ['isAnyGroup', 'isUser'], exceptSelf: true })
    await settle()
    expect(rowIds(selector)).toEqual([2, -10])
  })

  // О-31: `chatRightsActions` + `filterByRights` (`appSelectPeers.tsx:782-787`,
  // `:827-834`, `:878-883`) — куда писать нельзя, того в списке нет.
  it('chatRightsActions [send_messages]: канал без права постить и немая группа отсеяны; личка, свой канал и группа видны', async() => {
    const OPEN = { _: 'chatBannedRights', until_date: 0 }
    PEERS.set(-30, { _: 'channel', id: 30, title: 'Своя', date: 0, photo: { _: 'chatPhotoEmpty' }, pFlags: { broadcast: true, creator: true }, default_banned_rights: OPEN } as Chat)
    PEERS.set(-40, { _: 'channel', id: 40, title: 'Немая', date: 0, photo: { _: 'chatPhotoEmpty' }, pFlags: { megagroup: true }, default_banned_rights: { ...OPEN, pFlags: { send_messages: true } } } as Chat)
    PEERS.set(-50, { _: 'channel', id: 50, title: 'Группа', date: 0, photo: { _: 'chatPhotoEmpty' }, pFlags: { megagroup: true }, default_banned_rights: OPEN } as Chat)
    useChatsStore.setState({ dialogIndexById: { 2: 900, [-20]: 800, [-30]: 700, [-40]: 600, [-50]: 500 } })
    getDialogs.mockImplementation(async({ filterId }: { filterId: number }) => page(filterId === 0 ? [2, -20, -30, -40, -50] : []))
    try {
      const selector = build({ chatRightsActions: ['send_messages'], exceptSelf: true })
      await settle()
      expect(rowIds(selector)).toEqual([2, -30, -50])
    } finally {
      for(const id of [-30, -40, -50]) PEERS.delete(id)
    }
  })

  it('страница не последняя: курсор — индекс последнего из зеркала, следующая — по прокрутке к низу', async() => {
    getDialogs.mockImplementation(async({ offsetIndex, filterId }: { offsetIndex: number, filterId: number }) => {
      if(filterId !== 0) return page([])
      return offsetIndex ? page([3]) : page([2, -10], false)
    })
    // страница — две строки (`windowSize.height / 56 * 1.25 | 0`, :752): дозапрос
    // «пока отрисовано меньше страницы» (:822) не срабатывает
    vi.spyOn(windowSize, 'height', 'get').mockReturnValue(90)
    const selector = build({ exceptSelf: true })
    await settle()

    expect(getDialogs.mock.calls.map(([o]) => o.offsetIndex)).toEqual([0])
    expect(rowIds(selector)).toEqual([2, -10])

    selector.scrollable.onScrolledBottom!()
    await settle()
    expect(getDialogs.mock.calls.map(([o]) => [o.filterId, o.offsetIndex])).toEqual([[0, 0], [0, 700], [ARCHIVE_FOLDER_ID, 0]])
    expect(rowIds(selector)).toEqual([2, -10, 3])
  })

  it('зеркало не знает индекс последнего — выборка дочитана, запрос не повторяется с тем же курсором', async() => {
    useChatsStore.setState({ dialogIndexById: {} })
    // страница больше отрисованного — у оригинала это дозапрос (:822); без
    // проверки курсора он ушёл бы с тем же `offsetIndex` снова. Предохранитель
    // мока (конец после пятого запроса) держит мутацию конечной.
    vi.spyOn(windowSize, 'height', 'get').mockReturnValue(1000)
    getDialogs.mockImplementation(async({ filterId }: { filterId: number }) =>
      filterId === 0 ? page([2], getDialogs.mock.calls.length >= 5) : page([]))
    build({ exceptSelf: true })
    await settle()
    expect(getDialogs.mock.calls.map(([o]) => [o.filterId, o.offsetIndex])).toEqual([[0, 0], [ARCHIVE_FOLDER_ID, 0]])
  })

  it('setFolderId до загрузки: скоуп папки, без архива', async() => {
    const selector = build({ noInstantLoad: true })
    selector.setFolderId(5)
    selector.loadFirst()
    await settle()
    expect(getDialogs.mock.calls.map(([o]) => o.filterId)).toEqual([5])
  })

  it('setFolderId после загрузки перезапрашивает список с новой папкой', async() => {
    const selector = build()
    await settle()
    getDialogs.mockClear()

    selector.setFolderId(5)
    await settle()
    expect(getDialogs.mock.calls[0][0]).toMatchObject({ filterId: 5, offsetIndex: 0, query: '' })
  })
})

describe('AppSelectPeers — поиск', () => {
  const type = async(selector: AppSelectPeers, value: string) => {
    selector.input!.value = value
    selector.input!.dispatchEvent(new Event('input'))
    await new Promise((resolve) => setTimeout(resolve, 250))
    await settle()
  }

  it('запрос через 200 мс: папка на время поиска — «Все чаты», список заменён выдачей', async() => {
    const onSearchChange = vi.fn()
    const selector = build({ exceptSelf: true })
    selector.onSearchChange = onSearchChange
    selector.setFolderId(5)
    await settle()

    getDialogs.mockImplementation(async({ query }: { query: string }) => page(query ? [-10] : []))
    await type(selector, 'g')

    expect(onSearchChange).toHaveBeenCalledWith('g')
    expect(getDialogs.mock.calls[getDialogs.mock.calls.length - 1][0]).toMatchObject({ query: 'g', filterId: 0 })
    expect(rowIds(selector)).toEqual([-10])
  })

  it('пустая выдача: секция списка без is-visible, заглушка с запросом', async() => {
    const selector = build({ exceptSelf: true })
    await settle()
    getDialogs.mockImplementation(async() => page([]))

    await type(selector, 'zzz')

    const section = selector.container.querySelector('.selector-list-section-container')!
    expect(section.classList.contains('is-visible')).toBe(false)
    const placeholder = selector.container.querySelector('.selector-height-container > .selector-empty-placeholder')!
    expect(placeholder.classList.contains('hide')).toBe(false)
    expect(placeholder.querySelector('.selector-empty-placeholder-title')!.textContent).toBe('No Results')
    expect(placeholder.querySelector('.selector-empty-placeholder-description')!.textContent).toContain('zzz')
  })

  it('peerType contacts + запрос: и книга, и глобальный поиск (свои + чужие, только пользователи)', async() => {
    search.mockResolvedValue({
      _: 'contacts.found',
      my_results: [{ _: 'peerUser', user_id: 4 }],
      results: [{ _: 'peerUser', user_id: 3 }, { _: 'peerChannel', channel_id: 20 }],
      chats: [], users: [],
    })
    getContactsPeerIds.mockImplementation(async(q: string) => q ? [2] : [4])
    const selector = build({ peerType: ['contacts'] })
    await settle()

    await type(selector, 'u')
    expect(search).toHaveBeenCalledWith('u')
    expect(rowIds(selector)).toEqual([2, 4, 3])
  })

  it('chatRightsActions: выдача глобального поиска тоже фильтруется правами', async() => {
    search.mockResolvedValue({
      _: 'contacts.found',
      my_results: [],
      results: [{ _: 'peerUser', user_id: 3 }, { _: 'peerChannel', channel_id: 20 }],
      chats: [], users: [],
    })
    getContactsPeerIds.mockImplementation(async() => [])
    getDialogs.mockImplementation(async() => page([]))
    const selector = build({ peerType: ['dialogs', 'contacts'], chatRightsActions: ['send_messages'], exceptSelf: true })
    await settle()

    await type(selector, 'u')
    expect(rowIds(selector)).toEqual([3])
  })

  it('выбор при непустом запросе очищает поле', async() => {
    const selector = build({ exceptSelf: true })
    await settle()
    getDialogs.mockImplementation(async({ query }: { query: string }) => page(query ? [-10] : [2, -10]))
    await type(selector, 'g')

    row(selector, -10).click()
    await settle()
    expect(selector.input!.value).toBe('')
    expect(chips(selector)).toEqual(['-10'])
  })
})

describe('AppSelectPeers — прочее', () => {
  it('noSearch + sectionCaption: поля нет, подпись под карточкой, без selector-list-section-container', async() => {
    const selector = build({ noSearch: true, sectionCaption: 'Search.EmptyQuery', peerType: [] })
    await selector.renderResultsFunc([2])
    await settle()

    expect(selector.container.querySelector('.selector-search-section-container')).toBeNull()
    const section = selector.section.container
    expect(section.classList.contains('selector-list-section-container')).toBe(false)
    expect(section.lastElementChild!.classList.contains('sidebar-left-section-caption')).toBe(true)
    expect(rowIds(selector)).toEqual([2])
  })

  it('sectionNameLangPackKey: имя секции, список — во втором content', async() => {
    const selector = build({ sectionNameLangPackKey: 'FilterChats' })
    await settle()
    const contents = selector.section.container.querySelectorAll('.sidebar-left-section > .sidebar-left-section-content')
    expect(contents).toHaveLength(2)
    expect(contents[0].querySelector('.sidebar-left-section-name')!.textContent).toBe('Chats')
    expect(contents[1].classList.contains('selector-list-section-content')).toBe(true)
    expect(contents[1].firstElementChild!.className).toBe('chatlist')
  })

  it('уничтожение по middleware: ввод больше не ищет', async() => {
    const selector = build()
    await settle()
    getDialogs.mockClear()
    helper.destroy()

    selector.input!.value = 'x'
    selector.input!.dispatchEvent(new Event('input'))
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(getDialogs).not.toHaveBeenCalled()
  })
})
