import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { loadFolders, useFoldersStore } from './foldersStore'
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { Folder } from '../core/managers/foldersManager'

const stateKey = vi.fn().mockResolvedValue(undefined)
// Форма Folder — из core/managers/foldersManager.ts, не выдумывать.
const folder: Folder = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: false, groups: true, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  useFoldersStore.setState({ selectedId: ALL_FOLDER_ID, contactIds: new Set() })
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('foldersStore', () => {
  it('загрузка с сети кладёт папки в State (и персистит)', async () => {
    await loadFolders({
      folders: { list: () => Promise.resolve([folder]) },
      contacts: { list: () => Promise.resolve([]) },
      dialogs: { setContactIds: async () => {} },
    })

    expect(useAppStateStore.getState().folders).toEqual([folder])
    expect(stateKey).toHaveBeenCalledWith('folders', [folder])
  })

  it('оффлайн: сеть упала — папки из State остаются', async () => {
    useAppStateStore.setState({ folders: [folder] })

    await loadFolders({
      folders: { list: () => Promise.reject(new Error('offline')) },
      contacts: { list: () => Promise.reject(new Error('offline')) },
      dialogs: { setContactIds: async () => {} },
    })

    expect(useAppStateStore.getState().folders).toEqual([folder])
  })

  it('выбранная папка — UI-состояние, в State не попадает', () => {
    useFoldersStore.getState().select(7)

    expect(useFoldersStore.getState().selectedId).toBe(7)
    expect(stateKey).not.toHaveBeenCalledWith('selectedId', expect.anything())
  })

  it('удаление папки сбрасывает выбор на «Все чаты»', () => {
    useAppStateStore.setState({ folders: [folder] })
    useFoldersStore.getState().select(7)

    useFoldersStore.getState().remove(7)

    expect(useAppStateStore.getState().folders).toEqual([])
    expect(useFoldersStore.getState().selectedId).toBe(ALL_FOLDER_ID)
  })
})
