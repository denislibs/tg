// Этап 0 плана «один движок lottie»
// (docs/superpowers/plans/2026-09-05-lottie-single-engine.md) перенёс 11
// встроенных json-ассетов из бандла (`src/assets/tgs/*.json`) на статику
// (`public/assets/tgs/*.json`, git mv). Этот файл проверяет факт, требуемый
// планом, а не пересказывает его: ассет реально доезжает по URL
// `assets/tgs/<name>.json` — через настоящий локальный HTTP-сервер,
// раздающий каталог `public/`, и настоящие методы `lottieLoader`
// (`makeAssetUrl`/`loadAnimationDataFromURL`), а не пересказ ожидаемого пути.
//
// До Этапа 2 здесь же был скан продакшн-файлов на вызовы `loadTgsAsset('Name')`
// (временный мост `components/lottie.ts`, принимавший СЫРУЮ строку без
// компиляторной проверки — опечатка в имени ловилась только этим тестом).
// Этап 2 снял последних потребителей моста (`LottieSticker.tsx`,
// `MediaHeader.solid.tsx` — переехали на `LottieAnimation`/tlottie,
// `lib/lottie/lottieLoader.ts::loadAnimationAsAsset`) и сам мост
// (`components/lottie.ts::loadTgsAsset` удалён). Скан стал бы фиктивным
// (искать нечего — сканировать удалённую сигнатуру), поэтому убран вместе с
// мостом, а не переписан «на всякий случай»: имя ассета у оставшихся и новых
// потребителей теперь проверяет TypeScript (параметр типа `LottieAssetName`,
// а не `string`), а список файлов на диске фиксирует тест ниже.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import lottieLoader from './lottieLoader'

const PUBLIC_DIR = resolve(__dirname, '../../../public')
const TGS_DIR = resolve(PUBLIC_DIR, 'assets/tgs')

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

describe('assets/tgs — состав статики не разъехался с Этапом 0', () => {
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
