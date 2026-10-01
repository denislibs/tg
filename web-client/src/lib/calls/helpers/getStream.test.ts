/**
 * `getStream` / `acquireStream` / `shouldMirrorVideoTrack` — порты tweb
 * `lib/calls/helpers/*` (812502980), задача 26 плана 2D. Предмет — то, что видно
 * снаружи: какие ограничения ушли в `getUserMedia`, какой id выбора остался в
 * zustand после протухшего устройства, какие треки остановлены.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/settings'
import getStream from './getStream'
import acquireStream from './acquireStream'
import shouldMirrorVideoTrack from './shouldMirrorVideoTrack'

const missing = () => Object.assign(new Error('gone'), { name: 'OverconstrainedError' })

const track = (kind: string, extra: Partial<MediaStreamTrack> = {}) => Object.assign(new EventTarget(), {
  kind,
  label: '',
  stop: vi.fn(),
  getSettings: () => ({}),
  ...extra,
}) as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }

const stream = (tracks: MediaStreamTrack[]) => ({
  getTracks: () => tracks,
  getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
}) as unknown as MediaStream

const exactOf = (c: boolean | MediaTrackConstraints | undefined) =>
  typeof c === 'object' ? (c.deviceId as ConstrainDOMStringParameters | undefined)?.exact : undefined

let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  getUserMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  useSettingsStore.getState().update({ micId: 'mic-old', cameraId: 'cam-ok' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  useSettingsStore.getState().update({ micId: '', cameraId: '' })
})

describe('getStream — протухший id устройства', () => {
  it('один протухший микрофон: повтор без id, micId сброшен', async() => {
    const ok = stream([track('audio')])
    getUserMedia.mockRejectedValueOnce(missing()).mockResolvedValueOnce(ok)

    expect(await getStream({ audio: { deviceId: { exact: 'mic-old' } } })).toBe(ok)
    expect(exactOf(getUserMedia.mock.calls[1][0].audio)).toBeUndefined()
    expect(useSettingsStore.getState().micId).toBe('')
    expect(useSettingsStore.getState().cameraId).toBe('cam-ok')
  })

  it('оба id, живая камера: вторая проба держит камеру, сбрасывается только микрофон', async() => {
    const ok = stream([track('audio'), track('video')])
    getUserMedia
      .mockRejectedValueOnce(missing())
      .mockRejectedValueOnce(missing())
      .mockResolvedValueOnce(ok)

    await getStream({ audio: { deviceId: { exact: 'mic-old' } }, video: { deviceId: { exact: 'cam-ok' } } })
    expect(exactOf(getUserMedia.mock.calls[2][0].video)).toBe('cam-ok')
    expect(useSettingsStore.getState().micId).toBe('')
    expect(useSettingsStore.getState().cameraId).toBe('cam-ok')
  })

  it('отказ не про устройство (нет разрешения) — бросается как есть, выбор не трогается', async() => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    await expect(getStream({ audio: { deviceId: { exact: 'mic-old' } } })).rejects.toThrow('no')
    expect(useSettingsStore.getState().micId).toBe('mic-old')
  })
})

describe('acquireStream', () => {
  it('dispose до ответа getUserMedia — пришедший поток останавливается, промис отдаёт undefined', async() => {
    const t = track('video')
    let resolve!: (s: MediaStream) => void
    getUserMedia.mockReturnValueOnce(new Promise((r) => { resolve = r }))

    const acquisition = acquireStream({ video: true })
    acquisition.dispose()
    resolve(stream([t]))

    expect(await acquisition.promise).toBeUndefined()
    expect(t.stop).toHaveBeenCalled()
  })

  it('dispose после ответа — треки остановлены, у трека родилось ended', async() => {
    const t = track('audio')
    const ended = vi.fn()
    t.addEventListener('ended', ended)
    getUserMedia.mockResolvedValueOnce(stream([t]))

    const acquisition = acquireStream({ audio: true })
    await acquisition.promise
    acquisition.dispose()
    expect(t.stop).toHaveBeenCalled()
    expect(ended).toHaveBeenCalled()
  })
})

describe('shouldMirrorVideoTrack', () => {
  it('фронтальная и без направления — зеркалятся; задняя, экран и аудио — нет', () => {
    expect(shouldMirrorVideoTrack(track('video', { getSettings: () => ({ facingMode: 'user' }) }))).toBe(true)
    expect(shouldMirrorVideoTrack(track('video'))).toBe(true)
    expect(shouldMirrorVideoTrack(track('video', { getSettings: () => ({ facingMode: 'environment' }) }))).toBe(false)
    expect(shouldMirrorVideoTrack(track('video', { label: 'Back Camera' }))).toBe(false)
    expect(shouldMirrorVideoTrack(track('video', { getSettings: () => ({ displaySurface: 'monitor' }) as MediaTrackSettings }))).toBe(false)
    expect(shouldMirrorVideoTrack(track('audio'))).toBe(false)
    expect(shouldMirrorVideoTrack(undefined)).toBe(false)
  })
})
