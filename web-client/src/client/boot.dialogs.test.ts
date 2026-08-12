// Task 2 (перенос владения диалогами): холодный старт переключён на владельца
// (managers.dialogs.fillMirror()) вместо managers.chats.listDialogs() +
// hydrateDialogsFromPersist(). bootstrap() целиком не тестируем — она реальная
// точка входа (как core/worker.ts): startClient() конструирует настоящий
// SharedWorker/Worker, а managers.dialogs.fillMirror()/refresh() — RPC-вызовы
// через SuperMessagePort к нему, которые без настоящего воркера на другом
// конце просто зависли бы (порт не отвечает на invoke). Поэтому содержательная
// логика вынесена в fillDialogsMirror/applyDialogsMirror — их тестируем здесь
// напрямую с фейковым managers.dialogs, без SharedWorker/IDB.
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

function fakeManagers(op: DialogOp, netOp: DialogOp | null = null) {
  const fillMirror = vi.fn(async () => op)
  const refresh = vi.fn(async () => netOp)
  return { managers: { dialogs: { fillMirror, refresh } } as unknown as Pick<Managers, 'dialogs'>, fillMirror, refresh }
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
    // от `refresh()` был бродкаст `rt:dialog_op`, а насос поднимается только в
    // `startRealtime()` (эффект useAppBootstrap) — ПОСЛЕ первого рендера, и кадры
    // до подписки никто не буферизует. Ответивший раньше `/chats` (localhost,
    // быстрая сеть) уходил в никуда, и вкладка весь сеанс жила на дисковом кэше:
    // `useAppBootstrap` при валидном префетче refresh сознательно не повторяет.
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
      const before = useChatsStore.getState().dialogs

      expect(before.map((d) => d.chatId)).toEqual([1])
    })

    // Minor #3: refresh() пробрасывает HttpError — промис догона, который уезжает
    // в bootData (на нём висит сид презенса), отклоняться наружу не должен.
    it('догон упал (401/5xx) — промис резолвится, витрина остаётся на кэше', async () => {
      const cacheOp: DialogOp = { op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }
      const { managers } = fakeManagers(cacheOp)
      ;(managers.dialogs.refresh as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('401'))

      await expect(applyDialogsMirror(cacheOp, managers, false)).resolves.toBeUndefined()
      expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1])
    })

    it('не под локом — запускает сетевой догон (refresh)', async () => {
      const op: DialogOp = { op: 'reset', items: [] }
      const { managers, refresh } = fakeManagers(op)

      await applyDialogsMirror(op, managers, false)

      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('под локом — НЕ запускает refresh', async () => {
      const op: DialogOp = { op: 'reset', items: [] }
      const { managers, refresh } = fakeManagers(op)

      await applyDialogsMirror(null, managers, true)

      expect(refresh).not.toHaveBeenCalled()
    })
  })
})
