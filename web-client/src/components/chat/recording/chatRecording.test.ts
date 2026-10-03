// Запись голосовых и кружков — `ChatRecording` (`chat/recording/chatRecording.ts`, порт tweb
// 812502980) внутри настоящего `ChatInput`. Рекордер голоса — подставной opus-recorder в
// `window.Recorder` (в happy-dom нет WebCodecs, поэтому контроллер берёт fallback — так же,
// как tweb на Safari < 26); рекордер кружка — подставной `NativeVideoRecorder`. Анализаторы
// волны подменены: их арифметику держит `core/audio/voiceWaveformAnalyser.test.ts`, здесь —
// что пики доезжают до отправки и до панели.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import appNavigationController from '@core/navigation/appNavigationController'
import type { MyMessage } from '@core/models'
import ChatInput from '../input'
import { ChatType } from '../chatType'
import { RECORD_MIN_TIME } from './chatRecording'

const WAVEFORM = vi.hoisted(() => new Uint8Array([1, 2, 3, 4]))
const analysers = vi.hoisted(() => ({ finished: 0, paused: [] as boolean[], live: [] as { onpeak: (peak: number) => void }[] }))
const keepAlive = vi.hoisted(() => vi.fn())

vi.mock('@core/audio/voiceWaveformAnalyser', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  default: class {
    public finish() {
      ++analysers.finished
      return WAVEFORM
    }
    public setPaused(paused: boolean) {
      analysers.paused.push(paused)
    }
    public getCurrentPeaks() {
      return [100, 200, 300]
    }
  },
}))

vi.mock('@helpers/voiceRecorder/liveWaveformAnalyser', () => ({
  default: class {
    public onpeak: (peak: number) => void = () => {}
    constructor() {
      analysers.live.push(this)
    }
    public setPaused() {}
    public destroy() {}
  },
}))

vi.mock('@core/audio/opusDecodeController', () => ({
  default: { setKeepAlive: keepAlive, decode: vi.fn(async() => ({ url: 'blob:preview' })) },
}))

const video = vi.hoisted(() => ({ supported: false, instances: [] as unknown[] }))
vi.mock('@helpers/videoRecorder/nativeVideoRecorder', () => ({
  isNativeVideoRecorderSupported: () => video.supported,
  default: class {
    public stream = new MediaStream()
    public onstop = () => {}
    public ondataavailable: (blob: Blob) => void = () => {}
    public start = vi.fn(async() => {})
    public pause = vi.fn(async() => {})
    public resume = vi.fn()
    public releaseStream = vi.fn()
    public setDeviceIds = vi.fn()
    public getSnapshot = vi.fn()
    public stop = vi.fn(() => {
      this.ondataavailable(new Blob([new Uint8Array([0, 0, 0, 1])], { type: 'video/mp4' }))
      this.onstop()
    })
    constructor() {
      video.instances.push(this)
    }
  },
}))

/** opus-recorder: та же поверхность, что зовёт контроллер (tweb держит его в `any`). */
class FakeOpusRecorder {
  static last: FakeOpusRecorder
  public sourceNode = {}
  public config: { mediaTrackConstraints?: unknown }
  public onstop = () => {}
  public ondataavailable: (data: Uint8Array) => void = () => {}
  public start = vi.fn(async() => {})
  public pause = vi.fn(async() => {})
  public resume = vi.fn()
  public getSnapshot = vi.fn(() => new Uint8Array(0))
  public stop = vi.fn(async() => {
    this.ondataavailable(new Uint8Array([0x4F, 0x67, 0x67, 0x53]))
    this.onstop()
  })
  constructor(config: { mediaTrackConstraints?: unknown }) {
    this.config = config
    FakeOpusRecorder.last = this
  }
}

const PEER = 2
const ME = 1
const STATES = ['send', 'schedule', 'edit', 'record', 'record-video', 'forward', 'stop']

async function mountInput(type = ChatType.Chat) {
  useChatsStore.setState({ dialogs: [makeDialog({ peerId: PEER })], loaded: true })
  const messages = new Map<number, MyMessage>()
  const managers = {
    messages: {
      sendText: vi.fn(async() => ({ ok: true })),
      sendFile: vi.fn(async() => ({ mediaId: 1 })),
      editMessage: vi.fn(async() => ({})),
      getMessageByPeer: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
      reloadMessage: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
    },
    chats: { createPrivate: vi.fn(async(peerId: number) => peerId) },
    dialogs: { refresh: vi.fn(async() => {}) },
    drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    groups: { setMute: vi.fn(async() => {}) },
    peers: { fillMirror: vi.fn(async() => {}) },
  }
  const container = document.createElement('div')
  const chat = {
    peerId: PEER,
    threadId: undefined as number | undefined,
    type,
    container,
    messagesStorageKey: winKey(PEER),
    isBroadcast: false,
    isBot: false,
    isForum: false,
    canSend: vi.fn(async() => true),
    updateChatInputHeight: vi.fn(),
    getMessage: (mid: number) => messages.get(mid),
    setMessageId: vi.fn(),
    bubbles: { onGoDownClick: vi.fn() },
    selection: { isSelecting: false },
    managers,
  }

  const appImManager = new EventListenerBase<{ peer_changing: (chat: unknown) => void }>()
  const input = new ChatInput(chat as never, appImManager as never, managers as never, 'chat-input-main')
  input.construct()
  input.constructPeerHelpers()
  container.append(input.chatInput)
  document.body.append(container)
  ;(await input.finishPeerChange({ peerId: PEER, middleware: () => true }))()

  return { input, chat, managers, messages }
}

const activeStates = (input: ChatInput) => STATES.filter((state) => input.btnSend.classList.contains(state))
const panel = (input: ChatInput) => input.newMessageWrapper.querySelector('.voice-recording-panel') as HTMLElement

let now = 1_000_000
let mounted: Awaited<ReturnType<typeof mountInput>> | undefined

/** Клик по кнопке отправки на пустом поле — старт записи; ждём, пока `start()` отработает. */
async function startRecording(input: ChatInput) {
  input.btnSend.click()
  await vi.waitFor(() => expect(input.recording).toBe(true))
}

beforeEach(async() => {
  const { default: rootScope } = await import('@lib/rootScope')
  rootScope.myId = ME
  ;(window as unknown as { Recorder?: unknown }).Recorder = FakeOpusRecorder
  video.supported = false
  video.instances.length = 0
  analysers.finished = 0
  analysers.paused.length = 0
  analysers.live.length = 0
  keepAlive.mockClear()
  // без анимаций `SetTransition` ставит и снимает классы синхронно
  useSettingsStore.setState({
    liteMode: { ...useSettingsStore.getState().liteMode, all: true },
    recordingMediaType: 'voice',
  })
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  // happy-dom: `play()` возвращает не промис
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
})

afterEach(() => {
  mounted?.input.destroy()
  mounted?.chat.container.remove()
  mounted = undefined
  document.querySelectorAll('.popup').forEach((popup) => popup.remove())
  useChatsStore.setState({ dialogs: [] })
  delete (window as unknown as { Recorder?: unknown }).Recorder
  vi.restoreAllMocks()
})

describe('ChatRecording: монтаж', () => {
  it('панель записи — в строке ввода перед `.btn-send-container` (tweb :112), кнопка на пустом поле — «записать»', async() => {
    mounted = await mountInput()
    const { input } = mounted

    expect(panel(input).nextElementSibling).toBe(input.btnSendContainer)
    expect(panel(input).classList.contains('voice-recording-panel--recording')).toBe(true)
    expect(activeStates(input)).toEqual(['record'])
  })

  it('нет ни одного рекордера — пустое поле «отправить» (tweb `updateSendBtn` :4400)', async() => {
    delete (window as unknown as { Recorder?: unknown }).Recorder
    mounted = await mountInput()
    expect(activeStates(mounted.input)).toEqual(['send'])
  })

  it('сохранённый тип «кружок» при рекордере кружка — «записать кружок»; без него — голос', async() => {
    useSettingsStore.setState({ recordingMediaType: 'round' })
    mounted = await mountInput()
    expect(activeStates(mounted.input)).toEqual(['record'])
    mounted.input.destroy()
    mounted.chat.container.remove()

    video.supported = true
    mounted = await mountInput()
    expect(activeStates(mounted.input)).toEqual(['record-video'])
  })
})

describe('ChatRecording: голосовое', () => {
  it('старт по клику: `is-recording` + `is-locked`, кнопка — «отправить», запись навигации `voice`, декодер держится', async() => {
    mounted = await mountInput()
    const { input } = mounted

    await startRecording(input)

    expect(FakeOpusRecorder.last.start).toHaveBeenCalledTimes(1)
    expect(input.chatInput.classList.contains('is-recording')).toBe(true)
    expect(input.chatInput.classList.contains('is-locked')).toBe(true)
    expect(activeStates(input)).toEqual(['send'])
    expect(appNavigationController.findItemByType('voice')).toBeTruthy()
    expect(keepAlive).toHaveBeenLastCalledWith(true)
  })

  it('стоп и отправка: ОДИН `sendFile` с типом voice, ogg, длительностью и пиками; строка возвращается в покой', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted

    await startRecording(input)
    now += 3_700
    input.btnSend.click()

    await vi.waitFor(() => expect(managers.messages.sendFile).toHaveBeenCalledTimes(1))
    const args = (managers.messages.sendFile.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(args).toMatchObject({
      peerId: PEER,
      senderId: ME,
      type: 'voice',
      mime: 'audio/ogg',
      fileName: 'audio.ogg',
      duration: 3,
      waveform: WAVEFORM,
      isMedia: true,
      uploadAction: { _: 'sendMessageUploadAudioAction' },
      replyToMsgId: null,
      threadId: null,
    })
    expect((args.file as Blob).type).toBe('audio/ogg')
    expect(typeof args.clientMsgId).toBe('string')

    expect(input.recording).toBe(false)
    expect(input.chatInput.classList.contains('is-recording')).toBe(false)
    expect(input.chatInput.classList.contains('is-locked')).toBe(false)
    expect(activeStates(input)).toEqual(['record'])
    expect(appNavigationController.findItemByType('voice')).toBeFalsy()
    expect(keepAlive).toHaveBeenLastCalledWith(false)
  })

  it('короче RECORD_MIN_TIME — отмена вместо отправки (tweb `handleSendButtonClick`)', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted

    await startRecording(input)
    now += RECORD_MIN_TIME - 1
    input.btnSend.click()

    await vi.waitFor(() => expect(input.recording).toBe(false))
    expect(FakeOpusRecorder.last.stop).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendFile).not.toHaveBeenCalled()
  })

  it('корзина панели отменяет запись: рекордер остановлен, ничего не отправлено, строка разблокирована', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted

    await startRecording(input)
    now += 5_000
    ;(panel(input).querySelector('.voice-recording-cancel') as HTMLElement).click()

    await vi.waitFor(() => expect(input.recording).toBe(false))
    expect(managers.messages.sendFile).not.toHaveBeenCalled()
    expect(input.chatInput.classList.contains('is-locked')).toBe(false)
    expect(keepAlive).toHaveBeenLastCalledWith(false)
  })

  it('пауза: рекордер на паузе, панель `--paused` с полными пиками, время не идёт; продолжение — снова `--recording`', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted

    await startRecording(input)
    now += 2_000
    const toggle = panel(input).querySelector('.voice-recording-pause-toggle') as HTMLElement
    toggle.click()

    expect(FakeOpusRecorder.last.pause).toHaveBeenCalledTimes(1)
    expect(panel(input).classList.contains('voice-recording-panel--paused')).toBe(true)
    expect(analysers.paused).toEqual([true])

    now += 10_000 // на паузе время записи стоит
    toggle.click()
    expect(FakeOpusRecorder.last.resume).toHaveBeenCalledTimes(1)
    expect(panel(input).classList.contains('voice-recording-panel--recording')).toBe(true)

    now += 1_500
    input.btnSend.click()
    await vi.waitFor(() => expect(managers.messages.sendFile).toHaveBeenCalledTimes(1))
    expect((managers.messages.sendFile.mock.calls[0] as unknown[])[0]).toMatchObject({ duration: 3 })
  })

  it('живые пики доезжают до волны панели (`LiveWaveformAnalyser.onpeak` → `pushPeak`)', async() => {
    mounted = await mountInput()
    const { input } = mounted

    await startRecording(input)
    const voicePanelWaveform = panel(input).querySelector('canvas.voice-recording-waveform')
    expect(voicePanelWaveform).toBeTruthy()
    expect(analysers.live).toHaveLength(1)
    const push = vi.spyOn(
      (await import('@components/chat/voiceRecording/liveWaveform')).default.prototype,
      'pushPeak',
    )
    analysers.live[0].onpeak(0.5)
    expect(push).toHaveBeenCalledWith(0.5)
  })

  it('блокировка: клик мимо строки ввода во время записи — попап «выбросить», запись не трогается', async() => {
    mounted = await mountInput()
    const { input } = mounted

    await startRecording(input)
    const outside = document.createElement('div')
    document.body.append(outside)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(document.querySelector('.popup-cancel-record')).toBeTruthy())
    expect(input.recording).toBe(true)
    outside.remove()
  })

  it('ответ: пакет параметров строки уезжает в ту же отправку, плашка ответа снимается', async() => {
    mounted = await mountInput()
    const { input, managers, messages } = mounted
    messages.set(9, { _: 'message', id: 9, peerId: PEER, fromId: PEER, date: 1, message: 'вопрос', pFlags: {} } as MyMessage)
    await input.initMessageReply({ replyToMsgId: 9 })
    await vi.waitFor(() => expect(input.replyToMsgId).toBe(9))

    await startRecording(input)
    now += 1_000
    input.btnSend.click()

    await vi.waitFor(() => expect(managers.messages.sendFile).toHaveBeenCalledTimes(1))
    expect((managers.messages.sendFile.mock.calls[0] as unknown[])[0]).toMatchObject({ replyToMsgId: 9 })
    expect(input.replyToMsgId).toBeUndefined()
  })
})

describe('ChatRecording: кружок', () => {
  it('стоп кружка — ОДИН `sendFile` с типом roundVideo, 400×400, mime рекордера', async() => {
    video.supported = true
    useSettingsStore.setState({ recordingMediaType: 'round' })
    mounted = await mountInput()
    const { input, managers } = mounted
    expect(document.body.querySelector('.video-recording-stage')).toBeTruthy()

    await startRecording(input)
    now += 2_400
    input.btnSend.click()

    await vi.waitFor(() => expect(managers.messages.sendFile).toHaveBeenCalledTimes(1))
    expect((managers.messages.sendFile.mock.calls[0] as unknown[])[0]).toMatchObject({
      peerId: PEER,
      type: 'roundVideo',
      mime: 'video/mp4',
      fileName: 'video.mp4',
      duration: 2,
      width: 400,
      height: 400,
      uploadAction: { _: 'sendMessageUploadVideoAction' },
    })
    expect(input.recording).toBe(false)
  })

  it('destroy строки снимает оверлей кружка с <body> (tweb :1294-1311)', async() => {
    video.supported = true
    mounted = await mountInput()
    expect(document.body.querySelector('.video-recording-stage')).toBeTruthy()
    mounted.input.destroy()
    expect(document.body.querySelector('.video-recording-stage')).toBeFalsy()
  })
})
