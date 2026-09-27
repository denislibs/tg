// Проводка режима папок из колонки (задача 8 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`): колонка
// сообщает стору `stores/foldersSidebar.solid.ts` (порт tweb
// `stores/foldersSidebar.ts:90-112`), нарисована ли вертикальная колонка, а
// владелец папок — есть ли что показывать. Пин — на классы `<body>`: ряд вкладок
// всегда в DOM, и только `has-horizontal-folders` его показывает
// (`_leftSidebar.scss:304-313`). Формула и видимость под CSS —
// `stores/foldersSidebar.solid.test.ts`.
//
// Отдельный файл (как `Sidebar.chatlist.test.tsx`) — тяжёлое дерево Sidebar
// тянется только сюда.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useAppStateStore } from '../stores/appState'
import { useSettingsStore } from '../settings'
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { Managers } from '../client/bootstrap'
import { FakeResizeObserver } from '../lib/appDialogsManager.testkit'

vi.mock('./StoriesRow', () => ({ default: () => null }))

const FOLDER = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: true, groups: false, broadcasts: false,
  bots: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

// Слой менеджеров — рекурсивный Proxy (приём `Sidebar.chatlist.test.tsx`).
function fakeManagers() {
  return new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => {
        if (ns === 'realtime' && method === 'getStatus') return async () => ({ state: 'ready', retryAt: undefined, syncing: false })
        if (ns === 'dialogs' && method === 'getDialogs') return async () => ({ dialogs: [], count: 0, isEnd: true })
        return async () => undefined
      },
    }),
  }) as unknown as Managers
}

const bodyClasses = () => ['has-horizontal-folders', 'has-vertical-folders']
  .filter((name) => document.body.classList.contains(name))

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

let main: HTMLElement

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: true })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useAppStateStore.setState({ folders: [FOLDER] })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })
  useSettingsStore.setState({ tabsInSidebar: false })
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  // вертикальная колонка — портал в `#main-columns`
  main = document.createElement('div')
  main.id = 'main-columns'
  document.body.append(main)
})

afterEach(() => {
  cleanup()
  main.remove()
  vi.unstubAllGlobals()
  useSettingsStore.setState({ tabsInSidebar: false })
  useAppStateStore.setState({ folders: [] })
})

async function renderSidebar() {
  const view = render(
    <ManagersProvider managers={fakeManagers()}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await settle()
  return view
}

describe('Sidebar — режим папок на <body>', () => {
  it('папки над списком — has-horizontal-folders', async () => {
    await renderSidebar()
    expect(document.getElementById('folders-sidebar')).toBe(null)
    expect(bodyClasses()).toEqual(['has-horizontal-folders'])
  })

  it('«папки слева» — has-vertical-folders, ряд спрятан; вернули над списком — снова горизонтальный', async () => {
    useSettingsStore.setState({ tabsInSidebar: true })
    await renderSidebar()
    expect(document.getElementById('folders-sidebar')).not.toBe(null)
    expect(bodyClasses()).toEqual(['has-vertical-folders'])

    await act(async () => { useSettingsStore.setState({ tabsInSidebar: false }) })
    await settle()
    expect(document.getElementById('folders-sidebar')).toBe(null)
    expect(bodyClasses()).toEqual(['has-horizontal-folders'])
  })

  it('размонтирование колонки снимает оба класса', async () => {
    useSettingsStore.setState({ tabsInSidebar: true })
    const view = await renderSidebar()
    expect(bodyClasses()).toEqual(['has-vertical-folders'])

    view.unmount()
    expect(bodyClasses()).toEqual([])
  })
})
