// Task 2 (перенос владения диалогами): холодный старт переключён на владельца
// (managers.dialogs.fillMirror()) вместо managers.chats.listDialogs() +
// hydrateDialogsFromPersist(). bootstrap() целиком не тестируем — она реальная
// точка входа (как core/worker.ts): startClient() конструирует настоящий
// SharedWorker/Worker, а managers.dialogs.fillMirror()/refresh() — RPC-вызовы
// через SuperMessagePort к нему, которые без настоящего воркера на другом
// конце просто зависли бы (порт не отвечает на invoke). Поэтому содержательная
// логика вынесена в fillDialogsMirror/applyDialogsMirror — их тестируем здесь
// напрямую с фейковым managers.dialogs, без SharedWorker/IDB.
//
// Сети на старте boot НЕ зовёт вовсе — старт списка как у tweb
// `dialogsStorage.getDialogs` (lib/storages/dialogs.ts:1903-1914): кэш отдаёт
// страницу, если его хватает, иначе один запрос, и решает это сам список.
// Прежний безусловный `refresh()` приходил вторым `reset` поверх кэша и
// перетасовывал уже нарисованный список. Сквозной путь до самих списков
// (архив, папки) — `client/boot.firstPage.test.tsx`.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fillDialogsMirror, applyDialogsMirror } from './boot'
import { useChatsStore } from '../stores/chatsStore'
import type { Dialog } from '../core/models'
import type { DialogOp } from '../core/dialogs/dialogOps'
import type { Managers } from './bootstrap'
import { makeDialog } from '../core/dialogs/testDialog'

const dialog = (peerId: number): Dialog => makeDialog({ peerId })

/** `getDialogs`/`refresh` фейк держит, чтобы мутация «вернуть сетевой догон
 *  в boot» дошла до ассерта, а не упала на отсутствующем методе. */
function fakeManagers(op: DialogOp) {
  const fillMirror = vi.fn(async () => op)
  const getDialogs = vi.fn(async () => ({ dialogs: [], count: 0, isEnd: false }))
  const refresh = vi.fn(async () => null)
  return {
    managers: { dialogs: { fillMirror, getDialogs, refresh } } as unknown as Pick<Managers, 'dialogs'>,
    fillMirror, getDialogs, refresh,
  }
}

describe('boot: холодный старт диалогов — зеркало через владельца', () => {
  beforeEach(() => { useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false }) })

  describe('fillDialogsMirror', () => {
    it('зовёт managers.dialogs.fillMirror()', async () => {
      const op: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers, fillMirror } = fakeManagers(op)

      const result = await fillDialogsMirror(managers)

      expect(fillMirror).toHaveBeenCalledTimes(1)
      expect(result).toEqual(op)
    })
  })

  describe('applyDialogsMirror', () => {
    it('применяет ответ владельца к витрине синхронно, до первого рендера', () => {
      const op: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 }] }

      applyDialogsMirror(op)

      expect(useChatsStore.getState().dialogs.map((d) => d.peerId)).toEqual([2, 1])
      expect(useChatsStore.getState().loaded).toBe(true)
    })

    it('null — витрину не трогает', () => {
      applyDialogsMirror(null)
      expect(useChatsStore.getState().loaded).toBe(false)
    })
  })

  // Старт из кэша без сети: ни сетевого догона (`refresh()`), ни своей
  // страницы boot не просит — страницы решает список через `getDialogs`.
  it('bootstrap-часть диалогов не ходит в сеть: ни refresh(), ни getDialogs', async () => {
    const op: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
    const { managers, refresh, getDialogs } = fakeManagers(op)

    applyDialogsMirror(await fillDialogsMirror(managers))
    await new Promise((r) => setTimeout(r, 0))

    expect(refresh).not.toHaveBeenCalled()
    expect(getDialogs).not.toHaveBeenCalled()
  })
})
