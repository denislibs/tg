// Ленивый загрузчик lottie-web (~521 kB). Библиотека грузится только при первом реальном
// рендере анимации (стикер/эмодзи/уточка), а не в стартовом чанке. Промис кэшируется —
// один сетевой запрос на все места. Тип AnimationItem импортируется type-only в местах вызова.
type Lottie = typeof import('lottie-web')['default']

let promise: Promise<Lottie> | null = null

export function loadLottie(): Promise<Lottie> {
  if (!promise) promise = import('lottie-web').then((m) => m.default)
  return promise
}

// `loadTgsAsset` (мост Этапа 0 для 11 встроенных json-ассетов, git mv из
// бандла на `public/assets/tgs/*.json`) снят Этапом 2 плана «один движок
// lottie» (docs/superpowers/plans/2026-09-05-lottie-single-engine.md): его
// последние вызывающие — `LottieSticker.tsx` и `MediaHeader.solid.tsx` —
// переехали на портированный `LottieAnimation`/tlottie
// (`lib/lottie/lottieLoader.ts::loadAnimationAsAsset`, тот же URL строит
// `makeAssetUrl`, `lib/lottie/lottieLoader.ts:140`). Расхождение с планом
// (раздел «Этап 4»), объявленное здесь, а не молча: план числил
// `mediaEditor/stickerAssets.ts` третьим потребителем МОСТА, но на деле этот
// файл никогда не звал `loadTgsAsset` — он играет ПРОИЗВОЛЬНЫЕ пользовательские
// стикеры через `loadLottie()` (см. ниже), а не 11 встроенных именованных
// ассетов. У моста `loadTgsAsset` не осталось ни одного вызывающего уже
// сейчас, поэтому он удалён здесь, а не оставлен до Этапа 4 («снос пакета») —
// мёртвый код правило проекта требует убирать сразу (`CLAUDE.md`), а не
// держать до соседнего пункта плана.
//
// `loadLottie()` выше — у него больше нет ни одного потребителя: последний,
// `mediaEditor/stickerAssets.ts`, переехал на tlottie Этапом 3 плана. Сам файл
// (и `lottie-web` в package.json) снимает Этап 4 («снос пакета») — не здесь,
// чтобы не задевать test/setup.ts и сканы вне периметра Этапа 3.
