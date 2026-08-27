// Запись голосового: КОНТЕЙНЕР записи и то, что из него выводится на ОБОИХ
// концах — у оптимистичного бабла своей записи и у эха с сервера.
//
// ЧТО ЛОМАЛОСЬ БЕЗ ЭТОГО. Тип документа выводится из атрибута + mime, и ветку
// `voice` открывает ровно `audio/ogg` (`core/media/messageMedia.ts::saveDocument`,
// порт `appDocsManager.saveDoc:157`). Пока запись шла в `audio/webm`
// (MediaRecorder), голосовым не становилось НИ ОДНО своё голосовое: ни бабл
// «отправляется…», ни эхо — сервер отдаёт тот же mime, с которым файл залили
// (`domain/mtmedia.go::BuildDocument` берёт mime строки media). Оба конца
// описывались как МУЗЫКА: класс бабла `audio-message` вместо `voice-message`
// (`components/messages/bubbleClasses.ts::documentClasses`), плеер без волны и
// без точки «не прослушано» (`components/audio.ts:459`), в списке чатов и в
// ответах — «Аудио» вместо «Голосовое сообщение».
//
// Поэтому здесь пинится ЦЕПОЧКА: рекордер → mime блоба → аплоад → документ
// бабла и документ эха. Сам контейнер (страницы ogg) пинит
// `core/audio/oggOpusWriter.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVoiceRecorder, VOICE_MIME, type VoiceResult } from './useVoiceRecorder'
import { saveDocument, getDocumentFromMessage, type MyDocument } from '../media/messageMedia'
import { newPendingMethods } from '../managers/messages/pending'
import SlicedArray, { SliceEnd } from '../history/slicedArray'
import { generateMessageId } from '../history/messageId'
import type { MessageOp } from '../realtime/messageOps'
import type { MessageReal, MyMessage } from '../models'
import type { UploadArgs } from '../managers/mediaManager'

// ── стенд платформы ─────────────────────────────────────────────────────────
// Ни WebCodecs, ни Web Audio, ни MediaRecorder в тестовой среде нет — ставим
// ровно те куски, которых касается рекордер.

const OPUS_PACKET = new Uint8Array([0xfc, 0x01, 0x02, 0x03])

/** Порядок разборки графа: пики обязаны сниматься ДО закрытия AudioContext —
 *  у закрытого контекста узлы мертвы, снимать уже нечего. */
let teardown: string[] = []

class FakeNode {
  constructor(public context: FakeAudioContext) {}
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  public state = 'running'
  public destination = {}
  public audioWorklet = { addModule: () => Promise.resolve() }
  public closed = false
  constructor(_opts?: AudioContextOptions) {}
  createMediaStreamSource(): FakeNode { return new FakeNode(this) }
  createAnalyser() { return { fftSize: 0, connect: () => {}, getByteTimeDomainData: () => {} } }
  createScriptProcessor() {
    return { connect: () => {}, disconnect: () => { teardown.push('waveform-finish') }, onaudioprocess: null }
  }
  close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
    teardown.push('ctx-close')
    return Promise.resolve()
  }
}

/** Живой энкодер: `encode()` сразу отдаёт наружу готовый opus-пакет. */
class FakeAudioEncoder {
  public state = 'unconfigured'
  private output: (chunk: unknown, meta?: unknown) => void
  constructor(init: { output: (chunk: unknown, meta?: unknown) => void }) { this.output = init.output }
  configure(): void { this.state = 'configured' }
  encode(): void {
    this.output(
      { byteLength: OPUS_PACKET.length, duration: 20000, copyTo: (dst: Uint8Array) => dst.set(OPUS_PACKET) },
      { decoderConfig: {} },
    )
  }
  flush(): Promise<void> { return Promise.resolve() }
  close(): void { this.state = 'closed' }
}

let workletNodes: FakeWorkletNode[] = []
class FakeWorkletNode {
  public port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null }
  constructor() { workletNodes.push(this) }
  connect(): void {}
  disconnect(): void {}
}

const g = globalThis as Record<string, unknown>
const saved = new Map<string, unknown>()
const setGlobal = (name: string, value: unknown) => {
  if (!saved.has(name)) saved.set(name, g[name])
  if (value === undefined) delete g[name]
  else g[name] = value
}

function fakeStream() {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track] } as unknown as MediaStream
}

/** WebCodecs есть — рабочий путь оригинала (`chatRecording.ts:141`). */
function installWebCodecs() {
  setGlobal('AudioContext', FakeAudioContext)
  setGlobal('AudioWorkletNode', FakeWorkletNode)
  setGlobal('AudioEncoder', FakeAudioEncoder)
  setGlobal('AudioData', class { close(): void {} })
}

/** WebCodecs нет (сам AudioWorklet при этом есть — он старше) — на такой
 *  платформе остаётся только MediaRecorder. */
function noWebCodecs() {
  setGlobal('AudioEncoder', undefined)
  setGlobal('AudioData', undefined)
}

/** MediaRecorder с заданным набором поддерживаемых mime. */
function installMediaRecorder(supported: string[]) {
  setGlobal('AudioContext', FakeAudioContext)
  class FakeMediaRecorder {
    static isTypeSupported = (m: string) => supported.includes(m)
    public state = 'recording'
    public mimeType: string
    public ondataavailable: ((e: { data: Blob }) => void) | null = null
    public onstop: (() => void) | null = null
    constructor(_s: MediaStream, opts: MediaRecorderOptions) { this.mimeType = opts.mimeType ?? '' }
    start(): void {}
    stop(): void {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob([OPUS_PACKET]) })
      this.onstop?.()
    }
  }
  setGlobal('MediaRecorder', FakeMediaRecorder)
}

beforeEach(() => {
  vi.useFakeTimers()
  workletNodes = []
  teardown = []
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream()) },
  })
})

afterEach(() => {
  vi.useRealTimers()
  for (const [name, value] of saved) {
    if (value === undefined) delete g[name]
    else g[name] = value
  }
  saved.clear()
})

/** Запись длиной >1с и её результат (рекордер отбрасывает всё, что короче). */
async function record(mode: 'voice' | 'round' = 'voice'): Promise<VoiceResult | null> {
  let done: (r: VoiceResult | null) => void = () => {}
  const completed = new Promise<VoiceResult | null>((res) => { done = res })
  const { result } = renderHook(() => useVoiceRecorder({ onComplete: (r) => { done(r) } }))

  await act(async () => { await result.current.start(mode) })
  act(() => { vi.advanceTimersByTime(1100) })
  // Кадр PCM из worklet: он и доезжает до энкодера, а от него — в контейнер.
  act(() => { workletNodes[0]?.port.onmessage?.({ data: new Float32Array(2048) }) })
  await act(async () => {
    result.current.stop(true)
    await vi.advanceTimersByTimeAsync(0)
  })
  return completed
}

// ── оба конца ───────────────────────────────────────────────────────────────

/** Оптимистичный бабл — НАСТОЯЩИЙ путь `messages.sendFile` (pending.ts). */
async function optimisticDocument(blob: Blob, mime: string): Promise<{ doc: MyDocument; uploadMime: string }> {
  const slices = new Map<string, SlicedArray<number>>()
  const sa = new SlicedArray<number>()
  sa.unshift(generateMessageId(10))
  sa.first.setEnd(SliceEnd.Bottom)
  slices.set('1', sa)
  const msgsByChat = new Map<number, Map<number, MyMessage>>()
  const emitted: MessageOp[][] = []
  const uploads: UploadArgs[] = []

  const p = newPendingMethods({
    hkey: (peerId: number, threadRoot?: number | null) => (threadRoot ? `${peerId}:${threadRoot}` : String(peerId)),
    slices,
    msgsFor: (peerId: number) => {
      let c = msgsByChat.get(peerId)
      if (!c) { c = new Map(); msgsByChat.set(peerId, c) }
      return c
    },
    getMeId: () => 42,
    isBroadcastChat: () => false,
    emit: (ops: MessageOp[]) => { if (ops.length) emitted.push(ops) },
    send: () => {},
    upload: async (a: UploadArgs) => { uploads.push(a); return 909 },
    cancelUpload: () => {},
    sendTyping: () => {},
    uploadProgress: () => {},
  })

  await p.sendFile({
    peerId: 1, clientMsgId: 'c1', senderId: 42, file: blob, type: 'voice', mime,
    duration: 7, waveform: new Uint8Array([0x1f, 0x00, 0x2a]),
  })

  const bubble = (emitted[0][0] as { msg: MessageReal }).msg
  return { doc: getDocumentFromMessage(bubble)!, uploadMime: uploads[0].mime }
}

/** Эхо сервера — документ, каким его собирает бэкенд:
 *  `domain/mtmedia.go::attributes()` (documentAttributeAudio с битом voice +
 *  имя файла) и `BuildDocument`, где mime_type — mime СТРОКИ MEDIA, то есть
 *  ровно тот, с которым файл был залит. */
function echoDocument(uploadMime: string): MyDocument {
  return saveDocument({
    _: 'document',
    id: 909,
    mime_type: uploadMime,
    size: 4,
    thumbs: [],
    attributes: [
      { _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 7, waveform: 'HwAq' },
      { _: 'documentAttributeFilename', file_name: 'voice.ogg' },
    ],
  })
}

describe('useVoiceRecorder: контейнер записи', () => {
  it('WebCodecs есть → своя запись едет в audio/ogg (порт chatRecording.ts:223)', async () => {
    installWebCodecs()
    const r = await record()

    expect(r?.mime).toBe(VOICE_MIME)
    expect(r?.blob?.type).toBe('audio/ogg')
    // в блобе действительно контейнер ogg, а не сырые пакеты
    const bytes = new Uint8Array(await r!.blob!.arrayBuffer())
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('OggS')
    // и в нём лежит сам звук: пакет энкодера доехал до контейнера, а не потерялся
    // между worklet и мультиплексором (заголовочные страницы есть и без него)
    expect([...bytes].join(',')).toContain([...OPUS_PACKET].join(','))
  })

  it('пики снимаются ДО закрытия AudioContext рекордера', async () => {
    installWebCodecs()
    const r = await record()

    // 63 байта = 100 пятибитных значений (WAVEFORM_BYTES_LENGTH)
    expect(r?.waveform?.length).toBe(63)
    expect(teardown.indexOf('waveform-finish')).toBeGreaterThanOrEqual(0)
    expect(teardown.indexOf('waveform-finish')).toBeLessThan(teardown.indexOf('ctx-close'))
  })

  it('WebCodecs нет, но платформа умеет ogg (Firefox) → тоже audio/ogg, без ;codecs', async () => {
    noWebCodecs()
    installMediaRecorder(['audio/ogg;codecs=opus', 'audio/webm;codecs=opus'])
    const r = await record()

    expect(r?.mime).toBe('audio/ogg')
    expect(r?.blob?.type).toBe('audio/ogg')
  })

  it('кружок пишет MediaRecorder, и в mime едет контейнер без ;codecs', async () => {
    // Порт tweb `nativeVideoRecorder.ts:258-261` — кружок остаётся на
    // MediaRecorder, свой энкодер только у голоса.
    installWebCodecs()
    installMediaRecorder(['video/webm;codecs=vp9,opus'])
    const r = await record('round')

    expect(r?.mode).toBe('round')
    expect(r?.mime).toBe('video/webm')
    expect(r?.waveform).toBeNull() // пики считаются только для голосового
  })

  it('нет AudioWorklet — свой энкодер не собрать, идём тем же запасным путём', async () => {
    // Гейт (порт `isNativeSupported.ts`) требует ВСЕХ кусков: PCM отводит
    // worklet, без него энкодеру нечего кодировать.
    installWebCodecs()
    setGlobal('AudioWorkletNode', undefined)
    installMediaRecorder(['audio/webm;codecs=opus'])
    const r = await record()

    expect(r?.mime).toBe('audio/webm')
  })

  it('ОСТАТОК: без WebCodecs и без ogg остаётся webm — и это уже не голосовое', async () => {
    noWebCodecs()
    installMediaRecorder(['audio/webm;codecs=opus'])
    const r = await record()

    expect(r?.mime).toBe('audio/webm')
    expect(saveDocument({
      _: 'document', id: 1, mime_type: r!.mime, size: 4, thumbs: [],
      attributes: [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 7 }],
    }).type).toBe('audio')
  })
})

describe('useVoiceRecorder: своя запись описывается одинаково на обоих концах', () => {
  it('бабл «отправляется…» и эхо сервера — оба voice', async () => {
    installWebCodecs()
    const r = await record()
    const { doc: optimistic, uploadMime } = await optimisticDocument(r!.blob!, r!.mime)

    // то, что уехало в аплоад, сервер и вернёт в mime_type документа
    expect(uploadMime).toBe(VOICE_MIME)
    const echo = echoDocument(uploadMime)

    expect(optimistic.type).toBe('voice')
    expect(echo.type).toBe('voice')
    expect(optimistic.type).toBe(echo.type)
  })

  it('на webm тот же путь дал бы РАЗНЫЕ описания только вместе — оба съезжают в audio', async () => {
    noWebCodecs()
    installMediaRecorder(['audio/webm;codecs=opus'])
    const r = await record()
    const { doc: optimistic, uploadMime } = await optimisticDocument(r!.blob!, r!.mime)

    // Дефект был не в расхождении концов, а в том, что оба конца одинаково НЕ
    // голосовые: сервер отдаёт тот же mime, с которым файл залит.
    expect(uploadMime).toBe('audio/webm')
    expect(optimistic.type).toBe('audio')
    expect(echoDocument(uploadMime).type).toBe('audio')
  })
})
