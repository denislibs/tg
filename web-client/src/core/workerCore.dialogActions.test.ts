// Task 4 (действия без оптимистики): проверяет, что createWorkerCore() РЕАЛЬНО
// прокидывает воркерный dialogsManager в newGroupsManager/newChatThemesManager
// (`newGroupsManager({ rest, dialogs })` / `newChatThemesManager({ rest, dialogs })`,
// workerCore.ts) — не только что сами менеджеры умеют звать применялку при
// правильно собранной зависимости (это отдельно покрыто groupsManager.test.ts/
// chatThemesManager.test.ts), а что РЕАЛЬНАЯ проводка внутри createWorkerCore()
// действительно связывает REST-менеджер с ТЕМ ЖЕ владельцем, чей fillMirror()
// отвечает на RPC 'dialogs'. Приём — тот же, что в workerCore.test.ts (единственный
// живой fetch файла, вкладке RPC): поднимаем настоящий core.bind() (без start() —
// он не нужен, tokens.ready() сам грузит токен из fake-indexeddb) и зовём
// groups.setMute/chatThemes.setChatTheme через РЕАЛЬНЫЙ RPC, подсовывая
// фейковый successful fetch вместо сети.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { saveDialogs } from './store/persist'
import type { Dialog } from './models'
import type { DialogOp } from './dialogs/dialogOps'
import { makeDialog, makeLastMessage } from './dialogs/testDialog'
import { MUTE_UNTIL_FOREVER } from './dialogs/notifySettings'

const dialog = (peerId: number, at: string): Dialog => makeDialog({ peerId, lastMessage: makeLastMessage({ peerId, id: 1, fromId: 1, text: 'x', createdAt: at }) })

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

/** Поднимает воркер с диалогом peerId=1 уже в кэше dialogsManager (через fillMirror). */
async function bootWithSeededDialog(): Promise<{ tab: SuperMessagePort; dialogOps: DialogOp[] }> {
  await saveDialogs([dialog(1, '2026-08-01T00:00:00Z')])
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const dialogOps: DialogOp[] = []
  tab.on('rt:dialog_op', (p) => dialogOps.push(...(p as { ops: DialogOp[] }).ops))
  await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })
  dialogOps.length = 0 // интересуют только операции от самого RPC-действия, не reset
  return { tab, dialogOps }
}

describe('createWorkerCore(): действия без оптимистики — groups/chatThemes реально получают владельца (Task 4)', () => {
  it('groups.setMute(1, true) по RPC → rt:dialog_op patch (реальный dialogsManager, не мок)', async () => {
    const { tab, dialogOps } = await bootWithSeededDialog()

    await tab.invoke('manager', { name: 'groups', method: 'setMute', args: [1, true] })

    // Применялке уезжает КОНСТРУКТОР со сроком — тот же, что построит бэкенд;
    // «навсегда» это далёкий срок, а не отдельный флаг.
    expect(dialogOps).toEqual([
      { op: 'patch', peerId: 1, fields: { notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER } } },
    ])
  })

  it('groups.setMute(1, true, until) по RPC → тот же СРОК, а не «навсегда»', async () => {
    const { tab, dialogOps } = await bootWithSeededDialog()
    const until = Math.floor(Date.now() / 1000) + 3600

    await tab.invoke('manager', { name: 'groups', method: 'setMute', args: [1, true, until] })

    expect(dialogOps).toEqual([
      { op: 'patch', peerId: 1, fields: { notify_settings: { _: 'peerNotifySettings', mute_until: until } } },
    ])
  })

  // `chatThemes` владельца диалогов БОЛЬШЕ НЕ ПОЛУЧАЕТ: тема живёт в полной
  // карточке пира (решение Р7), её применяет проектор на главном потоке.
  it('chatThemes.setChatTheme(1, "sunset") по RPC — строку диалога не трогает', async () => {
    const { tab, dialogOps } = await bootWithSeededDialog()

    await tab.invoke('manager', { name: 'chatThemes', method: 'setChatTheme', args: [1, 'sunset'] })

    expect(dialogOps).toEqual([])
  })
})
