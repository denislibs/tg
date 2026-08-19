// src/components/Sidebar.chatlist.test.tsx
// Этап 3, Task 8: у каждой папки свой скроллер — проверка в ЖИВОМ сайдбаре.
//
// Здесь то, что видно только отсюда и не видно из `ChatList.test.tsx`:
// (1) `--chatlist-overlay-height` ставит Sidebar на ОБЩЕГО предка кадров
//     (`.connection-status-bottom`), поэтому верхний отступ под оверлеем табов
//     получает каждый `.folders-scrollable`, сколько бы их ни было
//     (`_leftSidebar.scss:411-418` — правило на классе, а не на одном узле);
// (2) смена таба папки БОЛЬШЕ НЕ СБРАСЫВАЕТ прокрутку: ручной `scrollTop = 0`
//     в `useSidebarFolders` снят, позицию хранит сам скроллер папки, как в tweb.
//
// Отдельный файл (как `Sidebar.connectionStatus.test.tsx`) — тяжёлое дерево
// Sidebar тянется только сюда.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useAppStateStore } from '../stores/appState'
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { Managers } from '../client/bootstrap'
import type { Dialog } from '../core/models'

const HOST_HEIGHT = 720
const DIALOGS = 500

/** Папка, под правило которой подходят все наши приватные диалоги (non-contacts). */
const FOLDER = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: true, groups: false, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

// Весь слой менеджеров — рекурсивный Proxy (приём `Sidebar.connectionStatus.test.tsx`);
// настоящий ответ нужен двум методам: пуллу автомата соединения и странице диалогов.
function fakeManagers() {
  const getDialogs = vi.fn(async () => ({ dialogs: [], count: DIALOGS, isEnd: true }))
  const managers = new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => {
        if (ns === 'realtime' && method === 'getStatus') return async () => ({ state: 'ready', retryAt: undefined, syncing: false })
        if (ns === 'dialogs' && method === 'getDialogs') return getDialogs
        return async () => undefined
      },
    }),
  }) as unknown as Managers
  return { managers, getDialogs }
}

const dialog = (peerId: PeerId): Dialog => ({
  peerId, type: 'private', title: 't' + peerId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
} as Dialog)

const scrollers = () => [...document.querySelectorAll<HTMLElement>('.folders-scrollable')]
const activeScroller = () => document.querySelector<HTMLElement>('.folders-scrollable.active')!
/** Узел, на котором Sidebar держит --chatlist-overlay-height (tweb bottomPart). */
const overlayHost = () => document.querySelector<HTMLElement>('.connection-status-bottom')!

/** Доводка: троттлинг измерения скролла (24 мс) + фолбэк-таймер слайда (200+100). */
async function settle(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

let sizeStubbed = false

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
  useChatsStore.getState().applyDialogOps([{
    op: 'reset',
    items: Array.from({ length: DIALOGS }, (_, i) => ({ dialog: dialog(i + 1), index: DIALOGS - i })),
  }])
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useAppStateStore.setState({ folders: [FOLDER], drafts: [] })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })

  if (!sizeStubbed) {
    sizeStubbed = true
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('folders-scrollable') ? HOST_HEIGHT : 0 },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('folders-scrollable') ? 360 : 0 },
    })
  }
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function renderSidebar() {
  const { managers, getDialogs } = fakeManagers()
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})
  return { getDialogs }
}

/** Клик по табу папки — тот самый путь, где раньше стоял ручной `scrollTop = 0`. */
async function clickTab(title: string) {
  await act(async () => { fireEvent.click(screen.getByText(title)) })
  await settle(60)
}

async function scrollActiveTo(top: number) {
  const host = activeScroller()
  act(() => {
    host.scrollTop = top
    host.dispatchEvent(new Event('scroll'))
  })
  await settle(60)
}

describe('Sidebar — свой скроллер на каждую папку', () => {
  it('--chatlist-overlay-height стоит на общем предке ВСЕХ кадров', async () => {
    await renderSidebar()
    await clickTab('Работа')

    // Пока играет слайд, скроллеров в DOM два — и оба под узлом с переменной.
    expect(scrollers().length).toBe(2)
    expect(overlayHost().style.getPropertyValue('--chatlist-overlay-height')).not.toBe('')
    for (const el of scrollers()) expect(overlayHost().contains(el)).toBe(true)
  })

  it('папка помнит свой scrollTop: ушли и вернулись — позиция на месте', async () => {
    await renderSidebar()

    const all = activeScroller()
    await scrollActiveTo(HOST_HEIGHT)
    expect(all.scrollTop).toBe(HOST_HEIGHT)

    await clickTab('Работа')
    await settle(350) // слайд доигран

    // Своя папка — свой скроллер: у новой прокрутка нулевая, у прежней сохранена.
    expect(activeScroller()).not.toBe(all)
    expect(activeScroller().scrollTop).toBe(0)
    expect(all.scrollTop).toBe(HOST_HEIGHT)

    await clickTab('All')
    await settle(350)

    // Мутация: вернуть `el.scrollTop = 0` в `useSidebarFolders.changeFolder`.
    expect(activeScroller()).toBe(all)
    expect(activeScroller().scrollTop).toBe(HOST_HEIGHT)
  })
})
