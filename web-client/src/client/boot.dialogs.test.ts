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
// Первичная сетевая загрузка — `refresh()`, и страничность живёт ВНУТРИ него
// (`dialogsManager.ts::doRefresh` просит окно удерживаемого, на пустом кэше —
// одну страницу). Здесь пинится только развилка boot: догон идёт через
// `refresh()` и без единой собственной страницы `getDialogs` — иначе у boot
// появился бы второй, свой размер первого окна. Сквозной путь до самих списков
// (архив, папки) — `client/boot.firstPage.test.tsx`.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fillDialogsMirror, applyDialogsMirror } from './boot'
import { useChatsStore } from '../stores/chatsStore'
import type { Dialog } from '../core/models'
import type { DialogOp } from '../core/dialogs/dialogOps'
import type { Managers } from './bootstrap'

const dialog = (chatId: number): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
} as Dialog)

/**
 * `netOp` — то, чем отвечает сетевой догон (`refresh()`); `op` тесты передают
 * в `applyDialogsMirror` аргументом, как это делает `bootstrap()` ответом
 * `fillMirror()`. `getDialogs` фейк держит, чтобы мутация «вернуть постраничный
 * догон» дошла до ассерта, а не упала на отсутствующем методе.
 */
function fakeManagers(op: DialogOp, netOp: DialogOp | null = null) {
  const calls: string[] = []
  const fillMirror = vi.fn(async () => { calls.push('fillMirror'); return op })
  const getDialogs = vi.fn(async () => { calls.push('getDialogs'); return { dialogs: [], count: 0, isEnd: false } })
  const refresh = vi.fn(async () => { calls.push('refresh'); return netOp })
  return {
    managers: { dialogs: { fillMirror, getDialogs, refresh } } as unknown as Pick<Managers, 'dialogs'>,
    fillMirror, getDialogs, refresh, calls,
  }
}

describe('boot: холодный старт диалогов — зеркало через владельца', () => {
  beforeEach(() => { useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false }) })

  describe('fillDialogsMirror', () => {
    it('не под локом — зовёт managers.dialogs.fillMirror()', async () => {
      const op: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers, fillMirror } = fakeManagers(op)

      const result = await fillDialogsMirror(managers, false)

      expect(fillMirror).toHaveBeenCalledTimes(1)
      expect(result).toEqual(op)
    })

    it('под локом — НЕ зовёт fillMirror(), отдаёт null', async () => {
      const op: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers, fillMirror } = fakeManagers(op)

      const result = await fillDialogsMirror(managers, true)

      expect(fillMirror).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })
  })

  describe('applyDialogsMirror', () => {
    it('op не null — применяет его к витрине ДО возврата (холодный старт ждёт применения, не только ответа RPC)', async () => {
      const op: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 }] }
      const { managers } = fakeManagers(op)

      await applyDialogsMirror(op, managers, false)

      expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([2, 1])
      expect(useChatsStore.getState().loaded).toBe(true)
    })

    it('op null (лок) — витрину не трогает', async () => {
      const op: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers } = fakeManagers(op)

      await applyDialogsMirror(null, managers, true)

      expect(useChatsStore.getState().dialogs).toEqual([])
    })

    // Fix (финальное ревью, Important #2): единственным каналом доставки reset'а
    // от догона был бродкаст `rt:dialog_op`, а насос поднимается только в
    // `startRealtime()` (эффект useAppBootstrap) — ПОСЛЕ первого рендера, и кадры
    // до подписки никто не буферизует. Ответивший раньше `/chats` (localhost,
    // быстрая сеть) уходил в никуда, и вкладка весь сеанс жила на дисковом кэше.
    // Правило то же, что у fillMirror: пробел закрывает ОТВЕТ RPC.
    it('ответ сетевого догона применяется из результата RPC, а не только бродкастом', async () => {
      const cacheOp: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const netOp: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 30 }] }
      const { managers } = fakeManagers(cacheOp, netOp)

      await applyDialogsMirror(cacheOp, managers, false)

      expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([2, 1])
    })

    it('догон вернул null (ответ совпал с памятью) — зеркало не трогаем', async () => {
      const cacheOp: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers } = fakeManagers(cacheOp, null)

      await applyDialogsMirror(cacheOp, managers, false)

      expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1])
    })

    // Minor #3: refresh() пробрасывает HttpError — промис догона, который уезжает
    // в bootData (на нём висит сид презенса), отклоняться наружу не должен.
    it('догон упал (401/5xx) — промис резолвится, витрина остаётся на кэше', async () => {
      const cacheOp: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers, refresh } = fakeManagers(cacheOp)
      ;(refresh as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('401'))

      await expect(applyDialogsMirror(cacheOp, managers, false)).resolves.toBeUndefined()
      expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1])
    })
  })

  // Размер первого окна знает ровно один слой — владелец (`doRefresh`). Своей
  // страницы boot не просит: второй размер первого окна на витрине разошёлся бы
  // с владельцем при первой же правке одного из них.
  describe('applyDialogsMirror: догон идёт через refresh(), а не своей страницей', () => {
    it('не под локом — зовёт refresh() и ни одной страницы getDialogs', async () => {
      const op: DialogOp = { op: 'reset', items: [] }
      const { managers, refresh, getDialogs } = fakeManagers(op)

      await applyDialogsMirror(op, managers, false)

      // Мутация: вернуть `getDialogs({limit: guessLoadCount()})` вместо
      // `refresh()` — оба ассерта краснеют.
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(refresh).toHaveBeenCalledWith() // окно выбирает владелец, а не boot
      expect(getDialogs).not.toHaveBeenCalled()
    })

    it('под локом — сети нет вовсе: ни refresh, ни getDialogs, ни fillMirror', async () => {
      const op: DialogOp = { op: 'reset', items: [] }
      const { managers, getDialogs, fillMirror, refresh } = fakeManagers(op)

      await applyDialogsMirror(null, managers, true)

      expect(refresh).not.toHaveBeenCalled()
      expect(getDialogs).not.toHaveBeenCalled()
      expect(fillMirror).not.toHaveBeenCalled()
    })
  })
})
