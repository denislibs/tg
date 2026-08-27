// ВТОРОЙ рекордер голосового — opus-recorder на WASM. Порт того, как его держит
// оригинал: `chatRecording.ts:148-155` берёт конструктор из `window.Recorder`, а
// кладёт его туда ленивый импорт вендорного чанка на входе в мессенджер
// (`bootstrapIm.ts:34-37`), причём ТОЛЬКО там, где нет штатного пути
// (`isNativeVoiceRecorderSupported()`).
//
// Зачем он вообще нужен, когда первый рекордер уже есть: WebCodecs-аудио
// (`AudioEncoder`) в WebKit появилось лишь в Safari 26 — версии 16.4…18.7
// отдавали только видео-половину API. Значит на Safari до 26 первый рекордер не
// конструируется, а `MediaRecorder` там пишет mp4 (с 18.4 — ещё и webm), и ни то
// ни другое голосовым сообщением не является: тип документа выводится из
// контейнера `audio/ogg` (`core/media/messageMedia.ts`, порт
// `appDocsManager.saveDoc:157`). Без этого чанка голос в Safari уходил бы
// музыкой.
//
// ── Отступления от оригинала ────────────────────────────────────────────────
//  • Грузим НЕ на входе в мессенджер, а на первой записи. У tweb загрузка стоит
//    в `bootstrapIm`, потому что там же живёт вся сборка чата; у нас входа с
//    такой ролью нет, а 385 КБ (в этой сборке wasm энкодера вшит в сам скрипт
//    data-URI — иначе он не поднялся бы в AudioWorklet, где нет fetch) незачем
//    тянуть тем, кто ни разу не нажмёт микрофон.
//  • Загрузка — тегом `<script>`, а не `import()`: вендорный файл UMD-модуль, и
//    протаскивать его через бандлер пришлось бы правкой самого файла (так
//    сделано у tweb — его `src/vendor/recorder.min.js` переписан в ESM). Нам
//    важнее, чтобы вендорный байт совпадал с опубликованным в npm: он лежит
//    рядом с воркерами (`public/opus/`, происхождение и суммы — в README там же)
//    и не тронут ни на байт.

/** Общая форма ДВУХ рекордеров голоса. Оригинал держит их в одном поле
 *  `this.recorder` и дальше не различает (`chatRecording.ts:129-155`) — наш
 *  `NativeVoiceRecorder` совпадает с opus-recorder по этой поверхности. */
export interface VoiceOggRecorder {
  sourceNode: MediaStreamAudioSourceNode
  ondataavailable: (data: Uint8Array) => void
  onstop: () => void
  start(): Promise<void>
  stop(): Promise<void> | void
  pause(): Promise<void> | void
  resume(): void
  /** Есть только у opus-recorder: его `stop()` глушит микрофон, но НЕ закрывает
   *  AudioContext — а браузер держит их считанные единицы на вкладку, так что
   *  без явного закрытия несколько записей подряд упрутся в лимит.
   *  `NativeVoiceRecorder` закрывает свой контекст сам внутри `stop()`. */
  close?(): Promise<void> | void
}

export interface OpusRecorderCtor {
  new (config: Record<string, unknown>): VoiceOggRecorder
  isRecordingSupported(): boolean
}

interface RecorderHost { Recorder?: OpusRecorderCtor }

const SCRIPT_URL = '/opus/recorder.min.js'
/** Путь энкодера отдаётся конструктору: сам вендор по умолчанию ищет его рядом
 *  с ДОКУМЕНТОМ (`encoderPath: 'encoderWorker.min.js'`), а он лежит в `/opus/`. */
export const ENCODER_PATH = '/opus/encoderWorker.min.js'

let loading: Promise<OpusRecorderCtor | null> | null = null

/**
 * Отдать конструктор `Recorder`, подгрузив вендорный чанк при первом обращении.
 * `null` — чанк не доехал (офлайн, 404): вызывающий откатывается на
 * `MediaRecorder`, как откатывается tweb, когда `window.Recorder` пуст.
 */
export function loadOpusRecorder(host: RecorderHost = globalThis as RecorderHost): Promise<OpusRecorderCtor | null> {
  // Готовый конструктор проверяется ПЕРВЫМ: удачная загрузка оставляет его в
  // глобали (так же, как `bootstrapIm.ts:49` кладёт его туда у оригинала), и
  // второй записи скачивать уже нечего.
  if (host.Recorder) return Promise.resolve(host.Recorder)
  if (loading) return loading

  loading = new Promise<OpusRecorderCtor | null>((resolve) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    // Ни удача, ни неудача не кэшируются в самом промисе: при удаче ответ даёт
    // глобаль выше, при неудаче (офлайн, 404) следующая запись обязана попробовать
    // скачать чанк заново, а не наследовать «нельзя» на всю сессию.
    const settle = (value: OpusRecorderCtor | null) => { loading = null; resolve(value) }
    script.addEventListener('load', () => { settle(host.Recorder ?? null) })
    script.addEventListener('error', () => { settle(null) })
    document.head.append(script)
  })
  return loading
}

/**
 * Сконструировать и запустить opus-recorder. `null` — на этой платформе он не
 * поднялся (нет чанка, нет WebAssembly/getUserMedia, отказ в микрофоне): у
 * оригинала конструктор тоже обёрнут в try/catch (`chatRecording.ts:150-154`).
 */
export async function createOpusRecorder(
  config: Record<string, unknown>,
  host?: RecorderHost,
): Promise<VoiceOggRecorder | null> {
  const Recorder = await loadOpusRecorder(host)
  if (!Recorder?.isRecordingSupported()) return null

  try {
    return new Recorder({ encoderPath: ENCODER_PATH, ...config })
  } catch (err) {
    console.error('Recorder constructor error:', err)
    return null
  }
}
