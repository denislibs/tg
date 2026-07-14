// src/core/hooks/useVoiceRecorder.ts
// Owns the voice-message recording mechanics extracted from ConversationView:
// getUserMedia + MediaRecorder + the live waveform analyser + the elapsed/viz
// timers + recording state. It is deliberately decoupled from the app (no
// managers / chat / send logic): when a recording finishes it hands the result
// back via onComplete, and the caller uploads + sends it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEvent } from './useEvent'

export const REC_WAVE_BARS = 90 // live recording waveform bar count (fills the pill width)

export type RecordingMode = 'voice' | 'round'

// tweb chatRecording: видео-кружок пишется 400x400@30fps, 1.2Mbps/64kbps,
// с капом длительности 60с (лимит официальных клиентов).
const ROUND_SIZE = 400
const ROUND_MAX_SECS = 60

export interface VoiceResult {
  secs: number
  /** the recorded clip, or null when nothing was captured (empty recording) */
  blob: Blob | null
  mime: string
  mode: RecordingMode
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
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const shouldSend = useRef(false)
  const secsRef = useRef(0)
  const audioCtx = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)

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
    const mime = mediaRec.current?.mimeType || (modeRef.current === 'round' ? 'video/webm' : 'audio/webm')
    mediaRec.current = null
    if (!send || recordedSecs < 1) { o.current.onComplete(null); return }
    const blob = recordedChunks.length ? new Blob(recordedChunks, { type: mime }) : null
    o.current.onComplete({ secs: recordedSecs, blob, mime, mode: modeRef.current })
  }

  const modeRef = useRef<RecordingMode>('voice')

  // Start capturing: open the mic (+камеру для кружка), wire the recorder +
  // live waveform analyser.
  const start = useEvent(async (m: RecordingMode = 'voice') => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: m === 'round' ? { width: ROUND_SIZE, height: ROUND_SIZE, frameRate: 30, facingMode: 'user' } : false,
      })
      modeRef.current = m
      setMode(m)
      stream.current = s
      chunks.current = []
      if (m === 'round') setPreviewStream(s)
      // Prefer Opus at a decent bitrate (default browser bitrate is low → poor
      // quality); fall back to whatever the platform supports.
      const recOpts: MediaRecorderOptions =
        m === 'round'
          ? { videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 64_000 }
          : { audioBitsPerSecond: 96000 }
      // vp9 даёт заметно лучшее качество на том же битрейте; fallback на vp8
      const wantMimes = m === 'round'
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
        : ['audio/webm;codecs=opus']
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
        const an = ac.createAnalyser()
        an.fftSize = 512
        ac.createMediaStreamSource(s).connect(an)
        analyser.current = an
        setBars([])
        startVizTimer()
      } catch { /* visualizer optional */ }
    } catch {
      return // no mic / permission denied
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
    if (paused) {
      mr?.resume()
      startSecsTimer()
      startVizTimer()
      setPaused(false)
    } else {
      mr?.pause()
      window.clearInterval(timer.current)
      window.clearInterval(vizTimer.current)
      setPaused(true)
    }
  })

  const stop = useEvent((send: boolean) => {
    window.clearInterval(timer.current)
    setRecording(false)
    shouldSend.current = send
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
