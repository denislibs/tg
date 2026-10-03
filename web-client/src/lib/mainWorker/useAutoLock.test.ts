// Автоблокировка воркера (`useAutoLock.ts`, порт tweb `lib/mainWorker/useAutoLock.ts`):
// таймер заводится, только когда код включён, задан срок, ВСЕ вкладки простаивают, нет
// «непрерываемых» занятий и приложение не заперто; любое из условий снимает таймер.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoLock, type AutoLockSettings } from './useAutoLock'

const MIN = 60_000

let settings: AutoLockSettings | undefined
let locked: boolean
let onLock: ReturnType<typeof vi.fn<() => void>>
let controls: ReturnType<typeof useAutoLock<string>>

beforeEach(() => {
  vi.useFakeTimers()
  settings = { enabled: true, autoLockTimeoutMins: 1 }
  locked = false
  onLock = vi.fn<() => void>()
  controls = useAutoLock<string>({
    getSettings: async() => settings,
    getIsLocked: () => locked,
    onLock,
  })
})

afterEach(() => {
  controls.dispose()
  vi.useRealTimers()
})

describe('useAutoLock (tweb lib/mainWorker/useAutoLock.ts)', () => {
  it('все вкладки простаивают дольше срока — onLock; до срока — нет', async() => {
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN - 1)
    expect(onLock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('вкладка ожила до срока — таймер снят', async() => {
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN / 2)
    controls.setAreAllIdle(false)
    await vi.advanceTimersByTimeAsync(MIN * 2)
    expect(onLock).not.toHaveBeenCalled()
  })

  it('«непрерываемое» занятие держит; снятое занятие или ушедшая вкладка заводят таймер снова', async() => {
    controls.toggleUninteruptableActivity('tab-a', 'UsingVideoPlayer', true)
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN * 2)
    expect(onLock).not.toHaveBeenCalled()

    controls.toggleUninteruptableActivity('tab-a', 'UsingVideoPlayer', false)
    await vi.advanceTimersByTimeAsync(MIN)
    expect(onLock).toHaveBeenCalledTimes(1)

    onLock.mockClear()
    controls.setAreAllIdle(false)
    controls.toggleUninteruptableActivity('tab-b', 'PlayingMedia', true)
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN * 2)
    expect(onLock).not.toHaveBeenCalled()
    controls.removeTab('tab-b')
    await vi.advanceTimersByTimeAsync(MIN)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('код выключен, срок не задан или приложение заперто — таймера нет', async() => {
    settings = { enabled: false, autoLockTimeoutMins: 1 }
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN * 2)

    controls.setAreAllIdle(false)
    settings = { enabled: true, autoLockTimeoutMins: null }
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN * 2)

    controls.setAreAllIdle(false)
    settings = { enabled: true, autoLockTimeoutMins: 1 }
    locked = true
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN * 2)
    expect(onLock).not.toHaveBeenCalled()
  })

  it('заперли, пока шёл таймер, — onLock не зовётся (tweb :55)', async() => {
    controls.setAreAllIdle(true)
    await vi.advanceTimersByTimeAsync(MIN / 2)
    locked = true
    await vi.advanceTimersByTimeAsync(MIN)
    expect(onLock).not.toHaveBeenCalled()
  })
})
