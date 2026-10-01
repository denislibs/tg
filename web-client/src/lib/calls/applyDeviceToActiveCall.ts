// Порт tweb/src/lib/calls/applyDeviceToActiveCall.ts:1-77 (812502980).
//
// Расхождения:
//  1. Живой звонок у нас — не `CallInstanceBase` из `callsController`/
//     `groupCallsController`, а модуль `core/calls/callEngine.ts` (один 1:1
//     звонок). `applyDeviceToActiveCall` поэтому ведёт микрофон и камеру в его
//     `applyDeviceToActiveCall` (`getUserMedia` → `replaceTrack`), а динамик
//     не трогает: `setSinkId` делает `CallScreen.tsx` по записанному
//     `speakerId` (подписка на zustand) — та же роль, что
//     `instance.setOutputDeviceId` оригинала. Групповой звонок
//     (`core/calls/groupCallEngine.ts`) выбор устройств не читает вовсе.
//  2. Движок гасит свои ошибки и ничего не отдаёт, поэтому «применено» —
//     всегда `true` после его промиса; откат `changeCallDevice` сработает,
//     когда движок начнёт сообщать об отказе (порт `callInstance` — волна
//     звонков).
import { applyDeviceToActiveCall as applyToCallEngine } from '@core/calls/callEngine'
import { CALL_DEVICE_SETTING_KEYS, type CallDeviceKind } from '@lib/calls/callDeviceKind'
import { appSettings, setAppSettings } from '@stores/appSettings.solid'

// Propagate a device-id change to whichever call is live. Used from the
// in-call settings popup (which also has a direct instance handle, but
// going through here keeps the audio-output / mic / camera plumbing
// in one place) AND from the Speakers-and-Camera settings tab + the shared
// `CallCameraSection` — neither of those has access to a CallInstance, but
// both still want the device change to take effect immediately without
// waiting for the user to drop and rejoin the call.
const deviceChanges: Record<CallDeviceKind, {
  generation: number
  pending: number
  confirmedId: string
}> = {
  speaker: { generation: 0, pending: 0, confirmedId: appSettings.callDevices.speakerId || '' },
  microphone: { generation: 0, pending: 0, confirmedId: appSettings.callDevices.microphoneId || '' },
  camera: { generation: 0, pending: 0, confirmedId: appSettings.callDevices.cameraId || '' },
}

export default function applyDeviceToActiveCall(kind: CallDeviceKind, deviceId: string): Promise<boolean> {
  switch(kind) {
    case 'speaker':
      return Promise.resolve(true)
    case 'microphone':
      return applyToCallEngine('mic', deviceId).then(() => true)
    case 'camera':
      return applyToCallEngine('camera', deviceId).then(() => true)
  }
}

// Persist a device selection optimistically while making the live call swap a
// real transaction. The module-level generation covers every picker surface,
// so a late failure from Settings cannot roll back a newer in-call selection.
// `getStream` may clear the requested id after a successful fallback to the OS
// default; in that case the cleared value becomes the confirmed selection.
export async function changeCallDevice(kind: CallDeviceKind, deviceId: string): Promise<boolean> {
  const state = deviceChanges[kind]
  const settingKey = CALL_DEVICE_SETTING_KEYS[kind]
  if(!state.pending) state.confirmedId = appSettings.callDevices[settingKey] || ''

  const generation = ++state.generation
  ++state.pending
  void setAppSettings('callDevices', settingKey, deviceId)

  try {
    const applied = await applyDeviceToActiveCall(kind, deviceId)
    if(generation !== state.generation || !applied) return false
    state.confirmedId = appSettings.callDevices[settingKey] || ''
    return true
  } catch(err) {
    if(generation !== state.generation) return false
    void setAppSettings('callDevices', settingKey, state.confirmedId)
    throw err
  } finally {
    --state.pending
  }
}
