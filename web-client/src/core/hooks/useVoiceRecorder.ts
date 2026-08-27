// src/core/hooks/useVoiceRecorder.ts
// Owns the voice-message recording mechanics extracted from Chat: the recorder
// itself + the live waveform analyser + the elapsed/viz timers + recording
// state. It is deliberately decoupled from the app (no managers / chat / send
// logic): when a recording finishes it hands the result back via onComplete,
// and the caller uploads + sends it.
//
// Рекордеров ДВА, как и у оригинала (`chatRecording.ts::constructRecorder`):
// голосовое кодирует свой энкодер в ogg/opus (`core/audio/nativeVoiceRecorder.ts`),
// потому что голосовым сообщение делает именно контейнер (см. VOICE_MIME);
// кружок пишет `MediaRecorder`, он же остаётся запасным путём для голоса на
// платформах без WebCodecs.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEvent } from './useEvent'
import VoiceWaveformAnalyser from '../audio/voiceWaveformAnalyser'
import NativeVoiceRecorder, { isNativeVoiceRecorderSupported } from '../audio/nativeVoiceRecorder'

export const REC_WAVE_BARS = 90 // live recording waveform bar count (fills the pill width)

export type RecordingMode = 'voice' | 'round'

// tweb chatRecording: видео-кружок пишется 400x400@30fps, 1.2Mbps/64kbps,
// с капом длительности 60с (лимит официальных клиентов).
const ROUND_SIZE = 400
const ROUND_MAX_SECS = 60

/** Ограничения микрофона — одни на оба пути записи (свой энкодер и MediaRecorder). */
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
}

/** Контейнер голосового — порт tweb `chatRecording.ts:223`
 *  (`new Blob([typedArray], {type: 'audio/ogg'})`).
 *
 *  Это не «предпочтительный» формат, а ЕДИНСТВЕННЫЙ, при котором сообщение
 *  вообще является голосовым: тип документа выводится из атрибута + mime, и
 *  ветку `voice` открывает ровно `audio/ogg` (`core/media/messageMedia.ts`,
 *  порт `appDocsManager.saveDoc:157`). Поэтому голос кодируется своим
 *  энкодером (`core/audio/nativeVoiceRecorder.ts`), а не отдаётся
 *  `MediaRecorder`, который в Chrome пишет webm, а в Safari — mp4. */
export const VOICE_MIME = 'audio/ogg'

// Порядок предпочтений для запасного пути (WebCodecs нет): Firefox умеет ogg
// сам, остальные — только webm. Голосовым webm НЕ становится (см. VOICE_MIME).
const FALLBACK_VOICE_MIMES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus']

/** Контейнер без параметров кодека — порт tweb `nativeVideoRecorder.ts:258-261`
 *  («drop `;codecs=…`»): в mime файла едет контейнер, а не строка энкодера. */
function containerMime(mime: string | undefined): string {
  return (mime ?? '').split(';')[0].trim()
}

export interface VoiceResult {
  secs: number
  /** the recorded clip, or null when nothing was captured (empty recording) */
  blob: Blob | null
  mime: string
  mode: RecordingMode
  /** 5-битные пики waveform (голосовое) — посчитаны при записи; null для кружка */
  waveform: Uint8Array | null
}

export interface VoiceRecorderOptions {
  /** fired when capture actually begins (e.g. to ping the 'voice' typing status) */
  onStart?: () => void
  /** fired once per elapsed second (re-ping typing) */
  onSecond?: () => void
  /** finished: result, or null when discarded / too short (<1s) — caller no-ops */
  onComplete: (result: VoiceResult | null) => void
}

export interface VoiceRecorder {
  recording: boolean
  secs: number
  bars: number[]
  paused: boolean
  /** что пишем сейчас (актуально при recording) */
  mode: RecordingMode
  /** live-поток записи видео-кружка — для круглого превью (null у голосового) */
  previewStream: MediaStream | null
  start: (mode?: RecordingMode) => Promise<void>
  /** stop and either send (true) or discard (false) */
  stop: (send: boolean) => void
  togglePause: () => void
}

export function fmtDur(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function useVoiceRecorder(opts: VoiceRecorderOptions): VoiceRecorder {
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)
  const [bars, setBars] = useState<number[]>([])
  const [paused, setPaused] = useState(false)
  const [mode, setMode] = useState<RecordingMode>('voice')
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)

  const timer = useRef<number | undefined>(undefined)
  const vizTimer = useRef<number | undefined>(undefined)
  const mediaRec = useRef<MediaRecorder | null>(null)
  // Голосовое пишет свой энкодер (ogg/opus), кружок — MediaRecorder: активен
  // ровно один из двух.
  const nativeRec = useRef<NativeVoiceRecorder | null>(null)
  const oggBytes = useRef<Uint8Array | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const shouldSend = useRef(false)
  const secsRef = useRef(0)
  const audioCtx = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  // Анализатор пиков waveform (голосовое) — считает финальные пики при записи.
  const waveformAnalyser = useRef<VoiceWaveformAnalyser | null>(null)
  const waveformPeaks = useRef<Uint8Array | null>(null)

  // Пики снимаются РОВНО ОДИН РАЗ и запоминаются: у голосового анализатор висит
  // на графе самого рекордера, а тот закрывает свой AudioContext внутри stop()
  // — после закрытия снимать уже нечего.
  const takeWaveform = (): Uint8Array | null => {
    const wa = waveformAnalyser.current
    if (wa) {
      waveformAnalyser.current = null
      waveformPeaks.current = wa.finish()
    }
    return waveformPeaks.current
  }

  // Keep the latest options in a ref so the async timers / MediaRecorder.onstop
  // callbacks always see fresh closures (onComplete with current managers/chat),
  // not the values from the render where recording started.
  const o = useRef(opts)
  o.current = opts

  // Clear the interval timers if the component unmounts mid-recording.
  useEffect(() => () => {
    window.clearInterval(timer.current)
    window.clearInterval(vizTimer.current)
  }, [])

  // The 1s elapsed-timer.
  const startSecsTimer = () => {
    timer.current = window.setInterval(() => {
      secsRef.current += 1
      setSecs(secsRef.current)
      o.current.onSecond?.()
      // кап длительности кружка (tweb: 60с) — авто-отправка
      if (modeRef.current === 'round' && secsRef.current >= ROUND_MAX_SECS) stop(true)
    }, 1000)
  }
  // The live input-level waveform sampler (reads the stored analyser).
  const startVizTimer = () => {
    const an = analyser.current
    if (!an) return
    const data = new Uint8Array(an.fftSize)
    vizTimer.current = window.setInterval(() => {
      an.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
      const rms = Math.min(1, Math.sqrt(sum / data.length) * 2.6)
      setBars((prev) => { const next = [...prev, rms]; return next.length > REC_WAVE_BARS ? next.slice(next.length - REC_WAVE_BARS) : next })
    }, 70)
  }

  // Finalize: stop the analyser/stream, build the blob, hand it to onComplete.
  const finish = async () => {
    window.clearInterval(vizTimer.current)
    vizTimer.current = undefined
    analyser.current = null
    // Финализируем пики waveform ДО закрытия AudioContext (finish отключает свой
    // ScriptProcessor от графа). null для кружка / если анализатор не создавался.
    const waveform = takeWaveform()
    waveformPeaks.current = null
    const ac = audioCtx.current
    audioCtx.current = null
    if (ac) void ac.close()
    setBars([])
    setPaused(false)
    const s = stream.current
    stream.current = null
    s?.getTracks().forEach((t) => t.stop())
    setPreviewStream(null)
    const recordedSecs = secsRef.current
    secsRef.current = 0
    setSecs(0)
    const send = shouldSend.current
    shouldSend.current = false
    const recordedChunks = chunks.current
    chunks.current = []
    const ogg = oggBytes.current
    oggBytes.current = null
    const native = nativeRec.current !== null
    nativeRec.current = null
    // Голосовое своего энкодера — всегда ogg (порт tweb `chatRecording.ts:223`);
    // запасной MediaRecorder отдаёт контейнер, которым его сконфигурировали.
    const mime = native
      ? VOICE_MIME
      : containerMime(mediaRec.current?.mimeType) || (modeRef.current === 'round' ? 'video/webm' : 'audio/webm')
    mediaRec.current = null
    if (!send || recordedSecs < 1) { o.current.onComplete(null); return }
    // `as BlobPart` — тот же приём, что у оригинала (`chatRecording.ts:223`):
    // у `Uint8Array` буфер объявлен как `ArrayBufferLike`, а `BlobPart` требует
    // `ArrayBuffer`.
    const bytes: BlobPart[] = native ? (ogg?.length ? [ogg as BlobPart] : []) : recordedChunks
    const blob = bytes.length ? new Blob(bytes, { type: mime }) : null
    o.current.onComplete({ secs: recordedSecs, blob, mime, mode: modeRef.current, waveform })
  }

  const modeRef = useRef<RecordingMode>('voice')

  // Анализаторы вешаются на УЗЕЛ ГРАФА записи — тот же приём, что у оригинала
  // (`chatRecording.ts:1027-1029`: оба анализатора строятся от
  // `recorder.sourceNode`). Пики waveform считаем только для голосового.
  const attachAnalysers = (src: MediaStreamAudioSourceNode, m: RecordingMode) => {
    try {
      const an = src.context.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      analyser.current = an
      if (m === 'voice') waveformAnalyser.current = new VoiceWaveformAnalyser(src)
      setBars([])
      startVizTimer()
    } catch { /* visualizer optional */ }
  }

  // Start capturing: open the mic (+камеру для кружка), wire the recorder +
  // live waveform analyser.
  const start = useEvent(async (m: RecordingMode = 'voice') => {
    chunks.current = []
    oggBytes.current = null
    waveformPeaks.current = null
    // Голосовое: свой энкодер ogg/opus (порт tweb `chatRecording.ts:141`), поток
    // и AudioContext он открывает сам.
    if (m === 'voice' && isNativeVoiceRecorderSupported()) {
      const rec = new NativeVoiceRecorder({ mediaTrackConstraints: MIC_CONSTRAINTS })
      rec.ondataavailable = (data) => { oggBytes.current = data }
      rec.onstop = () => { void finish() }
      try {
        await rec.start()
      } catch {
        return // no mic / permission denied
      }
      modeRef.current = m
      setMode(m)
      nativeRec.current = rec
      attachAnalysers(rec.sourceNode, m)
    } else {
      // Кружок (всегда) и голос без WebCodecs: MediaRecorder на общем потоке.
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: MIC_CONSTRAINTS,
          video: m === 'round' ? { width: ROUND_SIZE, height: ROUND_SIZE, frameRate: 30, facingMode: 'user' } : false,
        })
        modeRef.current = m
        setMode(m)
        stream.current = s
        if (m === 'round') setPreviewStream(s)
        // Prefer Opus at a decent bitrate (default browser bitrate is low → poor
        // quality); fall back to whatever the platform supports.
        const recOpts: MediaRecorderOptions =
          m === 'round'
            ? { videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 64_000 }
            : { audioBitsPerSecond: 96000 }
        // vp9 даёт заметно лучшее качество на том же битрейте; fallback на vp8.
        // Голос без WebCodecs: ogg, если платформа его умеет (Firefox), иначе
        // webm — и тогда сообщение голосовым НЕ станет (см. VOICE_MIME).
        const wantMimes = m === 'round'
          ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
          : FALLBACK_VOICE_MIMES
        for (const mt of wantMimes) {
          if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mt)) {
            recOpts.mimeType = mt
            break
          }
        }
        const mr = new MediaRecorder(s, recOpts)
        mediaRec.current = mr
        mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
        mr.onstop = () => { void finish() }
        mr.start()
        try {
          const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          const ac = new Ctor()
          audioCtx.current = ac
          attachAnalysers(ac.createMediaStreamSource(s), m)
        } catch { /* visualizer optional */ }
      } catch {
        return // no mic / permission denied
      }
    }
    setRecording(true)
    setPaused(false)
    setSecs(0)
    secsRef.current = 0
    startSecsTimer()
    o.current.onStart?.()
  })

  // Pause / resume the recording (tweb's pause-toggle).
  const togglePause = useEvent(() => {
    const mr = mediaRec.current
    const nrec = nativeRec.current
    if (paused) {
      nrec?.resume()
      mr?.resume()
      startSecsTimer()
      startVizTimer()
      waveformAnalyser.current?.setPaused(false)
      setPaused(false)
    } else {
      void nrec?.pause()
      mr?.pause()
      window.clearInterval(timer.current)
      window.clearInterval(vizTimer.current)
      waveformAnalyser.current?.setPaused(true)
      setPaused(true)
    }
  })

  const stop = useEvent((send: boolean) => {
    window.clearInterval(timer.current)
    setRecording(false)
    shouldSend.current = send
    const nrec = nativeRec.current
    if (nrec) {
      // Пики снимаем ДО stop(): рекордер закрывает свой AudioContext, а
      // анализатор висит на его графе.
      takeWaveform()
      void nrec.stop() // → ondataavailable → onstop → finish
      return
    }
    const mr = mediaRec.current
    if (mr && mr.state !== 'inactive') mr.stop() // → onstop → finish
    else void finish()
  })

  // Memoized so the object identity is stable while idle (start/stop/togglePause
  // are useEvent-stable) — only changes when recording state actually moves. Keeps
  // a memoized <Composer> from re-rendering on unrelated parent renders (e.g. scroll).
  return useMemo(
    () => ({ recording, secs, bars, paused, mode, previewStream, start, stop, togglePause }),
    [recording, secs, bars, paused, mode, previewStream, start, stop, togglePause],
  )
}
