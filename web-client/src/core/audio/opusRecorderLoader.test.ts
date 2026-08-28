// Загрузка второго рекордера (opus-recorder на WASM) — порт того, как её ведёт
// оригинал: конструктор берётся из глобали (`chatRecording.ts:148`), а кладёт
// его туда ленивая загрузка вендорного чанка (`bootstrapIm.ts:34-37,48-50`).
//
// Стенд трогает РОВНО одно: подключение `<script>` к документу. Возможности
// платформы не снимаются вовсе — иначе ветки «чанк есть» и «чанк не доехал»
// перестали бы различаться.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let injected: HTMLScriptElement[] = []
let loader: typeof import('./opusRecorderLoader')

class FakeRecorder {
  static isRecordingSupported = (): boolean => true
  constructor(public config: Record<string, unknown>) {}
}

beforeEach(async () => {
  injected = []
  // Скрипт не подключаем к документу: happy-dom его всё равно не исполнит, а
  // событиями load/error мы управляем сами.
  vi.spyOn(document.head, 'append').mockImplementation((...nodes: unknown[]) => {
    injected.push(nodes[0] as HTMLScriptElement)
  })
  vi.resetModules()
  loader = await import('./opusRecorderLoader')
})

afterEach(() => { vi.restoreAllMocks() })

describe('loadOpusRecorder', () => {
  it('чанк уже в глобали — отдаём конструктор, ничего не качая', async () => {
    await expect(loader.loadOpusRecorder({ Recorder: FakeRecorder as never })).resolves.toBe(FakeRecorder)
    expect(injected).toHaveLength(0)
  })

  it('чанка нет — подключается ровно тот файл, что лежит в public/opus', async () => {
    const host: { Recorder?: unknown } = {}
    const promise = loader.loadOpusRecorder(host as never)

    expect(injected).toHaveLength(1)
    expect(injected[0].src).toContain('/opus/recorder.min.js')

    host.Recorder = FakeRecorder
    injected[0].dispatchEvent(new Event('load'))
    await expect(promise).resolves.toBe(FakeRecorder)
  })

  it('две записи подряд не качают чанк дважды', async () => {
    const host: { Recorder?: unknown } = {}
    const first = loader.loadOpusRecorder(host as never)
    const second = loader.loadOpusRecorder(host as never)

    expect(injected).toHaveLength(1)
    host.Recorder = FakeRecorder
    injected[0].dispatchEvent(new Event('load'))

    await expect(Promise.all([first, second])).resolves.toEqual([FakeRecorder, FakeRecorder])
    await loader.loadOpusRecorder(host as never)
    expect(injected).toHaveLength(1)
  })

  it('чанк не доехал — null, и следующая запись пробует скачать заново', async () => {
    const host: { Recorder?: unknown } = {}
    const first = loader.loadOpusRecorder(host as never)
    injected[0].dispatchEvent(new Event('error'))
    await expect(first).resolves.toBeNull()

    void loader.loadOpusRecorder(host as never)
    expect(injected).toHaveLength(2)
  })
})

describe('createOpusRecorder', () => {
  it('путь энкодера задаём мы: вендор по умолчанию ищет его рядом с документом', async () => {
    const rec = await loader.createOpusRecorder({ numberOfChannels: 1 }, { Recorder: FakeRecorder as never })

    expect((rec as unknown as FakeRecorder).config).toEqual({
      encoderPath: '/opus/encoderWorker.min.js',
      numberOfChannels: 1,
    })
  })

  it('платформа не тянет запись (нет WebAssembly/getUserMedia) — null, а не падение', async () => {
    class Unsupported {
      static isRecordingSupported = (): boolean => false
    }

    await expect(loader.createOpusRecorder({}, { Recorder: Unsupported as never })).resolves.toBeNull()
  })

  it('конструктор вендора бросил — null: у оригинала он тоже под try/catch', async () => {
    class Broken {
      static isRecordingSupported = (): boolean => true
      constructor() { throw new Error('nope') }
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(loader.createOpusRecorder({}, { Recorder: Broken as never })).resolves.toBeNull()
  })
})
