// Пин Solid-адаптера над `core/peerCache.ts` (Task 1, план
// docs/superpowers/plans/2026-09-05-profile-card-solid.md). Мирор — общее
// модульное состояние, поэтому каждый кейс сбрасывает его сам (resetPeerMirror),
// а `managers.peers.fillMirror` подменён моком через `../client/bootstrap`
// — тот же приём, что у `core/mediaUrl.test.ts`.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import { applyPeerOps, resetPeerMirror } from '../core/peerCache'
import type { UserReal } from '../core/peers/peer'

const fillMirror = vi.fn(async (_ids: number[]) => {})
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror } } }),
}))

const user = (id: number, over: Partial<UserReal> = {}): UserReal => ({
  _: 'user',
  id,
  first_name: `U${id}`,
  photo: { _: 'userProfilePhotoEmpty' },
  ...over,
})

beforeEach(() => {
  resetPeerMirror()
  fillMirror.mockClear()
})

describe('usePeer (Solid)', () => {
  it('возвращает пира, уже лежащего в зеркале', async () => {
    const { usePeer } = await import('./peers.solid')
    applyPeerOps([{ op: 'upsert', peers: [user(2, { first_name: 'Боб' })] }])

    createRoot((dispose) => {
      expect(usePeer(2)).toEqual(user(2, { first_name: 'Боб' }))
      dispose()
    })
  })

  it('карточки ещё нет — undefined, и зеркало объявляет пробел ровно один раз', async () => {
    const { usePeer } = await import('./peers.solid')

    let dispose!: () => void
    let value: unknown
    createRoot((d) => {
      dispose = d
      value = usePeer(5)
    })
    expect(value).toBeUndefined()

    // `createEffect` планирует запуск на следующий тик — дожидаемся его перед
    // проверкой (иначе fillMirror ещё не успел бы позваться ни разу).
    await Promise.resolve()
    // МУТАЦИЯ: замени `createEffect(on(idAccessor, …))` на чтение без эффекта —
    // fillMirror либо не позовётся вовсе, либо позовётся на каждый read.
    expect(fillMirror).toHaveBeenCalledTimes(1)
    expect(fillMirror).toHaveBeenCalledWith([5])
    dispose()
  })

  it('пробел объявляется один раз ЗА ID, а не на каждое чтение/бамп версии зеркала', async () => {
    const { usePeer } = await import('./peers.solid')

    let dispose!: () => void
    const peer = createRoot((d) => {
      dispose = d
      return usePeer(() => 6) // accessor-форма: каждый бамп версии пересчитывает мемо и читает callback
    })
    peer()
    await Promise.resolve()
    expect(fillMirror).toHaveBeenCalledTimes(1)

    // Мирор бампается ЧУЖИМ пиром — id=6 остаётся пропущенным, версия зеркала
    // трогается, мемо (если в теле callback лежит вызов fillMirror) пересчитался бы снова.
    applyPeerOps([{ op: 'upsert', peers: [user(999)] }])
    peer()
    peer()
    await Promise.resolve()
    // МУТАЦИЯ: перенеси вызов `fillMirror` из `createEffect(on(idAccessor, …))`
    // в тело callback `createMemoOrReturn` (читается при каждом чтении/бампе
    // версии, пока пир не приехал) — здесь станет 3.
    expect(fillMirror).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('карточка уже есть — fillMirror не зовётся вовсе', async () => {
    const { usePeer } = await import('./peers.solid')
    applyPeerOps([{ op: 'upsert', peers: [user(9)] }])

    let dispose!: () => void
    createRoot((d) => {
      dispose = d
      usePeer(9)
    })
    await Promise.resolve()
    expect(fillMirror).not.toHaveBeenCalled()
    dispose()
  })

  it('accessor-вход: обновление зеркала перерисовывает потребителя', async () => {
    const { usePeer } = await import('./peers.solid')

    createRoot((dispose) => {
      const [id] = createSignal(3)
      const peer = usePeer(id) // T — Accessor, значит usePeer тоже отдаёт Accessor
      expect(peer()).toBeUndefined()

      applyPeerOps([{ op: 'upsert', peers: [user(3, { first_name: 'Настя' })] }])
      // МУТАЦИЯ: убери `version()` внутри callback createMemoOrReturn — эта
      // строка перестанет видеть новое значение (мемо не пересчитается).
      expect((peer() as UserReal | undefined)?.first_name).toBe('Настя')
      dispose()
    })
  })

  it('accessor-вход: смена peerId переобъявляет пробел для нового id', async () => {
    const { usePeer } = await import('./peers.solid')

    let dispose!: () => void
    let setId!: (id: number) => void
    createRoot((d) => {
      dispose = d
      const [idAcc, setIdAcc] = createSignal(10)
      setId = setIdAcc
      usePeer(idAcc)
    })
    await Promise.resolve()
    expect(fillMirror).toHaveBeenCalledTimes(1)
    expect(fillMirror).toHaveBeenLastCalledWith([10])

    setId(11)
    await Promise.resolve()
    expect(fillMirror).toHaveBeenCalledTimes(2)
    expect(fillMirror).toHaveBeenLastCalledWith([11])
    dispose()
  })
})

describe('useChat/useUser (Solid) — знаковый ключ из «голого» id', () => {
  it('useChat читает по -id', async () => {
    const { useChat } = await import('./peers.solid')
    applyPeerOps([
      { op: 'upsert', peers: [{ _: 'channel', id: 7, title: 'G', photo: { _: 'chatPhotoEmpty' }, date: 0 }] },
    ])
    createRoot((dispose) => {
      const chat = useChat(7)
      expect(chat && '_' in chat && chat._ === 'channel' ? chat.title : undefined).toBe('G')
      dispose()
    })
  })

  it('useUser читает по +id', async () => {
    const { useUser } = await import('./peers.solid')
    applyPeerOps([{ op: 'upsert', peers: [user(4, { first_name: 'Аня' })] }])
    createRoot((dispose) => {
      expect((useUser(4) as UserReal | undefined)?.first_name).toBe('Аня')
      dispose()
    })
  })
})
