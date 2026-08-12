// Порт tweb `helpers/dom/fullScreen.ts` — в объёме потребителя Task 12
// (медиавьювер: гейт свайпов/verifyTouchTarget в фуллскрине).
// `requestFullScreen`/`cancelFullScreen`/`addFullScreenListener` приедут
// вместе с vanilla-плеером (Task 15) — их потребитель только он.
//
// Строгий tsconfig: вендор-префиксные поля объявлены узким локальным типом
// вместо `@ts-ignore` tweb — рантайм тот же (`||`-цепочка, как в оригинале).
type FullScreenDocument = Document & {
  mozFullScreenElement?: Element | null
  webkitFullscreenElement?: Element | null
  msFullscreenElement?: Element | null
}

export function getFullScreenElement() {
  const doc = document as FullScreenDocument
  return doc.fullscreenElement || doc.mozFullScreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement
}

export function isFullScreen() {
  return !!getFullScreenElement()
}
