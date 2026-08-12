import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { applyFolderUpdate, loadFolders } from './foldersStore'
import { registerRefetchSubscriber } from '../client/realtime/refetchSubscriber'
import rootScope from '@lib/rootScope'
import { RT } from '../core/realtime/events'
import type { Managers } from '../client/bootstrap'
import type { Folder } from '../core/managers/foldersManager'

const stateKey = vi.fn().mockResolvedValue(undefined)

// Форма Folder — из core/managers/foldersManager.ts, не выдумывать.
const mkFolder = (id: number, title: string, pos = id): Folder => ({
  id, title, pos,
  contacts: false, nonContacts: false, groups: true, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
})
const work = mkFolder(7, 'Работа')
const fun = mkFolder(8, 'Отдых')

// Снимок папки в кадре folder_update — снейк-кейс бэкенда
// (backend/internal/usecase/folders/folders.go:94-102, функция folderJSON).
const snapshot = (f: Folder) => ({
  id: f.id, title: f.title, pos: f.pos,
  contacts: f.contacts, non_contacts: f.nonContacts,
  groups: f.groups, broadcasts: f.broadcasts, bots: false,
  exclude_muted: f.excludeMuted, exclude_read: f.excludeRead,
  include_chats: f.includeChats, exclude_chats: f.excludeChats,
})

function managersWith(list: Folder[], contacts: number[] = []) {
  return {
    folders: { list: vi.fn().mockResolvedValue(list) },
    contacts: { list: vi.fn().mockResolvedValue(contacts.map((userId) => ({ userId }))) },
  }
}

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('loadFolders: cache-first', () => {
  it('папки уже в памяти — в сеть НЕ ходим', async () => {
    useAppStateStore.setState({ folders: [work] })
    const m = managersWith([work])

    await loadFolders(m)

    expect(m.folders.list).not.toHaveBeenCalled()
  })

  it('контакты обновляем даже при попадании в кэш папок', async () => {
    useAppStateStore.setState({ folders: [work] })
    const m = managersWith([work], [1, 2])

    await loadFolders(m)

    expect(m.contacts.list).toHaveBeenCalledTimes(1)
  })

  it('память пуста — идём в сеть', async () => {
    const m = managersWith([work])

    await loadFolders(m)

    expect(m.folders.list).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().folders).toEqual([work])
  })

  it('overwrite: true — идём в сеть даже с непустой памятью', async () => {
    useAppStateStore.setState({ folders: [work] })
    const m = managersWith([work, fun])

    await loadFolders(m, { overwrite: true })

    expect(m.folders.list).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([7, 8])
  })
})

describe('loadFolders: реконсайл', () => {
  it('ответ идентичен памяти — массив НЕ пересоздаётся и в IDB не пишем', async () => {
    useAppStateStore.setState({ folders: [work] })
    const before = useAppStateStore.getState().folders
    stateKey.mockClear()

    await loadFolders(managersWith([{ ...work }]), { overwrite: true })

    expect(useAppStateStore.getState().folders).toBe(before)
    expect(stateKey).not.toHaveBeenCalledWith('folders', expect.anything())
  })

  it('изменилась одна папка — у второй ссылка сохраняется', async () => {
    useAppStateStore.setState({ folders: [work, fun] })
    const funBefore = useAppStateStore.getState().folders[1]

    await loadFolders(managersWith([{ ...work, title: 'Работа!' }, { ...fun }]), { overwrite: true })

    const after = useAppStateStore.getState().folders
    expect(after[0].title).toBe('Работа!')
    expect(after[1]).toBe(funBefore)
  })

  it('папка исчезла из ответа — удаляется', async () => {
    useAppStateStore.setState({ folders: [work, fun] })

    await loadFolders(managersWith([{ ...work }]), { overwrite: true })

    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([7])
  })

  it('сеть упала — память не трогаем', async () => {
    useAppStateStore.setState({ folders: [work] })
    const before = useAppStateStore.getState().folders

    await loadFolders({
      folders: { list: vi.fn().mockRejectedValue(new Error('offline')) },
      contacts: { list: vi.fn().mockRejectedValue(new Error('offline')) },
    }, { overwrite: true })

    expect(useAppStateStore.getState().folders).toBe(before)
  })
})

describe('applyFolderUpdate: снимок папки из realtime', () => {
  it('изменение полей применяется из снимка', () => {
    useAppStateStore.setState({ folders: [work, fun] })

    applyFolderUpdate({ folder: snapshot({ ...work, title: 'Работа!' }) })

    expect(useAppStateStore.getState().folders.map((f) => f.title)).toEqual(['Работа!', 'Отдых'])
  })

  it('соседняя папка сохраняет ССЫЛКУ', () => {
    useAppStateStore.setState({ folders: [work, fun] })
    const funBefore = useAppStateStore.getState().folders[1]

    applyFolderUpdate({ folder: snapshot({ ...work, title: 'Работа!' }) })

    expect(useAppStateStore.getState().folders[1]).toBe(funBefore)
  })

  it('снимок совпал с памятью — массив НЕ пересоздаётся и в IDB не пишем', () => {
    useAppStateStore.setState({ folders: [work] })
    const before = useAppStateStore.getState().folders
    stateKey.mockClear()

    applyFolderUpdate({ folder: snapshot(work) })

    expect(useAppStateStore.getState().folders).toBe(before)
    expect(stateKey).not.toHaveBeenCalledWith('folders', expect.anything())
  })

  it('новая папка встаёт по своему pos (бэкенд: ORDER BY pos, id)', () => {
    useAppStateStore.setState({ folders: [mkFolder(7, 'Работа', 0), mkFolder(9, 'Всё', 2)] })

    applyFolderUpdate({ folder: snapshot(mkFolder(8, 'Отдых', 1)) })

    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([7, 8, 9])
  })

  it('удаление: {folder_id, deleted} убирает папку', () => {
    useAppStateStore.setState({ folders: [work, fun] })

    applyFolderUpdate({ folder_id: 7, deleted: true })

    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([8])
  })

  it('удаление уже удалённой папки — массив НЕ пересоздаётся', () => {
    useAppStateStore.setState({ folders: [fun] })
    const before = useAppStateStore.getState().folders

    applyFolderUpdate({ folder_id: 7, deleted: true })

    expect(useAppStateStore.getState().folders).toBe(before)
  })

  it('снимок раскладывается в camelCase-модель Folder целиком', () => {
    applyFolderUpdate({
      folder: {
        id: 5, title: 'Смесь', pos: 3,
        contacts: true, non_contacts: true, groups: false, broadcasts: true, bots: true,
        exclude_muted: true, exclude_read: true,
        include_chats: [11, 12], exclude_chats: [13],
      },
    })

    expect(useAppStateStore.getState().folders).toEqual([{
      id: 5, title: 'Смесь', pos: 3,
      contacts: true, nonContacts: true, groups: false, broadcasts: true,
      excludeMuted: true, excludeRead: true,
      includeChats: [11, 12], excludeChats: [13],
    }])
  })
})

describe('refetchSubscriber: folder_update без похода в сеть', () => {
  it('кадр folder_update применяется снимком, managers.folders.list НЕ зовётся', () => {
    useAppStateStore.setState({ folders: [work, fun] })
    const list = vi.fn()
    registerRefetchSubscriber({
      folders: { list },
      messages: { listPins: vi.fn() },
    } as unknown as Managers)

    rootScope.dispatchEventSingle(RT.folderUpdate, { folder: snapshot({ ...fun, title: 'Отдых!' }) })

    expect(list).not.toHaveBeenCalled()
    expect(useAppStateStore.getState().folders.map((f) => f.title)).toEqual(['Работа', 'Отдых!'])
  })
})
