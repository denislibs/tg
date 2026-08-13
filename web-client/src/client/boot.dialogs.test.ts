// Task 2 (перенос владения диалогами): холодный старт переключён на владельца
// (managers.dialogs.fillMirror()) вместо managers.chats.listDialogs() +
// hydrateDialogsFromPersist(). bootstrap() целиком не тестируем — она реальная
// точка входа (как core/worker.ts): startClient() конструирует настоящий
// SharedWorker/Worker, а managers.dialogs.fillMirror()/getDialogs() — RPC-вызовы
// через SuperMessagePort к нему, которые без настоящего воркера на другом
// конце просто зависли бы (порт не отвечает на invoke). Поэтому содержательная
// логика вынесена в fillDialogsMirror/applyDialogsMirror — их тестируем здесь
// напрямую с фейковым managers.dialogs, без SharedWorker/IDB.
//
// Этап 3 (виртуальный список): сетевой догон холодного старта — СТРАНИЦА
// (`getDialogs({limit: guessLoadCount()})`), а не полный `refresh()`; см.
// докблок applyDialogsMirror. Пины на это — в describe «постраничный догон».
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fillDialogsMirror, applyDialogsMirror } from './boot'
import { guessLoadCount } from '../core/hooks/useDialogListSource'
import { useChatsStore } from '../stores/chatsStore'
import type { Dialog } from '../core/models'
import type { DialogOp } from '../core/dialogs/dialogOps'
import type { Managers } from './bootstrap'

const dialog = (chatId: number): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
} as Dialog)

/**
 * `fillMirror` у фейка отвечает `netOp ?? op`: в тестах `applyDialogsMirror`
 * ЕДИНСТВЕННЫЙ его вызов — тот, которым догон доставляет страницу в зеркало
 * (ответ на пробел холодного старта эти тесты получают аргументом `op`).
 */
function fakeManagers(op: DialogOp, netOp: DialogOp | null = null) {
  const calls: string[] = []
  const fillMirror = vi.fn(async () => { calls.push('fillMirror'); return netOp ?? op })
  const getDialogs = vi.fn(async () => { calls.push('getDialogs'); return { dialogs: [], count: 0, isEnd: false } })
  const refresh = vi.fn(async () => { calls.push('refresh'); return null })
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

    // Minor #3: догон пробрасывает HttpError — промис, который уезжает в
    // bootData (на нём висит сид презенса), отклоняться наружу не должен.
    it('догон упал (401/5xx) — промис резолвится, витрина остаётся на кэше', async () => {
      const cacheOp: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers, getDialogs } = fakeManagers(cacheOp)
      ;(getDialogs as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('401'))

      await expect(applyDialogsMirror(cacheOp, managers, false)).resolves.toBeUndefined()
      expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1])
    })
  })

  // Этап 3: без этой замены пагинация мертва — полный `refresh()` поднимает у
  // владельца `loadedAll`, и `getDialogs` больше никогда не ходит в сеть.
  describe('applyDialogsMirror: постраничный догон вместо полного refresh()', () => {
    it('не под локом — тянет ОДНУ страницу getDialogs({limit: guessLoadCount()}), полный refresh() не зовёт', async () => {
      const op: DialogOp = { op: 'reset', items: [] }
      const { managers, getDialogs, refresh } = fakeManagers(op)

      await applyDialogsMirror(op, managers, false)

      expect(getDialogs).toHaveBeenCalledTimes(1)
      expect(getDialogs).toHaveBeenCalledWith({ limit: guessLoadCount() })
      expect(refresh).not.toHaveBeenCalled()
    })

    it('страницу доставляет в зеркало fillMirror() — и строго ПОСЛЕ неё', async () => {
      const op: DialogOp = { op: 'reset', items: [] }
      const { managers, fillMirror, calls } = fakeManagers(op)

      await applyDialogsMirror(op, managers, false)

      expect(fillMirror).toHaveBeenCalledTimes(1)
      expect(calls).toEqual(['getDialogs', 'fillMirror'])
    })

    it('под локом — сети нет вовсе: ни getDialogs, ни fillMirror', async () => {
      const op: DialogOp = { op: 'reset', items: [] }
      const { managers, getDialogs, fillMirror, refresh } = fakeManagers(op)

      await applyDialogsMirror(null, managers, true)

      expect(getDialogs).not.toHaveBeenCalled()
      expect(fillMirror).not.toHaveBeenCalled()
      expect(refresh).not.toHaveBeenCalled()
    })
  })
})
