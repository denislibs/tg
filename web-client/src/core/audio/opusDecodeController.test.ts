// Конвейер ogg/opus → wav (порт tweb `lib/opusDecodeController.ts`).
//
// Проверяется ПРОТОКОЛ с вендорными воркерами opus-recorder 8.0.5
// (`public/opus/`, происхождение — там же в README): именно он тут наш код, а не
// сам libopus. Воркеры подменены — в happy-dom настоящих нет, а если бы и были,
// тест на 150 КБ wasm проверял бы чужую сборку, а не нашу проводку.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Sent { data: unknown; transfer?: Transferable[] }

class FakeWorker {
  static instances: FakeWorker[] = []
  public sent: Sent[] = []
  public terminated = false
  private listeners: Record<string, Array<(e: unknown) => void>> = {}

  constructor(public url: string) { FakeWorker.instances.push(this) }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb)
  }

  postMessage(data: unknown, options?: { transfer?: Transferable[] }): void {
    this.sent.push({ data, transfer: options?.transfer })
  }

  terminate(): void { this.terminated = true }

  emit(type: string, e: unknown): void { this.listeners[type]?.forEach((cb) => cb(e)) }
  emitMessage(data: unknown): void { this.emit('message', { data }) }
}

// Именно ПОСЛЕДНИЙ: упавшую пару контроллер пересоздаёт, и работать надо с живой.
const lastOf = (part: string) =>
  FakeWorker.instances.filter((w) => w.url.includes(part)).slice(-1)[0]
const decoder = () => lastOf('decoderWorker')
const wav = () => lastOf('waveWorker')
const commands = (w: FakeWorker) => w.sent.map((s) => (s.data as { command: string }).command)

let OpusDecodeController: typeof import('./opusDecodeController').OpusDecodeController

beforeEach(async () => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    const blob = b as Blob
    return `blob:${blob.type}:${blob.size}`
  })
  vi.useFakeTimers()
  vi.resetModules()
  OpusDecodeController = (await import('./opusDecodeController')).OpusDecodeController
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Пройти путь вендорных воркеров: декодер отдал два буфера и EOS, упаковщик — страницу. */
function runVendorPipeline(page: Uint8Array, buffers = 2): void {
  for (let i = 0; i < buffers; i++) decoder().emitMessage([new Float32Array([0.1 * i])])
  decoder().emitMessage(null)
  wav().emitMessage({ message: 'page', page })
}

describe('OpusDecodeController — протокол вендорных воркеров', () => {
  it('поднимает ровно ту пару воркеров, что лежит в public/opus', () => {
    void new OpusDecodeController().pushDecodeTask(new Uint8Array([1]))

    expect(FakeWorker.instances.map((w) => w.url).sort())
      .toEqual(['/opus/decoderWorker.min.js', '/opus/waveWorker.min.js'])
  })

  it('init обоим, потом decode со страницами ogg', () => {
    const pages = new Uint8Array([0x4f, 0x67, 0x67, 0x53])
    void new OpusDecodeController().pushDecodeTask(pages)

    expect(decoder().sent[0].data).toEqual({
      command: 'init', decoderSampleRate: 48000, outputBufferSampleRate: 48000,
    })
    expect(wav().sent[0].data).toEqual({ command: 'init', wavBitDepth: 16, wavSampleRate: 48000 })
    expect(decoder().sent[1].data).toEqual({ command: 'decode', pages })
  })

  it('буферы декодера уезжают упаковщику, EOS закрывает страницу, байты возвращаются', async () => {
    const page = new Uint8Array([0x52, 0x49, 0x46, 0x46, 7])
    const promise = new OpusDecodeController().pushDecodeTask(new Uint8Array([1]))

    decoder().emitMessage([new Float32Array([0.5])])
    expect(wav().sent[1].data).toMatchObject({ command: 'encode' })
    expect((wav().sent[1].data as { buffers: Float32Array[] }).buffers[0][0]).toBeCloseTo(0.5)

    // Пока EOS не пришёл — упаковщику не сказано «закрывай».
    expect(commands(wav())).not.toContain('done')
    decoder().emitMessage(null)
    expect(commands(wav())).toContain('done')

    wav().emitMessage({ message: 'page', page })
    await expect(promise).resolves.toBe(page)
  })

  it('служебные ответы упаковщика страницей не считаются', async () => {
    const promise = new OpusDecodeController().pushDecodeTask(new Uint8Array([1]))
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })

    wav().emitMessage({ message: 'ready' })
    wav().emitMessage({ message: 'done' })
    await Promise.resolve()
    expect(settled).toBe(false)

    runVendorPipeline(new Uint8Array([1, 2]))
    await expect(promise).resolves.toEqual(new Uint8Array([1, 2]))
  })

  it('decode() отдаёт blob-URL с типом audio/wav', async () => {
    const promise = new OpusDecodeController().decode(new Uint8Array([1]))
    runVendorPipeline(new Uint8Array([1, 2, 3]))

    await expect(promise).resolves.toEqual({ url: 'blob:audio/wav:3' })
  })

  it('доработав, воркеры гаснут — libopus не висит в памяти вкладки', async () => {
    const controller = new OpusDecodeController()
    const promise = controller.pushDecodeTask(new Uint8Array([1]))
    const [d, w] = [decoder(), wav()]

    expect(d.terminated).toBe(false)
    runVendorPipeline(new Uint8Array([1]))
    await promise

    expect([d.terminated, w.terminated]).toEqual([true, true])
  })

  it('вторая задача ждёт первую, потом идёт своим init+decode', async () => {
    const controller = new OpusDecodeController()
    const first = controller.pushDecodeTask(new Uint8Array([1]))
    const second = controller.pushDecodeTask(new Uint8Array([2, 2]))

    // Второй decode ещё не ушёл: очередь по одной задаче за раз.
    expect(commands(decoder()).filter((c) => c === 'decode')).toHaveLength(1)

    runVendorPipeline(new Uint8Array([9]))
    await expect(first).resolves.toEqual(new Uint8Array([9]))

    expect(decoder().sent.slice(-1)[0].data).toEqual({ command: 'decode', pages: new Uint8Array([2, 2]) })
    runVendorPipeline(new Uint8Array([8]))
    await expect(second).resolves.toEqual(new Uint8Array([8]))
  })

  it('молчание воркеров 10 с — отказ, а не вечное ожидание', async () => {
    const promise = new OpusDecodeController().pushDecodeTask(new Uint8Array([1]))
    const d = decoder()

    vi.advanceTimersByTime(9_999)
    vi.advanceTimersByTime(1)

    await expect(promise).rejects.toThrow('opus decode timeout')
    expect(d.terminated).toBe(true)
  })

  it('упавший воркер роняет свою задачу и пропускает вперёд следующую', async () => {
    const controller = new OpusDecodeController()
    const first = controller.pushDecodeTask(new Uint8Array([1]))
    const second = controller.pushDecodeTask(new Uint8Array([2]))

    decoder().emit('error', new Event('error'))
    await expect(first).rejects.toThrow('decoder worker error')

    // Пара пересоздана, вторая задача поехала.
    expect(decoder().sent.slice(-1)[0].data).toEqual({ command: 'decode', pages: new Uint8Array([2]) })
    runVendorPipeline(new Uint8Array([5]))
    await expect(second).resolves.toEqual(new Uint8Array([5]))
  })
})
