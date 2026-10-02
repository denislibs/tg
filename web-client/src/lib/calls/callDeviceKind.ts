// Порт tweb/src/lib/calls/callDeviceKind.ts:1-7 (812502980) — дословно.
// Ключи — пути tweb `appSettings.callDevices.*`; в наш zustand их переводит
// мост `stores/appSettings.solid.ts` (`callDevices`, О-2 плана 2D).
export type CallDeviceKind = 'speaker' | 'microphone' | 'camera'

export const CALL_DEVICE_SETTING_KEYS = {
  speaker: 'speakerId',
  microphone: 'microphoneId',
  camera: 'cameraId',
} as const satisfies Record<CallDeviceKind, 'speakerId' | 'microphoneId' | 'cameraId'>
