// Лимит своих реакций ЗАВИСИТ ОТ ПОДПИСКИ — и подписку воркер обязан взять из
// живой личности, а не считать её отсутствующей.
//
// Пин заведён по итогам ревью: подмена `getMePremium` в `workerCore.ts` на
// «премиума нет всегда» не роняла ни одного теста. Единственный тест, который
// этот геттер трогал (`managers/messages/reactionMethods.test.ts`), подставляет
// СВОЙ стаб и о проводке в `createWorkerCore` не знает ничего. В бою цена
// мутации — премиум-аккаунт с клиентским лимитом 1 против серверных 3: две из
// трёх своих реакций исчезали бы из ленты сразу после клика и возвращались с
// кадром.
//
// Поэтому прогон здесь НАСТОЯЩИЙ: `createWorkerCore()` + `core.start()`, тот же
// `messagesManager` и тот же персист, что в проде; личность приезжает с диска
// (`saveMe`), как на холодном старте. fake-indexeddb — ПЕРВОЙ строкой
// (`newCursor()`/`newConnectionManager()` читают IndexedDB прямо в конструкторе).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { saveMe } from './store/persist'
import { makeRawMessage } from './messages/testMessage'
import { generateMessageId } from './history/messageId'
import { myEmoticons } from './reactions/messageReactions'
import { RT } from './realtime/events'
import type { PeerProfile } from './managers/authManager'
import type { MessageOp } from './realtime/messageOps'
import type { MessageReactions } from './models'

const ME = 7
const DM = 42

const profile = (premium: boolean): PeerProfile => ({
  user: {
    _: 'user',
    pFlags: premium ? { self: true, premium: true } : { self: true },
    id: ME,
    phone: '+79990000007',
    username: 'me',
    first_name: 'Я',
    photo: { _: 'userProfilePhotoEmpty' },
  },
  fullUser: { _: 'userFull', id: ME },
  canMessage: true,
})

const historyPage = {
  messages: [makeRawMessage({ id: 2, peerId: DM, fromId: 5, text: 'm2' })],
  count: 1,
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.includes(`/chats/${DM}/history`)) return new Response(JSON.stringify(historyPage), { status: 200 })
    if (u.includes('/reactions') && init?.method === 'POST') return new Response('{}', { status: 200 })
    throw new Error('unexpected fetch ' + u)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

/** Агрегат, объявленный окну последней операцией клика. */
function declared(ops: MessageOp[]): MessageReactions | undefined {
  const last = ops[ops.length - 1]
  return last && last.op === 'patch' ? (last.fields.reactions as MessageReactions | undefined) : undefined
}

async function clickThree(premium: boolean): Promise<string[]> {
  await saveMe(profile(premium))
  const core = createWorkerCore()
  core.start()
  const ops: MessageOp[] = []
  core.workerScope.scope.addEventListener(RT.messageOp, (p) => ops.push(...(p as { ops: MessageOp[] }).ops))

  await core.registry.messages.getHistory({ peerId: DM })
  for (const e of ['❤', '🔥', '🥰']) await core.registry.messages.react(DM, generateMessageId(2), e)
  return myEmoticons(declared(ops))
}

describe('createWorkerCore(): лимит своих реакций читает подписку из личности', () => {
  it('у премиума уживаются ТРИ свои реакции', async () => {
    expect(await clickThree(true)).toEqual(['❤', '🔥', '🥰'])
  })

  // Обратная сторона того же геттера: без подписки лимит базовый, и третий клик
  // оставляет одну реакцию. Без этой половины «премиум всегда есть» прошло бы
  // так же тихо, как «премиума нет никогда».
  it('без подписки остаётся ОДНА', async () => {
    expect(await clickThree(false)).toEqual(['🥰'])
  })
})
