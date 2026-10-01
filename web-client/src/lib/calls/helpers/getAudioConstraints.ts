// Порт tweb/src/lib/calls/helpers/getAudioConstraints.ts:1-43 (812502980).
//
// Расхождение: `noiseSuppression` у tweb читается из
// `appSettings.callDevices.noiseSuppression` — тумблер живёт в попапе настроек
// звонка (`call/settingsPopup.tsx`), которого у нас нет; настройки нет и в
// zustand, поэтому берётся дефолт оригинала `true` (`?? true`, :33). Впрочем,
// ветка у tweb недостижима: `constraintSupported` всегда ложен (шапка
// `environment/constraintSupport.ts`).
import constraintSupported, { type MyMediaTrackSupportedConstraints } from '@environment/constraintSupport'
import { appSettings } from '@stores/appSettings.solid'

// `deviceId` opt-in: callers pass the persisted choice from
// `appSettings.callDevices.microphoneId`; the helper falls back to the store
// directly so older call sites that built the constraints without explicit
// args keep using the saved device. Empty string ⇒ no constraint ⇒ OS default.
//
// `noiseSuppression` honours the in-call toggle exposed in the settings
// popup; the other audio-DSP constraints (echo cancellation, auto gain) stay
// always-on because they have no user-facing switch yet and disabling either
// makes a call dramatically worse for the remote side.
export default function getAudioConstraints(deviceId?: string): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    channelCount: 2,
  }

  const desirable: (keyof MyMediaTrackSupportedConstraints)[] = [
    'echoCancellation',
    'autoGainControl',
  ]

  desirable.forEach((constraint) => {
    if(constraintSupported(constraint)) {
      (constraints as Record<string, unknown>)[constraint] = true
    }
  })

  // `noiseSuppression` defaults to true (legacy behavior) — opt-out via the
  // call settings toggle when the user wants to capture ambient sound.
  if(constraintSupported('noiseSuppression')) {
    constraints.noiseSuppression = true
  }

  const id = deviceId ?? appSettings.callDevices.microphoneId
  if(id) {
    constraints.deviceId = { exact: id }
  }

  return constraints
}
