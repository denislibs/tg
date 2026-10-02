/**
 * `changeCallDevice` — порт tweb `lib/calls/applyDeviceToActiveCall.ts:59-77`
 * (812502980), задача 26 плана 2D: выбор пишется сразу, отказ живого звонка
 * откатывает его к подтверждённому, а поздний отказ старого выбора не
 * откатывает более новый.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/settings'

const applyToCallEngine = vi.hoisted(() => vi.fn<(kind: 'mic' | 'camera', id: string) => Promise<void>>())
vi.mock('@core/calls/callEngine', () => ({ applyDeviceToActiveCall: applyToCallEngine }))

const { changeCallDevice } = await import('./applyDeviceToActiveCall')

afterEach(() => {
  applyToCallEngine.mockReset()
  useSettingsStore.getState().update({ micId: '', cameraId: '', speakerId: '' })
})

describe('changeCallDevice', () => {
  it('микрофон: пишет micId и ведёт в движок звонка', async() => {
    applyToCallEngine.mockResolvedValue(undefined)
    await expect(changeCallDevice('microphone', 'mic-1')).resolves.toBe(true)
    expect(useSettingsStore.getState().micId).toBe('mic-1')
    expect(applyToCallEngine).toHaveBeenCalledWith('mic', 'mic-1')
  })

  it('отказ звонка — откат к прежнему выбору и ошибка наружу', async() => {
    useSettingsStore.getState().update({ cameraId: 'cam-1' })
    applyToCallEngine.mockRejectedValue(new Error('replaceTrack'))
    await expect(changeCallDevice('camera', 'cam-2')).rejects.toThrow('replaceTrack')
    expect(useSettingsStore.getState().cameraId).toBe('cam-1')
  })

  it('поздний отказ старого выбора не откатывает новый', async() => {
    let rejectFirst!: (err: Error) => void
    applyToCallEngine
      .mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce(undefined)

    const first = changeCallDevice('microphone', 'mic-a')
    await expect(changeCallDevice('microphone', 'mic-b')).resolves.toBe(true)
    rejectFirst(new Error('late'))
    await expect(first).resolves.toBe(false)
    expect(useSettingsStore.getState().micId).toBe('mic-b')
  })

  it('динамик: только запись speakerId, движок не зовётся', async() => {
    await expect(changeCallDevice('speaker', 'spk-1')).resolves.toBe(true)
    expect(useSettingsStore.getState().speakerId).toBe('spk-1')
    expect(applyToCallEngine).not.toHaveBeenCalled()
  })
})
