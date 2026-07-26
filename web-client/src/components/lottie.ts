// Ленивый загрузчик lottie-web (~521 kB). Библиотека грузится только при первом реальном
// рендере анимации (стикер/эмодзи/уточка), а не в стартовом чанке. Промис кэшируется —
// один сетевой запрос на все места. Тип AnimationItem импортируется type-only в местах вызова.
type Lottie = typeof import('lottie-web')['default']

let promise: Promise<Lottie> | null = null

export function loadLottie(): Promise<Lottie> {
  if (!promise) promise = import('lottie-web').then((m) => m.default)
  return promise
}
