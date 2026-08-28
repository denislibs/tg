// Конвертация ogg/opus → wav для платформ, которые ogg не играют — порт tweb
// `src/lib/opusDecodeController.ts`.
//
// Модель оригинала сохранена: ДВА воркера (декодер opus → PCM-float, упаковщик
// PCM → wav), очередь задач по одной за раз (`tasks`) и таймаут 10 с, после
// которого воркеры убиваются, а очередь едет дальше. Воркеры поднимаются лениво
// и гаснут, как только очередь пуста (`terminateWorkers`) — libopus держать в
// памяти вкладки незачем.
//
// ── Отступления от оригинала и почему ───────────────────────────────────────
//  • Конец потока. tweb слушает `{type: 'done', waveform}` — это ДОПИСКА его
//    форка opus-recorder (`.gitmodules` → morethanwords/opus-recorder), где
//    декодер попутно считает пики волны. Мы вендорим чистый апстрим 8.0.5
//    (см. `public/opus/README.md`), а он по последней ogg-странице (флаг EOS)
//    зовёт `sendLastBuffer()` и шлёт `null`. Поэтому маркер конца здесь — `null`.
//  • `withWaveform` нет по той же причине: пики голосового считаются при записи
//    (`core/audio/voiceWaveformAnalyser.ts`) и едут в самом сообщении, поэтому
//    просить их у декодера не нужно даже там, где он это умеет.
//  • objectURL минтится здесь. У tweb `decode()` зовёт
//    `apiManagerProxy.invoke('createObjectURL')` (:174), потому что решение
//    принимается в его воркере, где `URL.createObjectURL` нет; у нас
//    конвертация живёт в главном потоке — минтить есть чем.
//  • Ошибка воркера роняет ЗАДАЧУ. У оригинала такой ветки нет вовсе (только
//    таймаут): апстримный упаковщик wav бросает на пустом входе
//    (`requestData()` читает `recordedBuffers[0].length`), и ждать 10 секунд,
//    чтобы узнать это, — не дело.
//  • `setKeepAlive`/`isPlaySupported` не портированы. Первый у tweb держит
//    воркеры поднятыми, ПОКА ИДЁТ ЗАПИСЬ (`chatRecording.ts:989`): он проигрывает
//    недописанный ogg через тот же декодер. У нас предпрослушивания записи нет, и
//    единственный потребитель контроллера — воспроизведение. Второй — обёртка над
//    `IS_OPUS_SUPPORTED`, который гейт читает напрямую.
import { IS_SAFARI } from '@environment/userAgent'

/** Раздаётся статикой, не бандлером: имя `.wasm` зашито в скрипт воркера
 *  относительно него самого — см. `public/opus/README.md`. */
const WORKER_BASE = '/opus/'

const SAMPLE_RATE = 48000
const TASK_TIMEOUT = 10e3

interface Task {
  pages: Uint8Array
  resolve: (bytes: Uint8Array) => void
  reject: (err: unknown) => void
  timeout: number
}

export class OpusDecodeController {
  private worker: Worker | null = null
  private wavWorker: Worker | null = null
  private tasks: Task[] = []

  private loadWavWorker(): void {
    if (this.wavWorker) return

    const worker = this.wavWorker = new Worker(`${WORKER_BASE}waveWorker.min.js`)
    worker.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { page?: Uint8Array } | null
      // Кроме страницы упаковщик шлёт `{message:'ready'|'done'}` — ждём именно
      // байты (тот же предикат, что у tweb: `data && data.page`).
      if (data && data.page) this.onTaskEnd(this.tasks.shift(), data.page)
    })
    worker.addEventListener('error', () => { this.failCurrentTask('wav worker error') })
  }

  private loadWorker(): void {
    if (this.worker) return

    const worker = this.worker = new Worker(`${WORKER_BASE}decoderWorker.min.js`)
    worker.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as Float32Array[] | null
      if (data === null) {
        // EOS: декодер отдал последний буфер — закрываем wav-страницу.
        this.wavWorker?.postMessage({ command: 'done' })
        return
      }

      this.wavWorker?.postMessage(
        { command: 'encode', buffers: data },
        // Тот же обход, что у оригинала (`opusDecodeController.ts:69`): на Safari
        // буферы копируются, а не передаются. Наш единственный потребитель —
        // как раз Safari, так что ветка передачи почти всегда мёртвая; она здесь
        // затем, что контроллер включается ещё и принудительно (тесты, отладка).
        { transfer: IS_SAFARI ? undefined : data.map((typedArray) => typedArray.buffer as ArrayBuffer) },
      )
    })
    worker.addEventListener('error', () => { this.failCurrentTask('decoder worker error') })
  }

  private onTaskEnd(task: Task | undefined, result?: Uint8Array): void {
    if (!task) return

    clearTimeout(task.timeout)
    if (result) task.resolve(result)
    else task.reject(new Error('opus decode timeout'))

    if (this.tasks.length) this.executeNewTask(this.tasks[0])
    this.terminateWorkers()
  }

  // Воркер упал на текущей задаче: убиваем пару (её состояние уже не наше) и
  // отдаём очереди следующую — иначе весь конвейер встанет до таймаута.
  private failCurrentTask(reason: string): void {
    const task = this.tasks.shift()
    this.terminateWorkers(true)
    if (task) {
      clearTimeout(task.timeout)
      task.reject(new Error(reason))
    }
    if (this.tasks.length) {
      this.loadWorker()
      this.loadWavWorker()
      this.executeNewTask(this.tasks[0])
    }
  }

  private terminateWorkers(kill = false): void {
    if (this.tasks.length && !kill) return

    this.worker?.terminate()
    this.worker = null
    this.wavWorker?.terminate()
    this.wavWorker = null
  }

  private executeNewTask(task: Task): void {
    this.worker?.postMessage({
      command: 'init',
      decoderSampleRate: SAMPLE_RATE,
      outputBufferSampleRate: SAMPLE_RATE,
    })

    this.wavWorker?.postMessage({
      command: 'init',
      wavBitDepth: 16,
      wavSampleRate: SAMPLE_RATE,
    })

    this.worker?.postMessage(
      { command: 'decode', pages: task.pages },
      { transfer: IS_SAFARI ? undefined : [task.pages.buffer as ArrayBuffer] },
    )

    task.timeout = window.setTimeout(() => {
      this.terminateWorkers(true)
      // `> 1`, а не `this.tasks.length` оригинала (:141): там в этот момент в
      // очереди ещё стоит сама протухшая задача, поэтому пара воркеров
      // поднималась ВСЕГДА — и на пустой очереди тут же гасла в onTaskEnd.
      // Инстанцирование libopus вхолостую того не стоит.
      if (this.tasks.length > 1) {
        this.loadWorker()
        this.loadWavWorker()
      }

      this.onTaskEnd(this.tasks.shift())
    }, TASK_TIMEOUT)
  }

  /** tweb `pushDecodeTask` (:150-167) — сырые wav-байты. */
  public pushDecodeTask(pages: Uint8Array): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const task: Task = { pages, resolve, reject, timeout: 0 }

      this.loadWorker()
      this.loadWavWorker()

      if (this.tasks.push(task) === 1) this.executeNewTask(task)
    })
  }

  /** tweb `decode` (:169-175) — готовый к подаче в `<audio>` blob-URL. */
  public async decode(typedArray: Uint8Array): Promise<{ url: string }> {
    const bytes = await this.pushDecodeTask(typedArray)
    return { url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' })) }
  }
}

const opusDecodeController = new OpusDecodeController()
export default opusDecodeController
