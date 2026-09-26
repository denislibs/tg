// Реестр живых аватарок (`components/avatar.ts`) не владеет тем, что
// отслеживает — порт tweb e19e8831d (avatarNew.tsx: `avatarsMap` на WeakRef,
// `avatarByElement`, FinalizationRegistry).
//
// Прежний реестр — `Set<Avatar>` со снятием только по `middleware.onClean`:
// аватарка, чей владелец так и не погасил мидлварь (вызов вне зоны
// актуальности, мидлварь, которая не выстрелила), жила до закрытия вкладки
// вместе со всем отсоединённым поддеревом. В tweb это были 14 197 узлов в
// суточной вкладке — крупнейший удерживатель кучи.
//
// Пины смотрят на сборку мусора напрямую: `gc` из V8 включается флагом в
// рантайме (`v8.setFlagsFromString` + `vm.runInNewContext('gc')`), дальше
// WeakRef на узел говорит, собран ли он.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import v8 from 'node:v8'
import vm from 'node:vm'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const { avatarNew } = await import('./avatar')
type AvatarManagers = import('./avatar').AvatarManagers

const ALICE = 5

const managers: AvatarManagers = { peers: { fillMirror: vi.fn(async () => {}) } }

/** WeakRef держит цель до конца текущей задачи — сборку зовём после тика. */
async function collect() {
  for (let i = 0; i < 3; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    gc()
  }
}

const initials = (node: HTMLElement) =>
  Array.from(node.childNodes)
    .map((n) => (n instanceof HTMLImageElement ? n.alt : n.textContent))
    .join('')

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} }] }])
})

afterEach(() => {
  resetPeerMirror()
})

describe('avatar — реестр живых аватарок (tweb e19e8831d)', () => {
  it('аватарка, чей владелец не погасил мидлварь, собирается вместе с узлом', async () => {
    // Мидлварь не гаснет никогда: помощник уходит вместе с областью видимости.
    const nodeRef = (() => {
      const helper = getMiddleware()
      const { node } = avatarNew({ peerId: ALICE, size: 40, middleware: helper.get(), managers })
      return new WeakRef(node)
    })()

    await collect()
    expect(nodeRef.deref()).toBeUndefined()

    // Движение зеркала после сборки не спотыкается о собранную запись.
    expect(() => applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Борис', pFlags: {} }] }])).not.toThrow()
  })

  it('пока узел достижим, аватарка жива и перерисовывается (avatarByElement — сильное ребро)', async () => {
    // Держим только УЗЕЛ — так список чатов держит строки на перемонтаж.
    const node = (() => {
      const helper = getMiddleware()
      return avatarNew({ peerId: ALICE, size: 40, middleware: helper.get(), managers }).node
    })()
    expect(initials(node)).toBe('А')

    await collect()
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Борис', pFlags: {} }] }])

    expect(initials(node)).toBe('Б')
  })

  it('погашенная мидлварь снимает аватарку с реестра сразу', () => {
    const helper = getMiddleware()
    const { node } = avatarNew({ peerId: ALICE, size: 40, middleware: helper.get(), managers })
    helper.destroy()

    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Борис', pFlags: {} }] }])
    expect(initials(node)).toBe('А')
  })
})
