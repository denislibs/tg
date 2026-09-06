// Генератор PNG первого кадра встроенных lottie-иллюстраций (обезьянки, уточки,
// папки, ключ, конверт — `public/assets/tgs/*.json`). Часть 2 задачи «фолбэк без
// WASM SIMD» (web-client/backlogs/frontend/lottie-no-wasm-fallback.md): без SIMD
// `lottieLoader.loadAnimationAsAsset` отклоняется с NO_WASM ДО первого кадра
// (`lib/lottie/lottieLoader.ts:215-216`) — канва в DOM не появляется вовсе. У этих
// 11 ассетов нет и не будет серверного превью (в отличие от настоящих стикеров —
// там тот же NO_WASM, но там же и отдельный долг на бэкенд, backend/backlogs/…
// /lottie-sticker-thumb-rasterization.md), зато первый кадр можно отрисовать
// ЗАРАНЕЕ, на сборке: PNG кладётся рядом с json и подставляется вместо канвы
// (`lib/lottie/lottieAssetFallback.ts`).
//
// ── Почему рендерит САМ tlottie.wasm, а не puppeteer/lottie-web/thorvg ──────
// Три альтернативы рассмотрены и отклонены:
//  • lottie-web (или форк под другим именем) — прямо запрещено программой
//    «один движок lottie» (`noLottieWeb.test.ts` сканирует и devDependencies
//    тоже) и вернуло бы второй движок ради ЕДИНОЖДЫ прогоняемого скрипта;
//  • puppeteer + headless Chromium — рабочий путь, но тянет ~200-300 МБ
//    браузера ради рендера 11 картинок, и рендерить пришлось бы ЧЕМ-ТО внутри
//    страницы — тем же lottie-web (см. пункт выше) или собственным портом
//    tlottie в браузер, то есть тем же кодом, что и здесь, но через куда более
//    тяжёлый транспорт;
//  • thorvg/dotlottie-web — другой движок вообще, третий рендерер в дереве,
//    ещё и завязанный на WebGL/Canvas в браузере (та же проблема, что и с
//    puppeteer, плюс новый движок).
// Вместо этого скрипт инстанцирует ТОТ ЖЕ `tlottie.wasm`, что уже вендорен и
// работает в бою (`src/vendor/tlottie/tlottie.wasm`), через тот же набор
// экспортов, что и `lib/lottie/tlottieWasm.ts` (create/render, PoC подтверждён
// вручную — Node ≥16.4 поддерживает WASM SIMD нативно, тот же движок, что и
// в браузере, даёт РОВНО тот кадр, что увидел бы пользователь с SIMD). Логика
// продублирована (а не импортирована из tlottieWasm.ts) намеренно: это plain
// Node ESM-скрипт без TS-лоадера (соглашение `scripts/*.mjs` в этом проекте —
// см. `write-version.mjs`/`codemod-langpack-keys.mjs`), а `tlottieWasm.ts` —
// вендоренный `@ts-nocheck`-островок с `fetch()` вместо чтения файла. Если
// апстрим (`docs/tweb` vendor) поменяет набор экспортов — синхронизировать оба
// места, обычным ревью диффа `tlottieWasm.ts`.
//
// ── Вес зависимостей: НОЛЬ новых ────────────────────────────────────────────
// PNG кодируется вручную (CRC32 + `node:zlib.deflateSync` для IDAT) — формат
// простой (IHDR/IDAT/IEND, RGBA8, без интерлейса), а тянуть `pngjs` (или любой
// другой энкодер) ради полусотни строк, которые уже есть в Node builtin'ах, не
// оправдано. Итог: ни один пакет не появляется в package.json.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TGS_DIR = resolve(root, 'public/assets/tgs')
const WASM_PATH = resolve(root, 'src/vendor/tlottie/tlottie.wasm')
export const MANIFEST_PATH = resolve(root, 'src/lib/lottie/tgsThumbnails.manifest.json')

// ── Минимальный биндинг tlottie.wasm (подмножество tlottieWasm.ts, см. докблок) ──
async function createTLottie() {
  const bytes = readFileSync(WASM_PATH)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const exports = instance.exports
  const encoder = new TextEncoder()

  return {
    /** Рендерит кадр 0 в нативном разрешении ассета; возвращает {width,height,rgba}. */
    renderFirstFrame(json) {
      const jsonBytes = encoder.encode(json)
      const pointer = exports.tlottie_alloc(jsonBytes.length)
      if (!pointer) throw new Error('tlottie input allocation failed')
      let handle
      try {
        new Uint8Array(exports.memory.buffer, pointer, jsonBytes.length).set(jsonBytes)
        handle = exports.tlottie_new_with_options(pointer, jsonBytes.length, 0, 0, 0)
      } finally {
        exports.tlottie_free(pointer, jsonBytes.length)
      }
      if (!handle) throw new Error('tlottie rejected the animation')

      const width = exports.tlottie_width(handle)
      const height = exports.tlottie_height(handle)
      const framePtr = exports.tlottie_render(handle, 0, width, height, 1)
      if (!framePtr) throw new Error('tlottie frame render failed')
      // Копия ОБЯЗАТЕЛЬНА: tlottie_render может подвинуть memory.buffer у
      // следующего вызова (тот же контракт, что в tlottieWasm.ts:141-142) —
      // rgba должен пережить обработку следующего файла в цикле ниже.
      const rgba = Uint8Array.from(new Uint8Array(exports.memory.buffer, framePtr, width * height * 4))
      exports.tlottie_drop(handle)
      return { width, height, rgba }
    },
  }
}

// ── Ручной PNG-энкодер (RGBA8, без интерлейса) — см. докблок про вес зависимостей ──
function crc32Table() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}
const CRC_TABLE = crc32Table()
function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
function encodePng(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  const rgbaBuf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type: None
    rgbaBuf.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export async function generate() {
  const tlottie = await createTLottie()
  const files = readdirSync(TGS_DIR).filter((f) => f.endsWith('.json')).sort()
  const manifest = {}
  const report = []

  for (const file of files) {
    const name = basename(file, '.json')
    const jsonPath = resolve(TGS_DIR, file)
    const jsonBuf = readFileSync(jsonPath)
    const { width, height, rgba } = tlottie.renderFirstFrame(jsonBuf.toString('utf8'))
    const png = encodePng(rgba, width, height)
    const pngPath = resolve(TGS_DIR, `${name}.png`)
    writeFileSync(pngPath, png)

    manifest[name] = { jsonHash: sha256(jsonBuf), pngHash: sha256(png) }
    report.push({ name, width, height, pngBytes: png.length })
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  return report
}

// Прямой запуск (npm run generate-tgs-thumbnails).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await generate()
  let total = 0
  for (const r of report) {
    total += r.pngBytes
    console.log(`[generate-tgs-thumbnails] ${r.name}.png ${r.width}x${r.height} — ${(r.pngBytes / 1024).toFixed(1)} KB`)
  }
  console.log(`[generate-tgs-thumbnails] ${report.length} files, total ${(total / 1024).toFixed(1)} KB — manifest written to ${MANIFEST_PATH}`)
}
