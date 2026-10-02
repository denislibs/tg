/** @jsxImportSource solid-js */
/**
 * Вкладка «Динамики и камера» (`speakersAndCamera.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/speakersAndCamera.tsx` + `call/{callDeviceSettings,
 * microphoneLevelMeter,cameraSection}.tsx`, 812502980) — задача 26 плана 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppSpeakersAndCameraTab` из `solidJsTabs/tabs.ts`
 * через колоночный слайдер. Стабы — только границы: устройства браузера
 * (`navigator.mediaDevices`, `AudioContext` — у happy-dom их нет), попап выбора
 * (мост до 2C-12 — у него свой тест), живой звонок (`core/calls/callEngine`) и тост.
 *
 * Предмет — видимое в DOM и записанное в стор:
 *  • шапка `AccountSettings.SpeakersAndCamera` с `with-border`; три секции в
 *    порядке и с именами tweb; секции «Принимать звонки» нет (О-8);
 *  • строка устройства: `role=button`, подпись справа (`row-title-right-secondary`)
 *    — «По умолчанию» без выбора, метка устройства при выборе;
 *  • выбор → попап с видом устройства и текущим id; `onPick` пишет zustand и
 *    ведёт микрофон/камеру в живой звонок; отказ звонка откатывает выбор и
 *    показывает тост ошибки вида устройства;
 *  • уровень микрофона и превью камеры держат СВОИ потоки: перезахват по смене
 *    устройства, отпуск треков на закрытии вкладки (и остров снят — DoD 5);
 *  • ошибка захвата — подписи `CallSettings.MicrophoneUnavailable` /
 *    `CallSettings.CameraUnavailable`; фронтальная камера — `call-video-mirror`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { useSettingsStore } from '@/settings'
import { AppSpeakersAndCameraTab } from '@components/solidJsTabs/tabs'
import type { OutputDevicePopupOptions } from '@components/rtmp/outputDevicePopup'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'

const showOutputDevicePopup = vi.hoisted(() => vi.fn<(options: OutputDevicePopupOptions) => void>())
vi.mock('@components/rtmp/outputDevicePopup', () => ({ default: showOutputDevicePopup }))

const applyToCallEngine = vi.hoisted(() => vi.fn<(kind: 'mic' | 'camera', id: string) => Promise<void>>())
vi.mock('@core/calls/callEngine', () => ({ applyDeviceToActiveCall: applyToCallEngine }))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  toastNew,
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const flush = () => pause(0)

// ── устройства браузера ──────────────────────────────────────────────────────

type FakeTrack = MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }

function fakeTrack(kind: 'audio' | 'video', settings: MediaTrackSettings = {}): FakeTrack {
  const track = new EventTarget() as FakeTrack
  Object.assign(track, {
    kind,
    label: '',
    enabled: true,
    stop: vi.fn(),
    getSettings: () => settings,
  })
  return track
}

// Прототип — настоящий `MediaStream` happy-dom: сеттер `srcObject` проверяет `instanceof`.
function fakeStream(tracks: FakeTrack[]): MediaStream {
  return Object.assign(Object.create(MediaStream.prototype) as MediaStream, {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  })
}

const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
  ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo

let devices: MediaDeviceInfo[]
let issued: { constraints: MediaStreamConstraints, tracks: FakeTrack[], stream: MediaStream }[]
let failAudio: boolean
let failVideo: boolean
let videoSettings: MediaTrackSettings

async function defaultGetUserMedia(constraints: MediaStreamConstraints) {
  if(constraints.audio && failAudio) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
  if(constraints.video && failVideo) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
  const tracks = [
    ...(constraints.audio ? [fakeTrack('audio')] : []),
    ...(constraints.video ? [fakeTrack('video', videoSettings)] : []),
  ]
  const stream = fakeStream(tracks)
  issued.push({ constraints, tracks, stream })
  return stream
}
const getUserMedia = vi.fn(defaultGetUserMedia)

const deviceListeners = new Set<EventListener>()

class FakeAudioContext {
  createMediaStreamSource() { return { connect() {}, disconnect() {} } }
  createAnalyser() {
    return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 4, getByteFrequencyData() {}, disconnect() {} }
  }
  close() { return Promise.resolve() }
}

/** Поток, выданный последним под `kind` (audio — уровень, video — превью). */
const lastIssued = (kind: 'audio' | 'video') => [...issued].reverse().find((i) => i.constraints[kind])!

let host: TestColumnSlider

// Модуль вкладки грузится ленивым `import()` на первом открытии (3+ с на
// холодной трансформации под параллельным прогоном) — греем заранее, чтобы
// первый тест не упирался в таймаут в 5 с.
beforeAll(() => import('./speakersAndCamera.solid'), 30_000)

beforeEach(() => {
  devices = []
  issued = []
  failAudio = false
  failVideo = false
  videoSettings = { facingMode: 'user' }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve(devices),
      getUserMedia,
      getSupportedConstraints: () => ({}),
      addEventListener: (_: string, fn: EventListener) => deviceListeners.add(fn),
      removeEventListener: (_: string, fn: EventListener) => deviceListeners.delete(fn),
    },
  })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  applyToCallEngine.mockResolvedValue(undefined)
  useSettingsStore.getState().update({ speakerId: '', micId: '', cameraId: '' })

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = mountTestColumnSlider(columnEl, {} as Managers)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  getUserMedia.mockClear()
  getUserMedia.mockImplementation(defaultGetUserMedia)
  showOutputDevicePopup.mockReset()
  applyToCallEngine.mockReset()
  toastNew.mockClear()
  deviceListeners.clear()
  useSettingsStore.getState().update({ speakerId: '', micId: '', cameraId: '' })
})

const open = async() => {
  const tab = await host.openTab(AppSpeakersAndCameraTab)
  await flush()
  return tab
}

const sections = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]

function row(tab: SliderSuperTab, key: keyof typeof lang) {
  const el = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === lang[key])
  if(!el) throw new Error('no row ' + key)
  return el
}

const rightOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.row-title-right')!

describe('вкладка «Динамики и камера» — разметка', () => {
  it('шапка AccountSettings.SpeakersAndCamera, у шапки with-border', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang['AccountSettings.SpeakersAndCamera'])
    expect(tab.header.classList.contains('with-border')).toBe(true)
  })

  it('три секции tweb в порядке оригинала; «Принимать звонки» нет (О-8)', async() => {
    const tab = await open()
    const names = sections(tab).map((s) => s.querySelector('.sidebar-left-section-name')?.textContent)
    expect(names).toEqual([
      lang['CallSettings.OutputSection'],
      lang['CallSettings.InputSection'],
      lang['CallSettings.CameraSection'],
    ])
    expect(tab.scrollable.container.querySelector('.row-checkbox-field-toggle')).toBeNull()
    expect(tab.scrollable.container.querySelector('.sidebar-left-section-caption')).toBeNull()
  })

  it('строки устройств: role=button, подпись справа secondary — «По умолчанию» без выбора', async() => {
    const tab = await open()
    const titles = [...tab.scrollable.container.querySelectorAll('.row .row-title:not(.row-title-right)')]
      .map((t) => t.textContent)
    expect(titles).toEqual([lang['CallSettings.OutputDevice'], lang['CallSettings.InputDevice'], lang['CallSettings.Camera']])

    for(const key of ['CallSettings.OutputDevice', 'CallSettings.InputDevice', 'CallSettings.Camera'] as const) {
      const el = row(tab, key)
      expect(el.getAttribute('role')).toBe('button')
      expect(el.classList.contains('row-clickable')).toBe(true)
      expect(rightOf(el).classList.contains('row-title-right-secondary')).toBe(true)
      expect(rightOf(el).textContent).toBe(lang['CallSettings.DeviceDefault'])
    }
  })

  it('выбранное устройство подписано меткой из enumerateDevices; пропало — снова «По умолчанию»', async() => {
    devices = [device('audiooutput', 'spk-1', 'USB Speakers')]
    useSettingsStore.getState().update({ speakerId: 'spk-1' })
    const tab = await open()
    expect(rightOf(row(tab, 'CallSettings.OutputDevice')).textContent).toBe('USB Speakers')

    devices = []
    deviceListeners.forEach((fn) => fn(new Event('devicechange')))
    await flush()
    expect(rightOf(row(tab, 'CallSettings.OutputDevice')).textContent).toBe(lang['CallSettings.DeviceDefault'])
  })

  it('уровень микрофона — метр в обёртке секции «Микрофон»; превью камеры — video в секции «Камера»', async() => {
    const tab = await open()
    const [, input, camera] = sections(tab)
    const meter = input.querySelector<HTMLElement>('.speakers-and-camera-meter-wrap > .microphone-level-meter')!
    expect(meter.getAttribute('role')).toBe('meter')
    expect(meter.getAttribute('aria-label')).toBe(lang['AccDescr.MicrophoneLevel'])
    expect(meter.querySelector('.microphone-level-meter__fill')).not.toBeNull()

    const video = camera.querySelector<HTMLVideoElement>('.speakers-and-camera-preview > video.speakers-and-camera-preview-video')!
    expect(video).not.toBeNull()
    expect(video.classList.contains('call-video-mirror')).toBe(true)
    expect(video.srcObject).toBe(lastIssued('video').stream)
  })

  it('задняя камера не зеркалится', async() => {
    videoSettings = { facingMode: 'environment' }
    const tab = await open()
    const video = tab.scrollable.container.querySelector<HTMLVideoElement>('video')!
    expect(video.classList.contains('call-video-mirror')).toBe(false)
  })

  it('нет доступа — подписи MicrophoneUnavailable и CameraUnavailable вместо превью', async() => {
    failAudio = true
    failVideo = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tab = await open()
    const [, input, camera] = sections(tab)
    expect(input.querySelector('.microphone-level-meter__error')!.textContent).toBe(lang['CallSettings.MicrophoneUnavailable'])
    expect(input.querySelector('.microphone-level-meter')!.getAttribute('aria-hidden')).toBe('true')
    expect(camera.querySelector('.speakers-and-camera-preview')).toBeNull()
    expect(camera.querySelector('.speakers-and-camera-preview-error')!.textContent).toBe(lang['CallSettings.CameraUnavailable'])
  })
})

describe('вкладка «Динамики и камера» — выбор устройства', () => {
  it('строка «Динамики» открывает попап audiooutput с текущим id и заголовком CallSettings.Speakers', async() => {
    useSettingsStore.getState().update({ speakerId: 'spk-1' })
    const tab = await open()
    row(tab, 'CallSettings.OutputDevice').click()

    expect(showOutputDevicePopup).toHaveBeenCalledTimes(1)
    expect(showOutputDevicePopup.mock.calls[0][0]).toMatchObject({
      kind: 'audiooutput',
      currentId: 'spk-1',
      titleLangKey: 'CallSettings.Speakers',
    })
  })

  it('выбор микрофона пишет micId и ведёт его в живой звонок; уровень перезахватывает новое устройство', async() => {
    const tab = await open()
    const firstMeter = lastIssued('audio')
    row(tab, 'CallSettings.InputDevice').click()
    const options = showOutputDevicePopup.mock.calls[0][0]
    expect(options).toMatchObject({ kind: 'audioinput', currentId: '', titleLangKey: 'CallSettings.Microphone' })

    options.onPick('mic-2')
    await flush()

    expect(useSettingsStore.getState().micId).toBe('mic-2')
    expect(applyToCallEngine).toHaveBeenCalledWith('mic', 'mic-2')
    expect(firstMeter.tracks[0].stop).toHaveBeenCalled()
    expect(lastIssued('audio').constraints.audio).toMatchObject({ deviceId: { exact: 'mic-2' } })
  })

  it('выбор камеры пишет cameraId, ведёт в звонок и перезахватывает превью', async() => {
    const tab = await open()
    row(tab, 'CallSettings.Camera').click()
    const options = showOutputDevicePopup.mock.calls[0][0]
    expect(options).toMatchObject({ kind: 'videoinput', titleLangKey: 'CallSettings.Camera' })

    options.onPick('cam-2')
    await flush()

    expect(useSettingsStore.getState().cameraId).toBe('cam-2')
    expect(applyToCallEngine).toHaveBeenCalledWith('camera', 'cam-2')
    expect(lastIssued('video').constraints.video).toEqual({ deviceId: { exact: 'cam-2' } })
  })

  it('выбор динамика пишет speakerId; живой звонок подхватывает его сам (CallScreen), движок не зовётся', async() => {
    const tab = await open()
    row(tab, 'CallSettings.OutputDevice').click()
    showOutputDevicePopup.mock.calls[0][0].onPick('spk-9')
    await flush()
    expect(useSettingsStore.getState().speakerId).toBe('spk-9')
    expect(applyToCallEngine).not.toHaveBeenCalled()
  })

  it('отказ живого звонка откатывает выбор и показывает тост ошибки микрофона', async() => {
    useSettingsStore.getState().update({ micId: 'mic-1' })
    applyToCallEngine.mockRejectedValue(new Error('replaceTrack'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tab = await open()
    row(tab, 'CallSettings.InputDevice').click()
    showOutputDevicePopup.mock.calls[0][0].onPick('mic-2')
    await flush()

    expect(useSettingsStore.getState().micId).toBe('mic-1')
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'ConferenceCall.Media.MicrophoneError' })
  })

  it('onStaleCurrentId сбрасывает выбор на «По умолчанию»', async() => {
    useSettingsStore.getState().update({ cameraId: 'gone' })
    const tab = await open()
    row(tab, 'CallSettings.Camera').click()
    showOutputDevicePopup.mock.calls[0][0].onStaleCurrentId!()
    await flush()
    expect(useSettingsStore.getState().cameraId).toBe('')
  })
})

describe('вкладка «Динамики и камера» — жизненный цикл', () => {
  it('закрытие вкладки отпускает микрофон и камеру и снимает Solid-остров (DoD 5)', async() => {
    const tab = await open()
    const meter = lastIssued('audio')
    const preview = lastIssued('video')

    tab.close()
    await pause(400)

    expect(meter.tracks[0].stop).toHaveBeenCalled()
    expect(preview.tracks[0].stop).toHaveBeenCalled()
    expect(tab.container.querySelector('.sidebar-left-section-container')).toBeNull()
    expect(deviceListeners.size).toBe(0)
  })

  it('поток, пришедший после закрытия вкладки, тоже отпускается', async() => {
    let resolveLate!: (stream: MediaStream) => void
    const late = fakeTrack('video')
    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) => {
      if(constraints.video) return new Promise<MediaStream>((resolve) => { resolveLate = resolve })
      return Promise.resolve(fakeStream([fakeTrack('audio')]))
    })
    const tab = await open()
    tab.close()
    await pause(400)

    resolveLate(fakeStream([late]))
    await flush()
    expect(late.stop).toHaveBeenCalled()
  })
})
