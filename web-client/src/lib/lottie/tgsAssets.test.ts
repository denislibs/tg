// Этап 0 плана «один движок lottie»
// (docs/superpowers/plans/2026-09-05-lottie-single-engine.md) перенёс 11
// встроенных json-ассетов из бандла (`src/assets/tgs/*.json`) на статику
// (`public/assets/tgs/*.json`, git mv). Этот файл проверяет ДВА факта,
// требуемых планом, а не пересказывает их:
//
//  (a) ассет реально доезжает по URL `assets/tgs/<name>.json` — через
//      настоящий локальный HTTP-сервер, раздающий каталог `public/`, и
//      настоящие методы `lottieLoader` (`makeAssetUrl`/
//      `loadAnimationDataFromURL`), а не пересказ ожидаемого пути;
//  (b) скан: каждое имя, которое КОД РЕАЛЬНО использует (вызов
//      `loadTgsAsset('Name')` в продакшн-файлах — временный мост Этапа 0,
//      `components/lottie.ts`), имеет файл в `public/assets/tgs/`. Мёртвые
//      имена вендорного типа `LottieAssetName` (41 имя, из которых у нас есть
//      файлы только для 11) скан НЕ трогает — это ожидаемо: тип 1:1 с tweb.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import lottieLoader from './lottieLoader'

const PUBLIC_DIR = resolve(__dirname, '../../../public')
const TGS_DIR = resolve(PUBLIC_DIR, 'assets/tgs')
const SRC_DIR = resolve(__dirname, '../..')

describe('assets/tgs — ассет реально раздаётся со статики public/', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    // Настоящий статический сервер поверх настоящего `public/` — не мок:
    // проверяем, что файл, перенесённый `git mv`, физически лежит там, куда
    // ведёт `lottieLoader.makeAssetUrl`, и что раздаётся он БЕЗ искажений.
    server = createServer((req, res) => {
      const path = resolve(PUBLIC_DIR, '.' + req.url)
      if (!path.startsWith(PUBLIC_DIR) || !existsSync(path) || !statSync(path).isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      const contentType = extname(path) === '.json' ? 'application/json' : 'application/octet-stream'
      // Access-Control-Allow-Origin — как у настоящей раздачи public/ (nginx/dev-сервер).
      res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' })
      res.end(readFileSync(path))
    })
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}/`
  })

  afterAll(() => new Promise<void>((res) => server.close(() => res())))

  it('Mailbox.json доезжает по URL assets/tgs/Mailbox.json и совпадает с файлом на диске', async () => {
    // makeAssetUrl — реальный метод lottieLoader (lib/lottie/lottieLoader.ts:139-141),
    // не переписанный вручную путь.
    const relativeUrl = lottieLoader.makeAssetUrl('Mailbox')
    expect(relativeUrl).toBe('assets/tgs/Mailbox.json')

    const absoluteUrl = new URL(relativeUrl, baseUrl).href
    // loadAnimationDataFromURL — реальный fetch производственного кода
    // (lib/lottie/lottieLoader.ts:150-172), а не переписанный вручную fetch.
    const parsed = await lottieLoader.loadAnimationDataFromURL(absoluteUrl, 'json')

    const onDisk = JSON.parse(readFileSync(resolve(PUBLIC_DIR, relativeUrl), 'utf8'))
    expect(parsed).toEqual(onDisk)
    expect(parsed.nm).toBe('mailbox 4') // сигнатурное поле — не пустышка/заглушка
  })
})

// ---- Скан (b) ---------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Реальные имена, которые продакшн-код передаёт в `loadTgsAsset('Name')`
 *  (`components/lottie.ts` — временный мост Этапа 0 для четырёх потребителей,
 *  ещё не переведённых на `LottieAnimation`/tlottie). Тестовые файлы не
 *  сканируются: вызовы в них — не реальное потребление. */
function usedTgsNames(): Set<string> {
  const names = new Set<string>()
  const re = /loadTgsAsset\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const file of walk(SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) names.add(m[1])
  }
  return names
}

describe('assets/tgs — скан реальных потребителей', () => {
  it('каждое реально используемое имя имеет файл в public/assets/tgs/', () => {
    const used = usedTgsNames()

    // Порт не сломался и правда что-то сканирует — иначе тест проходит
    // фиктивно (пустое множество трогает любую регрессию).
    expect(used.size).toBeGreaterThan(0)

    const missing = [...used].filter((name) => !existsSync(join(TGS_DIR, `${name}.json`)))
    expect(missing).toEqual([])
  })

  it('в public/assets/tgs/ лежат все 11 файлов, перенесённых Этапом 0', () => {
    const files = readdirSync(TGS_DIR).sort()
    expect(files).toEqual(
      [
        'Folders_1.json',
        'Folders_2.json',
        'Mailbox.json',
        'TwoFactorSetupMonkeyIdle.json',
        'TwoFactorSetupMonkeyPeek.json',
        'TwoFactorSetupMonkeyTracking.json',
        'UtyanDisappear.json',
        'UtyanLinks.json',
        'UtyanPasscode.json',
        'UtyanSearch.json',
        'key.json',
      ].sort(),
    )
  })
})
