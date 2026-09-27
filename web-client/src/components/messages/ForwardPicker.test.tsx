// Попап «Поделиться» в tweb собран НЕ из своей вёрстки, а из того же селектора
// пиров, что участники и админы в правой колонке (дамп
// `docs/tweb/dom/dumps/17-popup-01-forward-share.json`):
//
//   div.popup.popup-forward > div.popup-body
//     div.selector.selector-round.selector-right.selector-multiselect-hidden
//       …selector-search-section
//       div.sidebar-left-section-container.search-group.search-group-contacts   ← «недавние»
//         div.scrollable.scrollable-x.search-group-scrollable-x > ul.chatlist
//       …ul.chatlist со строками чатов
//
// До переноса тело было на своих модульных классах (`s.pickerSearch`,
// `s.recents`, `s.shareRow`), то есть три экрана выбора людей жили тремя
// разными вёрстками. Тест держит именно это: попап несёт свой модификатор,
// а внутри — общий селектор с рядом «недавних» внутри его скроллера.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ForwardPicker } from './ChatDialogs'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { Dialog } from '../../core/models'
import type { RawFolder } from '../../core/managers/foldersManager'
import useFolders from '../../stores/folders.solid'
import { useAppStateStore } from '../../stores/appState'
import { applyFolderUpdate, useFoldersStore } from '../../stores/foldersStore'
import { useChatsStore } from '../../stores/chatsStore'
import { initialState } from '../../core/state/state'
import { ALL_FOLDER_ID } from '../../core/folderIds'
import { makeDialog } from '../../core/dialogs/testDialog'
import { applyPeerOps, resetPeerMirror } from '../../core/peerCache'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as sass from 'sass'
import selectorStyles from '../../shared/ui/PeerSelector/PeerSelector.module.scss'

// Аватарки строк резолвятся через useMediaUrl → managers.media — пустой стаб.
const fakeManagers = { media: { downloadMediaURL: vi.fn(async () => '') } } as unknown as Managers

afterEach(cleanup)

// Строки — настоящие диалоги: личка и группа, в которую можно писать
// (фильтр прав селектора, `filterByRights`, читает карточки из зеркала).
const dialogs: Dialog[] = [makeDialog({ peerId: 11 }), makeDialog({ peerId: -2 })]

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{
    op: 'upsert',
    peers: [
      { _: 'user', id: 11, first_name: 'Денис', pFlags: {} },
      {
        _: 'channel', id: 2, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0,
        pFlags: { megagroup: true }, default_banned_rights: { _: 'chatBannedRights', until_date: 0 },
      },
    ],
  }])
})

function mount() {
  return render(
    <ManagersProvider managers={fakeManagers}>
      <ForwardPicker dialogs={dialogs} onPick={() => {}} onClose={() => {}} />
    </ManagersProvider>,
  )
}

describe('ForwardPicker — тело на общем селекторе', () => {
  it('попап несёт модификатор popup-forward', () => {
    mount()

    expect(document.querySelector('.popup.popup-forward')).not.toBeNull()
  })

  it('внутри — селектор с модификаторами формы, стороны и скрытого мультивыбора', () => {
    mount()
    const sel = document.querySelector('.popup-forward .selector')!

    expect(sel).not.toBeNull()
    expect(sel.classList.contains('selector-round')).toBe(true)
    expect(sel.classList.contains('selector-right')).toBe(true)
    expect(sel.classList.contains('selector-multiselect-hidden')).toBe(true)
  })

  it('ряд «недавних» лежит ВНУТРИ скроллера селектора', () => {
    mount()
    const recents = document.querySelector('.search-group.search-group-contacts')!

    expect(recents).not.toBeNull()
    expect(recents.closest('.selector-scrollable')).not.toBeNull()
    expect(recents.querySelector('.scrollable-x.search-group-scrollable-x')).not.toBeNull()
  })

  it('строки чатов — ul.chatlist селектора, а не своя вёрстка', () => {
    mount()

    expect(document.querySelectorAll('.selector .chatlist a.chatlist-chat').length).toBeGreaterThan(0)
  })

  it('секция «недавних» несёт search-group-people — без него лента чипов идёт колонкой', () => {
    mount()
    const recents = document.querySelector('.search-group.search-group-contacts')!

    // `.search-group-people .chatlist { display:flex; flex-direction:row }`
    // (_searchGroup.scss) — единственное, что раскладывает чипы в ряд;
    // остальные классы — из того же узла дампа 17-popup-01.
    expect(recents.classList.contains('search-group-people')).toBe(true)
    expect(recents.classList.contains('popup-forward-top-peers')).toBe(true)
    expect(recents.classList.contains('collapsable')).toBe(true)
    expect(recents.classList.contains('search-group-with-scroll')).toBe(true)
  })
})

// ── Скроллер попапа — `.selector-scrollable`, а не тело ─────────────────────
//
// У tweb тело попапа не прокручивается: `.popup-body` — flex-колонка с
// `overflow: hidden` и `.scrollable { position: relative }`
// (`scss/partials/popups/_popup.scss:192-200`), `.popup-forward .tabs-container`
// — `height: 100%` (`popups/_forward.scss`), и прокручивает
// `selector.scrollable` (`div.scrollable.scrollable-y.selector-scrollable`):
// в нём липнут поиск и ряд папок, по нему `fastSmoothScroll` ряда везёт список
// к началу перед сменой скоупа (`popups/pickUser.tsx:339-362`). Наше тело само
// скроллер (`Popup.module.scss`, `.body.body`), и хост селектора рос по
// содержимому — стенд: `.popup-body` 724/616, `.selector-scrollable` 724/724.
//
// Геометрию happy-dom не считает, поэтому пин — каскад НАСТОЯЩЕГО модуля
// хоста (скомпилирован sass, имена классов — те же, что отдал модуль тесту) на
// узле из дерева попапа: хост ограничен телом. Живая проверка — стенд
// (scrollTop растёт у `.selector-scrollable`, у тела scrollHeight = clientHeight).
describe('ForwardPicker — прокручивает селектор, а не тело попапа', () => {
  function injectHostModule() {
    const file = join(__dirname, '../../shared/ui/PeerSelector/PeerSelector.module.scss')
    const css = sass.compileString(readFileSync(file, 'utf8'), { loadPaths: [join(file, '..')] }).css
      .replace(/:global\(([^()]*)\)/g, '$1')
      .replace(/\.host\b/g, '.' + selectorStyles.host)
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
  }

  afterEach(() => document.head.replaceChildren())

  it('хост селектора — прямой ребёнок тела, высота — от тела, без нижней границы сайдбара', () => {
    injectHostModule()
    mount()
    const host = document.querySelector<HTMLElement>('.popup-forward .popup-body > .' + selectorStyles.host)!

    expect(host).not.toBeNull()
    const cs = getComputedStyle(host)
    expect(cs.height).toBe('100%')
    expect(cs.minHeight).toMatch(/^0(px)?$/)
    // Поиск и ряд папок — внутри того скроллера, что заполняет хост.
    const scroller = host.querySelector(':scope > .selector > .selector-scrollable')!
    expect(scroller).not.toBeNull()
    expect(scroller.querySelector('.selector-search-section-container')).not.toBeNull()
    expect(scroller.querySelector('.popup-forward-folder-tabs-container')).not.toBeNull()
  })

  it('вне попапа пересылки хост остаётся сайдбарным (min-height 360px)', () => {
    injectHostModule()
    render(<div className="popup-body"><div className={selectorStyles.host} /></div>)

    const cs = getComputedStyle(document.querySelector<HTMLElement>('.' + selectorStyles.host)!)
    expect(cs.minHeight).toBe('360px')
    expect(cs.height).not.toBe('100%')
  })
})

// ── Ряд папок (задача 9 плана `2026-09-07-solid-wave-3-folders-tabs.md`) ──────
//
// У оригинала попап пересылки ряд папок ИМЕЕТ: `showForwardPopup` зовёт
// `showPickUserPopup({showTopPeers: true, …})` (tweb `popups/forward.tsx:360-376`),
// а тот при `showTopPeers` ставит сразу после «недавних» Solid-`FoldersTabs`
// (`popups/pickUser.tsx:325-424`, вызов `:509`). Клик по вкладке переключает
// СКОУП селектора (`selector.setFolderId`, `appSelectPeers.ts:1358-1366`), а
// набранный запрос скоуп снимает: `_setFolderId(value)` ставит
// `FOLDER_ID_ALL`, пока поле непусто (`:631-633`, `:644-647`). Пины — на DOM
// и на то, какие строки остались в списке, а не на форму вызовов.
describe('ForwardPicker — ряд папок: порт pickUser.createFolderTabs', () => {
  const folders = useFolders()

  const raw = (id: number, pos: number, title: string, include: number[]): RawFolder => ({
    id, title, pos,
    contacts: false, non_contacts: false, groups: false, broadcasts: false, bots: false,
    exclude_muted: false, exclude_read: false, include_peers: include, exclude_peers: [],
  })

  const folderDialogs = [makeDialog({ peerId: 1 }), makeDialog({ peerId: 2 }), makeDialog({ peerId: 3 })]

  beforeEach(() => {
    folders.dispose()
    useAppStateStore.setState(initialState(), true)
    useChatsStore.setState({ dialogs: [], dialogIndexById: {} })
    useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
    resetPeerMirror()
    applyPeerOps([{
      op: 'upsert',
      peers: [
        { _: 'user', id: 1, first_name: 'Анна', pFlags: {} },
        { _: 'user', id: 2, first_name: 'Борис', pFlags: {} },
        { _: 'user', id: 3, first_name: 'Вера', pFlags: {} },
      ],
    }])
    applyFolderUpdate({ folder: raw(3, 1, 'Работа', [1]) })
  })

  afterEach(() => folders.dispose())

  function mountWithFolders() {
    return render(
      <ManagersProvider managers={fakeManagers}>
        <ForwardPicker dialogs={folderDialogs} onPick={() => {}} onClose={() => {}} />
      </ManagersProvider>,
    )
  }

  const container = () => document.querySelector<HTMLElement>('.popup-forward .popup-forward-folder-tabs-container')!
  const tab = (filterId: number) => container().querySelector<HTMLElement>(`.menu-horizontal-div-item[data-filter-id="${filterId}"]`)!
  const rows = () => Array.from(
    document.querySelectorAll<HTMLElement>('.popup-forward .selector-list-section-container a.chatlist-chat'),
  ).map((row) => Number(row.dataset.peerId))
  const typeQuery = (value: string) => {
    const input = document.querySelector<HTMLInputElement>('.popup-forward .selector-search-input')!
    fireEvent.change(input, { target: { value } })
  }

  it('ряд — Solid-FoldersTabs в контейнере tweb, между «недавними» и списком', () => {
    mountWithFolders()
    const mount = container()

    expect(mount).not.toBeNull()
    expect(mount.classList.contains('collapsable')).toBe(true)
    expect(mount.closest('.selector-scrollable')).not.toBeNull()
    // `afterElement.after(mount)` (`pickUser.tsx:330`), а список —
    // `selector.heightContainer` (`:505`, `appSelectPeers.ts:358`).
    expect(mount.previousElementSibling!.classList.contains('popup-forward-top-peers')).toBe(true)
    expect(mount.nextElementSibling!.classList.contains('selector-height-container')).toBe(true)
    // Пропы `FoldersTabs` из `pickUser.tsx:391-419`.
    expect(mount.querySelector('.menu-horizontal-scrollable.popup-forward-folder-tabs .menu-horizontal-div')).not.toBeNull()
    const gradient = mount.querySelector('.popup-forward-folder-tabs-gradient-container > .menu-horizontal-gradient')!
    expect(gradient).not.toBeNull()
    expect(gradient.classList.contains('menu-horizontal-gradient-color-background')).toBe(true)
    expect(gradient.classList.contains('popup-forward-folder-tabs-gradient')).toBe(true)
    expect(Array.from(mount.querySelectorAll<HTMLElement>('.menu-horizontal-div-item')).map((el) => el.dataset.filterId))
      .toEqual(['0', '3'])
    // Прежнего React-ряда поверх `shared/ui/Tabs` (класс колонки) больше нет.
    expect(document.querySelector('.popup-forward .folders-tabs-scrollable')).toBeNull()
  })

  it('первая вкладка выбрана сразу (`menuProps.ref` → `onTabClick(first, 0)`)', async () => {
    mountWithFolders()

    await waitFor(() => expect(tab(ALL_FOLDER_ID).classList.contains('active')).toBe(true))
    expect(tab(3).classList.contains('active')).toBe(false)
    expect(rows()).toEqual([1, 2, 3])
  })

  it('клик по папке сужает список до её чатов и переносит active', async () => {
    mountWithFolders()
    await waitFor(() => expect(tab(ALL_FOLDER_ID).classList.contains('active')).toBe(true))

    fireEvent.click(tab(3).querySelector('.text-super')!)

    await waitFor(() => expect(rows()).toEqual([1]))
    await waitFor(() => expect(tab(3).classList.contains('active')).toBe(true))
    expect(tab(ALL_FOLDER_ID).classList.contains('active')).toBe(false)
  })

  it('размонтирование попапа снимает Solid-ряд (владелец убирает то, что создал)', () => {
    const view = mountWithFolders()
    const mount = container()
    expect(mount.querySelector('.menu-horizontal-div')).not.toBeNull()

    view.unmount()

    // React выбрасывает узел, но дерево Solid живёт, пока его не снимет
    // `dispose` (`render` чистит хост, `mountSolid.solid.tsx`) — без уборки ряд
    // остался бы подписанным на проекцию папок.
    expect(mount.childElementCount).toBe(0)
  })

  it('запрос сворачивает ряд и ищет по всем чатам; пустой запрос возвращает скоуп папки', async () => {
    mountWithFolders()
    await waitFor(() => expect(tab(ALL_FOLDER_ID).classList.contains('active')).toBe(true))
    fireEvent.click(tab(3))
    await waitFor(() => expect(rows()).toEqual([1]))

    typeQuery('Борис')

    // `selector.onSearchChange` → `is-collapsed` (`pickUser.tsx:421-423`).
    expect(container().classList.contains('is-collapsed')).toBe(true)
    // Чат 2 в папку «Работа» не входит — и всё же найден: скоуп снят запросом.
    expect(rows()).toEqual([2])

    typeQuery('')

    expect(container().classList.contains('is-collapsed')).toBe(false)
    expect(rows()).toEqual([1])
  })
})

// ── Кто может быть получателем (жалоба: «каналы чужие, всё подряд») ─────────
//
// У tweb попап пересылки зовёт селектор с `chatRightsActions` — по умолчанию
// `['send_plain']` (`popups/forward.tsx:99-102`), — и `filterByRights`
// (`appSelectPeers.tsx:782-787`, `:827-834`) отсекает чаты, куда писать нельзя:
// канал — без `post_messages`, группу — с запретом писать. «Избранное» стоит
// первым (`renderSaved`, `:725-735`), ряд «недавних» — собеседники со «своим»
// первым (`pickUser.tsx:517-528`, `getTopPeers('correspondents')`).
describe('ForwardPicker — фильтр прав получателя', () => {
  const OPEN = { _: 'chatBannedRights' as const, until_date: 0 }
  const NO_TEXT = { _: 'chatBannedRights' as const, pFlags: { send_messages: true as const }, until_date: 0 }
  const ME = 100

  beforeEach(() => {
    resetPeerMirror()
    useChatsStore.setState({ meId: ME })
    applyPeerOps([{
      op: 'upsert',
      peers: [
        { _: 'user', id: 11, first_name: 'Денис', pFlags: {} },
        { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
        { _: 'channel', id: 1, title: 'Чужой канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true }, default_banned_rights: OPEN },
        { _: 'channel', id: 2, title: 'Свой канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true, creator: true }, default_banned_rights: OPEN },
        { _: 'channel', id: 3, title: 'Немая группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true }, default_banned_rights: NO_TEXT },
        { _: 'channel', id: 4, title: 'Своя группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, creator: true }, default_banned_rights: NO_TEXT },
        { _: 'channel', id: 5, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true }, default_banned_rights: OPEN },
      ],
    }])
  })

  afterEach(() => useChatsStore.setState({ meId: null }))

  const all = [11, -1, -2, -3, ME, -4, -5].map((peerId) => makeDialog({ peerId }))
  const rows = () => Array.from(
    document.querySelectorAll<HTMLElement>('.popup-forward .selector-list-section-container a.chatlist-chat'),
  ).map((row) => Number(row.dataset.peerId))
  const recents = () => Array.from(
    document.querySelectorAll<HTMLElement>('.popup-forward .popup-forward-top-peers .chatlist > *'),
  ).map((el) => el.lastElementChild?.textContent)

  function mountWith(extra: Partial<Parameters<typeof ForwardPicker>[0]> = {}) {
    return render(
      <ManagersProvider managers={fakeManagers}>
        <ForwardPicker dialogs={all} onPick={() => {}} onClose={() => {}} {...extra} />
      </ManagersProvider>,
    )
  }

  it('канал без права постить и группа с запретом писать не видны; личка, свои канал и группа — видны', () => {
    mountWith()

    expect(rows()).not.toContain(-1)
    expect(rows()).not.toContain(-3)
    expect(rows()).toEqual(expect.arrayContaining([11, -2, -4, -5]))
  })

  it('«Избранное» — первой строкой (renderSaved)', () => {
    mountWith()

    expect(rows()[0]).toBe(ME)
    expect(rows()).toEqual([ME, 11, -2, -4, -5])
  })

  it('ряд «недавних» — собеседники, «своё» первым, без каналов и групп', () => {
    mountWith()

    expect(recents()).toEqual(['Избранное', 'Денис'])
  })

  it('строка «Избранного» — с иконкой закладки, а не буквой (addDialogNew c meAsSaved)', () => {
    mountWith()
    const row = document.querySelector(`.popup-forward .selector-list-section-container a.chatlist-chat[data-peer-id="${ME}"]`)!

    expect(row.querySelector('.avatar-icon-saved_filled')).not.toBeNull()
    expect(row.querySelector('.peer-title')!.textContent).toBe('Избранное')
  })

  it('«Избранное» первым, даже когда диалога с собой ещё нет (renderSaved рисует rootScope.myId)', () => {
    render(
      <ManagersProvider managers={fakeManagers}>
        <ForwardPicker dialogs={all.filter((d) => d.peerId !== ME)} onPick={() => {}} onClose={() => {}} />
      </ManagersProvider>,
    )

    expect(rows()[0]).toBe(ME)
    expect(recents()[0]).toBe('Избранное')
  })

  it('медиа проверяет запрет медиа: группа с запретом только текста видна (история — send_media)', () => {
    mountWith({ chatRightsActions: ['send_media'] })

    expect(rows()).toContain(-3)
    expect(rows()).not.toContain(-1)
  })
})
