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

const dialog = (peerId: number, at: string): Dialog => ({
  peerId, type: 'private', title: 't' + peerId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at },
} as Dialog)

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

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { muted: true } }])
  })

  it('chatThemes.setChatTheme(1, "sunset") по RPC → rt:dialog_op patch', async () => {
    const { tab, dialogOps } = await bootWithSeededDialog()

    await tab.invoke('manager', { name: 'chatThemes', method: 'setChatTheme', args: [1, 'sunset'] })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { themeId: 'sunset' } }])
  })
})
