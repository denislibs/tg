// Порт tweb/src/environment/constraintSupport.ts:1-8 (812502980) — дословно,
// вместе с приоритетом операторов оригинала: `!!` применяется к результату
// `getSupportedConstraints()`, и индексируется уже `boolean`, поэтому функция
// у tweb всегда отдаёт `undefined`, а `getAudioConstraints` не ставит
// `echoCancellation`/`autoGainControl`/`noiseSuppression` — браузер берёт свои
// значения по умолчанию (у всех троих это `true`). Поведение сохранено: поток
// микрофона получается тот же, что у оригинала.
export type MyMediaTrackSupportedConstraints = MediaTrackSupportedConstraints & {
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

export default function constraintSupported(constraint: keyof MyMediaTrackSupportedConstraints) {
  return (!!navigator?.mediaDevices?.getSupportedConstraints() as unknown as MyMediaTrackSupportedConstraints)[constraint]
}
