/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/call/microphoneLevelMeter.tsx:1-176 (812502980) —
 * живой уровень микрофона: свой `MediaStream` через `acquireStream`,
 * `AnalyserNode` и пик по частотным корзинам на каждый кадр.
 *
 * Расхождения с оригиналом: `webkitAudioContext` — через явный тип окна
 * вместо `any`; `aria-label` — текст ключа `i18n(...).textContent`, как у
 * оригинала (строка, не узел: это атрибут).
 */
import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import getAudioConstraints from '@lib/calls/helpers/getAudioConstraints'
import acquireStream, { type StreamAcquisition } from '@lib/calls/helpers/acquireStream'
import { i18n } from '@lib/langPack'

// A live microphone level meter. Acquires its own MediaStream so the user
// can confirm "is my mic actually working" outside an active call — the bar
// fills proportionally to the captured amplitude and re-acquires when the
// `deviceId` prop changes.
//
// We intentionally re-request the stream instead of piggy-backing on an
// existing call's StreamManager: the meter is mounted in places where a call
// may not be running (Speakers and Camera settings tab), and a parallel
// MediaStream is cheap on every browser that supports `enumerateDevices`.

export type MicrophoneLevelMeterProps = {
  deviceId?: string
  // Visual height in px. The meter spans 100% of the parent's width.
  height?: number
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

export default function MicrophoneLevelMeter(props: MicrophoneLevelMeterProps) {
  // 0..1 amplitude; the bar's width = amplitude * 100%.
  const [amplitude, setAmplitude] = createSignal(0)
  const [hasError, setHasError] = createSignal(false)

  let raf: number | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let analyser: AnalyserNode | undefined
  let stream: MediaStream | undefined
  let buffer: Uint8Array | undefined
  // Holds the in-flight / active mic acquire so teardown can dispose() it —
  // getUserMedia can't be cancelled, so a stream resolving after unmount / mic
  // switch is stopped instead of leaking. See acquireStream.
  let acquisition: StreamAcquisition | undefined

  const teardown = () => {
    if(raf !== undefined) {
      cancelAnimationFrame(raf)
      raf = undefined
    }
    if(source) {
      try { source.disconnect() } catch {}
      source = undefined
    }
    if(analyser) {
      try { analyser.disconnect() } catch {}
      analyser = undefined
    }
    // dispose() owns the mic stream's tracks (stops the in-flight one too).
    acquisition?.dispose()
    acquisition = undefined
    stream = undefined
    if(context) {
      // AudioContext is recreated for every acquired stream. Closing the old
      // one releases its audio thread/device resources; suspending and losing
      // the reference would leak a context on every device switch.
      try {
        context.close().catch(() => {})
      } catch {}
      context = undefined
    }
    setAmplitude(0)
  }

  const start = async() => {
    teardown()
    setHasError(false)

    // `getStream` self-heals a stale persisted mic id (clears appSettings,
    // retries with the default) so the meter doesn't lock on an error.
    const current = acquisition = acquireStream({
      audio: getAudioConstraints(props.deviceId),
    })
    let acquired: MediaStream | undefined
    try {
      acquired = await current.promise
    } catch(err) {
      // A disposed acquire resolves undefined, so only a real, still-wanted
      // error reaches here.
      console.error('microphone level meter acquisition failed', err)
      setHasError(true)
      return
    }

    // Disposed (unmount / mic switch) while getUserMedia resolved — dispose()
    // already stopped the orphaned stream.
    if(!acquired) return
    stream = acquired

    try {
      const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext
      context = new Ctor()
      source = context.createMediaStreamSource(stream)
      analyser = context.createAnalyser()
      analyser.fftSize = 256
      // Tight smoothing keeps the meter visibly responsive — the default 0.8
      // washes out short syllables into a slow ramp.
      analyser.smoothingTimeConstant = 0.2
      source.connect(analyser)
      buffer = new Uint8Array(analyser.frequencyBinCount)
    } catch(err) {
      console.error('microphone level meter initialization failed', err)
      teardown()
      setHasError(true)
      return
    }

    const tick = () => {
      if(!analyser || !buffer) return
      // Cast to `Uint8Array<ArrayBuffer>` for getByteFrequencyData — TS infers
      // the buffer's backing type as `ArrayBufferLike` (which includes
      // SharedArrayBuffer), but AnalyserNode only accepts ArrayBuffer-backed
      // typed arrays. The cast is safe because `new Uint8Array(number)`
      // always allocates a plain ArrayBuffer.
      analyser.getByteFrequencyData(buffer as Uint8Array<ArrayBuffer>)
      // Use the loudest bin (rather than the average): the eye reads peaks
      // as "the mic heard me", whereas averaged level looks dead at typical
      // speech volumes.
      let peak = 0
      for(let i = 0; i < buffer.length; i++) {
        if(buffer[i] > peak) peak = buffer[i]
      }
      setAmplitude(peak / 255)
      raf = requestAnimationFrame(tick)
    }
    tick()
  }

  onMount(() => {
    void start()
    onCleanup(() => {
      teardown()
    })
  })

  // Re-acquire when the selected mic changes. `defer: true` so we don't
  // double-start on mount.
  createEffect(on(() => props.deviceId, () => {
    void start()
  }, { defer: true }))

  const height = props.height ?? 8

  return (<>
    <div
      class="microphone-level-meter"
      role="meter"
      aria-label={i18n('AccDescr.MicrophoneLevel').textContent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(amplitude() * 100)}
      style={{ height: height + 'px' }}
      aria-hidden={hasError() ? 'true' : undefined}
    >
      <div
        class="microphone-level-meter__fill"
        style={{
          width: (amplitude() * 100) + '%',
          opacity: hasError() ? '0.3' : '1',
        }}
      />
    </div>
    <Show when={hasError()}>
      <div
        class="microphone-level-meter__error"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {i18n('CallSettings.MicrophoneUnavailable')}
      </div>
    </Show>
  </>)
}
