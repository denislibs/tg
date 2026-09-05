# Деградация lottie без WASM SIMD — backlog

**Статус:** части 1 (медиаредактор) и 2 (встроенные иллюстрации) закрыты.
Остаток — часть 3, долг на бэкенд:
`backend/backlogs/lottie-sticker-thumb-rasterization.md`.
**Контекст:** программа «один движок lottie»
(`docs/superpowers/plans/2026-09-05-lottie-single-engine.md`) снесла `lottie-web`
и оставила единственный движок — вендоренный из tweb tlottie
(`web-client/src/lib/lottie/lottieLoader.ts` + `lottiePlayer.ts`, SIMD-декод в воркере).

---

## Проблема (исходная, до этой задачи)

Без WASM SIMD в браузере (практически весь актуальный список — Safari < 16.4)
`lottieLoader.loadAnimationFromURL`/`loadAnimationWorker` бросают `NO_WASM`
(`lottieLoader.ts:152`/`:216`), **до** первого кадра. Канвас плеера попадает в DOM
только на первом реально отрисованном кадре (`lottiePlayer.ts:1207` — аппендится
не при создании, а в момент рендера), поэтому при `NO_WASM` канвас не появлялся
вовсе: не серый прямоугольник, не статичная картинка — пустое место там, где
должна быть анимация. У медиаредактора эффект был тяжелее: слой без источника
пропадал молча и из ЭКСПОРТА (сохранённый файл отличался от того, что видел
пользователь, и он об этом не узнавал).

## Часть 1 — медиаредактор (закрыто)

- `StickerPicker.tsx`: lottie-ячейка гасится (opacity+cursor, подсказка
  «Animated stickers are not supported…») и клик по ней не добавляет слой —
  причина устранена ДО того, как слой попадает в сцену.
- `stickerAssets.ts`: `StickerAssets` получил `hasFailed()`/`onFail` — защита
  на случай, если слой всё же окажется в сцене без источника (гонка, обход
  пикера).
- `sceneRender.ts`: `unresolvedStickerLayers(stickers, failedIds)` — общая
  точка, которой пользуются баннер и блокировка сохранения.
- `MediaEditor.tsx`: `doFinish()` (photo и video — один путь) не даёт сохранить
  экспорт, пока в сцене есть слой без источника; видимый баннер, пока проблема
  не устранена.

Тесты: `stickerAssets.test.ts`, `StickerPicker.test.tsx`, `sceneRender.test.ts`
(мутации прогнаны фактически).

## Часть 2 — встроенные иллюстрации (закрыто)

11 файлов `public/assets/tgs/*.json` (обезьянки, уточки, папки, ключ, конверт)
без сервера-превью, но со статичным PNG первого кадра, собранным на сборке.

- `scripts/generate-tgs-thumbnails.mjs` — рендерит кадр 0 каждого ассета через
  ТОТ ЖЕ `tlottie.wasm`, что уже вендорен и работает в проде (Node ≥16.4
  поддерживает WASM SIMD нативно — рендер байт-в-байт совпадает с тем, что
  увидел бы пользователь с SIMD). PNG кодируется вручную (CRC32 + `node:zlib`)
  — ноль новых зависимостей. Puppeteer/lottie-web/thorvg рассмотрены и
  отклонены (вес браузера, второй движок, WebGL-заглушки в headless) — разбор
  в докблоке скрипта.
- `src/lib/lottie/lottieAssetFallback.ts` — единственная точка вставки
  фолбэка: `lottieLoader.loadAnimationAsAsset` (единственный вход всех пяти
  мест показа) на `NO_WASM` вставляет `<img>` с PNG в контейнер ДО реджекта.
  Идемпотентно на контейнер (`TrackingMonkey` — два лоадера, один
  `container`).
- Пин на протухание: `src/lib/lottie/tgsThumbnails.manifest.json` (sha256 json
  и png на момент генерации) + `tgsThumbnails.freshness.test.ts` — красный,
  если json поменяли, а `npm run generate-tgs-thumbnails` не прогнали.
- Суммарный вес: 11 PNG, 512×512, ~429 КБ (не в JS-бандле — статика `public/`,
  раздаётся тем же nginx `location /assets/tgs/` с ревалидацией, что и json,
  SW `TGS_RE` матчит путь целиком, не по расширению).

Тесты: `lottieAssetFallback.test.ts`, `lottieLoader.assetFallback.test.ts`,
`tgsThumbnails.freshness.test.ts`, обновлён `tgsAssets.test.ts` (состав
каталога). Мутации прогнаны фактически.

## Часть 3 — реальные стикеры (открыто, долг на бэкенд)

Растеризация первого кадра `.tgs` на сервере закрыла бы и ленту, и пикер, и
медиаредактор разом (сегодня у настоящих стикеров NO_WASM даёт тот же эффект,
что был у частей 1/2 до этой задачи, но там нет built-time генератора — файл
приезжает от пользователя). Заведено отдельно:
`backend/backlogs/lottie-sticker-thumb-rasterization.md`.

## Второй движок lottie не возвращается

Правки частей 1-2 не вернули `lottie-web` и не завели третий движок для
рендера — новый рендерер сборки переиспользует уже вендоренный `tlottie.wasm`
напрямую (без браузера и без DOM). Пин: `noLottieWeb.test.ts` остаётся зелёным.
