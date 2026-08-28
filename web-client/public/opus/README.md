# opus-recorder (вендорный чанк): запись и воспроизведение ogg/opus

Здесь лежит ЧУЖОЙ бинарник, не наш порт. Он нужен ровно тем браузерам, у которых
с ogg/opus плохо, и ровно двум их бедам — тем же двум, что у оригинала:

- **воспроизведение.** Платформа не играет `audio/ogg`
  (`src/environment/opusSupport.ts`) → голосовое перед подачей в `<audio>`
  конвертируется в wav (`src/core/audio/opusDecodeController.ts` —
  `decoderWorker` + `waveWorker`). У tweb это тот же приём: он поднимает
  `new Worker('decoderWorker.min.js')` и `new Worker('waveWorker.min.js')` из
  корня сайта (`src/lib/opusDecodeController.ts:41,55`), а гейт стоит в
  скачивании файла (`src/lib/appManagers/apiFileManager.ts:670`);
- **запись.** Платформа не даёт ogg ни своим энкодером (WebCodecs `AudioEncoder`
  в WebKit только с Safari 26), ни `MediaRecorder` → пишет `recorder.min.js` +
  `encoderWorker.min.js` (`src/core/audio/opusRecorderLoader.ts`). У tweb это
  второй из двух рекордеров (`chatRecording.ts:148-155`, чанк грузит
  `bootstrapIm.ts:34-37`).

## Происхождение

[`opus-recorder`](https://github.com/chris-rudmin/opus-recorder) **8.0.5**,
файлы взяты из опубликованного npm-пакета (НЕ из чужой сборки-форка):

- tarball: <https://registry.npmjs.org/opus-recorder/-/opus-recorder-8.0.5.tgz>
- npm integrity: `sha512-tBRXc9Btds7i3bVfA7d5rekAlyOcfsivt5vSIXHxRV1Oa+s6iXFW8omZ0Lm3ABWotVcEyKt96iIIUcgbV07YOw==`
- gitHead: `fdfdadeeb9bc9d045c59dc75ebefed390e4ad6dc`

Почему не файлы из tweb: tweb держит opus-recorder сабмодулем на СВОЙ форк
(`.gitmodules` → `morethanwords/opus-recorder`) и раздаёт собранные ИМ бинарники;
сверить их не с чем — воспроизводимой сборки у форка нет. Наши файлы, наоборот,
проверяемы: все пять сумм ниже и sha512 тарбола сверены с реестром npm заново
после вендоринга и совпали дословно. Байты форка при этом ОТ НАШИХ ОТЛИЧАЮТСЯ
(например, его `waveWorker.min.js` — `7212c39c…` против нашего `f28997…`), и
декодер форка расходится по протоколу: там дописана выдача waveform
(`{type:'done', waveform}`), которой в апстриме нет. Нам она не нужна — пики
голосового считаются при записи и едут в сообщении, — поэтому взят чистый
апстрим, а протокол воркеров описан в контроллере.

Контрольные суммы (sha256) вендорных файлов:

```
86536981602ec1afd99874f6f09c6b1a07ccaa017605be6e9c7e083193e91784  decoderWorker.min.js
cd1d29c43b3fa05719c3d024ed9b9f1528be92415bd6d39d413b262a61d1891f  decoderWorker.min.wasm
f28997781a0ea2a178fd44b5a09cf54776eafa14dff8a9e840c37ab1d0cb4ab8  waveWorker.min.js
c3a64a87b2868e37c0387da45262900820ec85ab448869011247cbd351858a95  encoderWorker.min.js
2d67b97cd56aaacf54dbd36136e631229b26994c99e174fb89e866b13edf4cfd  recorder.min.js
```

Воспроизвести:

```bash
curl -sSL https://registry.npmjs.org/opus-recorder/-/opus-recorder-8.0.5.tgz | tar xz
cp package/dist/{decoderWorker.min.js,decoderWorker.min.wasm,waveWorker.min.js} web-client/public/opus/
cp package/dist/{encoderWorker.min.js,recorder.min.js} web-client/public/opus/
cp package/LICENSE.md web-client/public/opus/
```

`encoderWorker.min.wasm` рядом нет намеренно: в этой сборке wasm энкодера вшит в
сам скрипт data-URI (потому он и весит 385 КБ). Иначе его нечем было бы взять —
энкодер поднимается в AudioWorklet, где нет ни `fetch`, ни `importScripts`.
Декодер, наоборот, живёт в обычном воркере и тянет свой `.wasm` файлом.

## Лицензия

MIT (opus-recorder) + BSD (libopus, speex resampler) — полный текст в
[`LICENSE.md`](./LICENSE.md) рядом, он приехал из того же пакета.

## Почему `public/`, а не `src/vendor/` с `?url`

`decoderWorker.min.js` — сборка emscripten: имя `.wasm` зашито в скрипт строкой и
резолвится ОТНОСИТЕЛЬНО САМОГО ВОРКЕРА (`wasmBinaryFile = locateFile("decoderWorker.min.wasm")`,
`scriptDirectory` воркера). Пропусти мы файлы через бандлер, оба получили бы
разные хеши в имени, и воркер пошёл бы за несуществующим
`/assets/decoderWorker.min.wasm`. Поэтому пара лежит рядом под стабильными
именами — ровно как в оригинале, где она раздаётся из корня сайта.
Это единственный ассет, который мы раздаём статикой; `tlottie.wasm` идёт
бандлером (`src/vendor/tlottie`) именно потому, что его имя приходит извне.

При обновлении версии переименовать каталог (`opus/` → `opus-<версия>/`) или
сбросить кэш иначе: имена файлов не контентно-адресуемы, `Cache-Control` на них
общий из `location /`.

## Цена

В бандл не попадает НИЧЕГО из этой папки ни на одном браузере: и воркеры, и
`recorder.min.js` берутся по URL. Скачиваются только по надобности, и надобности
разные:

- **декодер** (176 КБ, из них 150 — wasm libopus) — там, где
  `IS_OPUS_SUPPORTED === false`: Safari ниже 18.4 (Ogg-контейнер WebKit получил в
  18.4 / macOS 15.4, март 2025). Тянется при первом голосовом в ленте;
- **энкодер** (`recorder.min.js` 8 КБ + `encoderWorker.min.js` 385 КБ) — там, где
  ogg не даёт ни WebCodecs, ни `MediaRecorder`: Safari ниже 26 и старые Chrome.
  Тянется при первом нажатии на микрофон, не раньше (у tweb — на входе в
  мессенджер, `bootstrapIm.ts:34-37`).

В Chrome и Firefox не скачивается ничего.
