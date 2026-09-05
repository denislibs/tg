// ПИН НА ПРОТУХАНИЕ (backlogs/frontend/lottie-no-wasm-fallback.md, часть 2 —
// встроенные иллюстрации задачи «фолбэк без WASM SIMD»): PNG первого кадра
// (`public/assets/tgs/<name>.png`) обязан пересобираться при изменении
// исходного json (`scripts/generate-tgs-thumbnails.mjs` → `npm run
// generate-tgs-thumbnails`). Без пина правка json тихо оставляет старый PNG —
// подставленный фолбэк начинает показывать кадр НЕ ТОГО ассета, и ни сборка,
// ни тайпчек этого не видят: имя файла то же, PNG существует, просто устарел.
//
// Механизм: `generate()` пишет `tgsThumbnails.manifest.json` — sha256 json И
// png на момент генерации. Тест сравнивает СЕЙЧАС посчитанные хеши обоих
// файлов с записанными в манифесте: расхождение json-хеша значит «json
// поменяли, PNG не пересобрали»; расхождение png-хеша значит «PNG подменили
// руками мимо генератора» (тоже протухание манифеста, только с другой стороны).
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, basename } from 'node:path'
import { describe, expect, it } from 'vitest'

const TGS_DIR = resolve(__dirname, '../../../public/assets/tgs')
// Тот же путь, что `MANIFEST_PATH` в `scripts/generate-tgs-thumbnails.mjs` —
// не импортируется оттуда напрямую: скрипт plain-JS (без .d.ts, соглашение
// `scripts/*.mjs` в проекте), `tsc --noEmit` иначе падает на implicit any.
const MANIFEST_PATH = resolve(__dirname, 'tgsThumbnails.manifest.json')

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

describe('tgsThumbnails.manifest.json — PNG не протух относительно json', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as
    Record<string, { jsonHash: string; pngHash: string }>
  const jsonFiles = readdirSync(TGS_DIR).filter((f) => f.endsWith('.json')).sort()

  it('манифест вообще что-то содержит (иначе остальные проверки пусты и зелены зря)', () => {
    expect(Object.keys(manifest).length).toBeGreaterThan(0)
    expect(jsonFiles.length).toBeGreaterThan(0)
  })

  it('у каждого json из public/assets/tgs есть запись в манифесте и PNG рядом', () => {
    for (const file of jsonFiles) {
      const name = basename(file, '.json')
      expect(manifest[name], `нет записи манифеста для ${name} — прогнать npm run generate-tgs-thumbnails`).toBeDefined()
    }
  })

  it.each(Object.keys(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))))(
    '%s: текущий hash json совпадает с манифестом (json не менялся без перегенерации PNG)',
    (name) => {
      const jsonBuf = readFileSync(resolve(TGS_DIR, `${name}.json`))
      expect(sha256(jsonBuf)).toBe(manifest[name].jsonHash)
    },
  )

  it.each(Object.keys(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))))(
    '%s: текущий hash png совпадает с манифестом (png не подменяли мимо генератора)',
    (name) => {
      const pngBuf = readFileSync(resolve(TGS_DIR, `${name}.png`))
      expect(sha256(pngBuf)).toBe(manifest[name].pngHash)
    },
  )
})
