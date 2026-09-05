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
// компиляторной проверки). Этап 2 снял мост и скан вместе с ним, обосновав
// это тем, что имя ассета теперь проверяет TypeScript (параметр типа
// `LottieAssetName`). ФИНАЛЬНОЕ РЕВЬЮ ПРОГРАММЫ ПОКАЗАЛО: это неверно —
// `LottieAssetName` (`lottieLoader.ts:16-59`) вендорен 1:1 из tweb и держит
// 41 имя, а файлов на диске у нас 11 (`public/assets/tgs/`). Компилятор
// пропустит `<LottieSticker name="EmptyFolder" />` — оно валидный член
// союза — и это даст 404 в проде. Скан ниже восстановлен в НОВОМ виде:
// вместо СЫРОЙ строки (мост) он находит РЕАЛЬНЫЕ колл-сайты типизированного
// параметра и сверяет каждое литеральное имя с файлами на диске. Способов
// задать имя (грепом по `src`, см. коммит) ровно четыре:
//  1. `<LottieSticker name="X" .../>` (`components/LottieSticker.tsx`);
//  2. `<LottieAnimation name="X" .../>` (`components/lottieAnimation.solid.tsx`,
//     сейчас нет прямых потребителей — MediaHeader передаёт `props.name`,
//     не литерал, — но проверяется на будущее: тип позволяет);
//  3. `<MediaHeader.Sticker name="X" .../>` (`components/auth/MediaHeader.solid.tsx`);
//  4. литеральный второй аргумент `.loadAnimationAsAsset(params, 'X')`
//     (обе обезьянки, `PasswordMonkey.tsx`/`TrackingMonkey.solid.tsx`, зовут
//     `lottieLoader` напрямую, минуя все три обёртки выше).
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, resolve, join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import lottieLoader from './lottieLoader'

const PUBLIC_DIR = resolve(__dirname, '../../../public')
const TGS_DIR = resolve(PUBLIC_DIR, 'assets/tgs')
const SRC_DIR = resolve(__dirname, '../../')

// Обходит src/, собирая продакшн .ts/.tsx (без тестов — в тестах литеральное
// имя нередко НАРОЧНО не существует на диске: пин 404-ветки стаба/сервера).
function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkSourceFiles(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (entry.name.includes('.test.')) continue
    out.push(full)
  }
  return out
}

type CallSite = { file: string; name: string; via: string }

// Скан — текстовый (не AST), поэтому обязан игнорировать `//`-комментарии:
// иначе пояснение в духе «пример: <LottieSticker name="X" .../>» в чужом
// докблоке (как было найдено этим же сканом в `test/setup.ts` при первом
// прогоне) даёт ложное срабатывание. Многострочные `/* */` комментарии в
// этой кодовой базе для такого текста не используются (see CLAUDE.md style),
// поэтому проверяем только «есть ли `//` раньше в той же строке».
function isInLineComment(src: string, index: number): boolean {
  const lineStart = src.lastIndexOf('\n', index) + 1
  return src.slice(lineStart, index).includes('//')
}

// Скан 1: JSX-обёртки с пропом `name` типа `LottieAssetName` — литеральное
// значение атрибута (не выражение вроде `name={props.name}`).
const NAME_PROP_COMPONENTS = ['LottieSticker', 'LottieAnimation', 'MediaHeader\\.Sticker']

function scanJsxNameProps(files: string[]): CallSite[] {
  const sites: CallSite[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const component of NAME_PROP_COMPONENTS) {
      // Открывающий тег целиком (может занимать несколько строк), нежадно
      // до первого `>` — в наших компонентах у name-обёрток нет вложенных
      // `>` внутри атрибутов (ни generic'ов, ни JSX-выражений со сравнением).
      const tagRe = new RegExp(`<${component}\\b[\\s\\S]*?>`, 'g')
      let tagMatch: RegExpExecArray | null
      while ((tagMatch = tagRe.exec(src))) {
        if (isInLineComment(src, tagMatch.index)) continue
        const nameMatch = /\bname=(["'])([\w]+)\1/.exec(tagMatch[0])
        if (nameMatch) {
          sites.push({ file: relative(SRC_DIR, file), name: nameMatch[2], via: `<${component.replace('\\.', '.')} name>` })
        }
      }
    }
  }
  return sites
}

// Скан 2: литеральный второй аргумент `.loadAnimationAsAsset(params, 'X')`.
// Разбор по глубине скобок — аргумент params сам объект с запятыми внутри,
// поэтому просто искать "последнюю строку в скобках" регэкспом нельзя.
function scanLoadAnimationAsAssetLiterals(files: string[]): CallSite[] {
  const sites: CallSite[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const callRe = /\.loadAnimationAsAsset\(/g
    let callMatch: RegExpExecArray | null
    while ((callMatch = callRe.exec(src))) {
      if (isInLineComment(src, callMatch.index)) continue
      const argsStart = callMatch.index + callMatch[0].length
      let depth = 0
      let i = argsStart
      let segmentStart = argsStart
      const topLevelArgs: string[] = []
      for (; i < src.length; i++) {
        const ch = src[i]
        if (ch === '(' || ch === '{' || ch === '[') depth++
        else if (ch === ')' || ch === '}' || ch === ']') {
          if (depth === 0) break // закрывающая скобка самого вызова
          depth--
        } else if (ch === ',' && depth === 0) {
          topLevelArgs.push(src.slice(segmentStart, i).trim())
          segmentStart = i + 1
        }
      }
      const lastSegment = src.slice(segmentStart, i).trim()
      if (lastSegment) topLevelArgs.push(lastSegment) // трейлинг-запятая даёт пустой хвост — не аргумент
      const secondArg = topLevelArgs[topLevelArgs.length - 1] ?? ''
      const literalMatch = /^(["'])([\w]+)\1$/.exec(secondArg)
      if (literalMatch) {
        sites.push({ file: relative(SRC_DIR, file), name: literalMatch[2], via: '.loadAnimationAsAsset(params, name)' })
      }
    }
  }
  return sites
}

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

describe('assets/tgs — реальные колл-сайты используют только имена, для которых есть файл', () => {
  it('каждое литеральное имя (LottieSticker/LottieAnimation/MediaHeader.Sticker name=, .loadAnimationAsAsset(…, "X")) есть в public/assets/tgs/', () => {
    const files = walkSourceFiles(SRC_DIR)
    const sites = [...scanJsxNameProps(files), ...scanLoadAnimationAsAssetLiterals(files)]

    // Хоть один колл-сайт обязан найтись — иначе скан молча ничего не
    // проверяет (например, если все обёртки переименуют, а регэкспы не
    // обновят).
    expect(sites.length).toBeGreaterThan(0)

    const onDisk = new Set(readdirSync(TGS_DIR).map((f) => f.replace(/\.json$/, '')))
    const missing = sites.filter((site) => !onDisk.has(site.name))

    expect(missing, missing.map((m) => `${m.file}: "${m.name}" через ${m.via} — нет public/assets/tgs/${m.name}.json`).join('\n')).toEqual([])
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
