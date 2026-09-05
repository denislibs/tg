// Ленивый загрузчик lottie-web (~521 kB). Библиотека грузится только при первом реальном
// рендере анимации (стикер/эмодзи/уточка), а не в стартовом чанке. Промис кэшируется —
// один сетевой запрос на все места. Тип AnimationItem импортируется type-only в местах вызова.
type Lottie = typeof import('lottie-web')['default']

let promise: Promise<Lottie> | null = null

export function loadLottie(): Promise<Lottie> {
  if (!promise) promise = import('lottie-web').then((m) => m.default)
  return promise
}

// Мост Этапа 0 программы «один движок lottie»
// (docs/superpowers/plans/2026-09-05-lottie-single-engine.md). 11 встроенных
// json-ассетов (обезьянки/уточки/шапка письма) переехали из бандла
// (`src/assets/tgs/*.json`) на статику `public/assets/tgs/*.json` — git mv,
// история не теряется. Оставшиеся потребители ниже (`LottieSticker.tsx`,
// `mediaEditor/stickerAssets.ts`, `MediaHeader.solid.tsx`) ещё играют их
// через lottie-web (`loadLottie()`), это Этапы 2-3 плана («каждая — по одной,
// потом снос пакета»; Этап 1 уже перевёл обеих обезьянок,
// `PasswordMonkey.tsx`/`TrackingMonkey.solid.tsx`, на tlottie
// `lottieLoader.loadAnimationAsAsset` напрямую — здесь они больше не
// числятся). Здесь меняется ТОЛЬКО источник данных — раньше
// `import('../assets/tgs/X.json')` клал json в JS-чанк, теперь тот же json
// тянется по URL со статики (тот же путь, что строит
// `lottieLoader.makeAssetUrl` для tlottie — `lib/lottie/lottieLoader.ts:140`,
// вендорено из tweb `lottieLoader.ts:154-156`). Функция уйдёт вместе с
// `components/lottie.ts` целиком на Этапе 4 («снос пакета»), когда последний
// из оставшихся потребителей переедет на `LottieAnimation`/tlottie.
export function loadTgsAsset(name: string): Promise<{ default: unknown }> {
  return fetch(`/assets/tgs/${name}.json`)
    .then((res) => res.json())
    .then((data) => ({ default: data }))
}
