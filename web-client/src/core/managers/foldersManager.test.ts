// Пины провода папок (`foldersManager.ts`) против ручек бэкенда
// (`backend/internal/adapter/delivery/http/folders_handler.go`: `folderBody` и
// `folderJSON`) и кадра `folder_update` (`usecase/folders/folders.go::folderJSON`).
//
// Два дефекта, ради которых файл заведён (задача 24 плана 2D):
//  1. флаг `bots` терялся в обе стороны — `mapFolder` его не читал, `toRaw`
//     слал `bots: false`, и категория «Боты» редактора папки не сохранялась;
//  2. списки пиров шли под именами `include_chats`/`exclude_chats`, а бэкенд с
//     перевода адресации на `PeerId` (8c84b326) принимает и отдаёт
//     `include_peers`/`exclude_peers` — «Добавить чаты» не сохранялось вовсе, а
//     прочитанная папка приходила с пустыми списками.
import { describe, expect, it, vi } from 'vitest'
import { mapFolder, newFoldersManager, type FolderInput, type RawFolder } from './foldersManager'

const RAW: RawFolder = {
  id: 3, title: 'Боты', pos: 1,
  contacts: false, non_contacts: false, groups: false, broadcasts: false, bots: true,
  exclude_muted: true, exclude_read: false,
  include_peers: [5, -100], exclude_peers: [7],
}

const INPUT: FolderInput = {
  title: 'Боты',
  contacts: false, nonContacts: false, groups: false, broadcasts: false, bots: true,
  excludeMuted: true, excludeRead: false,
  includeChats: [5, -100], excludeChats: [7],
}

describe('foldersManager — провод папки', () => {
  it('снимок сервера: bots и списки пиров доезжают до модели', () => {
    expect(mapFolder(RAW)).toEqual({ id: 3, pos: 1, ...INPUT })
  })

  it('create/update шлют bots и include_peers/exclude_peers — поля, которые читает folderBody', async () => {
    const post = vi.fn(async () => RAW)
    const put = vi.fn(async () => RAW)
    const rest = { get: vi.fn(), post, put, del: vi.fn() }
    const folders = newFoldersManager({ rest: rest as never })

    await folders.create(INPUT)
    await folders.update(3, INPUT)

    const body = {
      title: 'Боты',
      contacts: false, non_contacts: false, groups: false, broadcasts: false, bots: true,
      exclude_muted: true, exclude_read: false,
      include_peers: [5, -100], exclude_peers: [7],
    }
    expect(post).toHaveBeenCalledWith('/me/folders', body)
    expect(put).toHaveBeenCalledWith('/me/folders/3', body)
  })
})

describe('foldersManager — порядок папок (Ф7-З)', () => {
  it('list: all_chats_pos доезжает до модели; нет поля — 0', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ folders: [RAW], all_chats_pos: 2 })
      .mockResolvedValueOnce({ folders: [] })
    const folders = newFoldersManager({ rest: { get, post: vi.fn(), put: vi.fn(), del: vi.fn() } as never })

    expect(await folders.list()).toEqual({ folders: [mapFolder(RAW)], allChatsPos: 2 })
    expect(await folders.list()).toEqual({ folders: [], allChatsPos: 0 })
  })

  it('updateOrder шлёт POST /me/folders/order {order}', async () => {
    const post = vi.fn(async () => ({ _: 'boolTrue' }))
    const folders = newFoldersManager({ rest: { get: vi.fn(), post, put: vi.fn(), del: vi.fn() } as never })

    await folders.updateOrder([3, 0, 1])

    expect(post).toHaveBeenCalledWith('/me/folders/order', { order: [3, 0, 1] })
  })
})
