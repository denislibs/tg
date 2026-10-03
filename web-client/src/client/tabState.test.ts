// Вкладочная половина реестра вкладок (`tabState.ts`, порт tweb `apiManagerProxy`
// `updateTabStateIdle` `:1405-1407` и подписки `:645-648`): простой окна уходит
// воркеру сразу и на каждой смене, «непрерываемые» занятия — своим каналом.
import { describe, expect, it, vi } from 'vitest'
import idleController from '@helpers/idleController'
import { installTabState, toggleUninteruptableActivity } from './tabState'

describe('installTabState', () => {
  it('простой окна — воркеру: сразу, затем на каждой смене; занятие — каналом toggleUninteruptableActivity', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const invoke = vi.fn(async() => undefined)
    toggleUninteruptableActivity('UsingVideoPlayer', true) // порта ещё нет — молча
    idleController.isIdle = true
    installTabState({ invoke } as never)
    expect(invoke).toHaveBeenLastCalledWith('tabState', { idleStartTime: 1000 })

    idleController.isIdle = false
    expect(invoke).toHaveBeenLastCalledWith('tabState', { idleStartTime: 0 })

    toggleUninteruptableActivity('UsingVideoPlayer', true)
    expect(invoke).toHaveBeenLastCalledWith('toggleUninteruptableActivity', { activity: 'UsingVideoPlayer', active: true })
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
