// src/lazyChunks.test.ts
//
// Пин ЛЕНИВОСТИ тяжёлых узлов: перечисленные ниже модули не должны быть
// достижимы из точки входа (`src/main.tsx`) по СТАТИЧЕСКИМ импортам — только
// через `import()` (напрямую или обёрнутый в `lazy()`). Иначе Rolldown кладёт
// их в главный чанк, и они грузятся первым кадром, хотя нужны по требованию.
//
// Зачем пин. Такой регресс не виден ни в типах, ни в поведении, ни в обычных
// тестах: попап/панель работает точно так же, просто её байты уехали в главный
// бандл. Ровно это и случилось с `StickerSetModal` — клик по стикеру в ленте
// подключили статическим импортом в `Chat.tsx`, и попап (5.4 кБ, 2.5 кБ gzip)
// молча переехал из ленивого чанка в главный. Ловится это только осмотром
// сборки, а её никто не осматривает построчно.
//
// Форма — по образцу `core/scrollWriters.test.ts` и `core/state/noAdHocReads.test.ts`:
// читаем исходники ТЕКСТОМ, а не импортируем модули (импорт ничего не скажет о
// том, статический там путь или динамический), и держим явные списки, которые
// правятся руками при осознанном решении.
//
// ПОЧЕМУ ТЕКСТОВЫЙ ОБХОД, А НЕ ПРОВЕРКА СБОРКИ. Сборка в юнит-тестах — это
// минуты и отдельный артефакт; обход по исходникам занимает доли секунды и
// даёт ответ раньше. Обход СОЗНАТЕЛЬНО консервативен: он считает ребром и
// импорт, из которого сборщик потом вытрясет всё по tree-shaking, поэтому его
// множество — НАДмножество реального состава eager-чанков (сверено с
// sourcemap'ами `vite build --sourcemap`: 616 модулей у обхода против 598 у
// сборки, ни одного модуля сборки вне обхода). Значит «обход не нашёл» —
// гарантия «в главном бандле нет»; обратное неверно, и ложного зелёного здесь
// быть не может, только ложное красное на мёртвом импорте.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const SRC = __dirname
const ENTRY = join(SRC, 'main.tsx')

/**
 * Алиасы — зеркало `resolve.alias` из `vite.config.ts`. Дублируются здесь
 * текстом (импортировать конфиг нельзя: его тело на загрузке пишет
 * `public/version` и штампует `sw.js`), поэтому ниже отдельный пин на то, что
 * список не разъехался с конфигом.
 */
const ALIASES: Record<string, string> = {
  '@lib': 'lib',
  '@helpers': 'helpers',
  '@environment': 'environment',
  '@config': 'config',
  '@vendor': 'vendor',
  '@components': 'components',
  '@customEmoji': 'lib/customEmoji',
  '@core': 'core',
  '@stores': 'stores',
  '@shared': 'shared',
  '@rpc': 'rpc',
  '@types': 'types',
  '@layer': 'layer',
  '@': '',
}
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length)

/**
 * Только СТАТИЧЕСКИЕ рёбра: `import …from '…'`, `export …from '…'` и голый
 * `import '…'`. `import('…')` под шаблон не подходит по конструкции — за
 * `import` там сразу скобка, а не пробел, и это ровно та граница, которую пин
 * стережёт. `import type …` отброшен явно (стирается при сборке); инлайновый
 * `{ type X }` ребром считается — это делает пин строже, а не слабее.
 */
const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s+(?!type\s)(?:[^'"();]*?\sfrom\s*)?['"]([^'"]+)['"]/g

const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.d.ts']
/** Не-код: стили и ассеты рёбер графа модулей не образуют. */
const ASSET = /\.(scss|css|svg|png|jpe?g|gif|json|glsl|wasm|txt)$/

/**
 * Опись файлов `src/` — один обход каталога вместо десятков тысяч `existsSync`
 * при переборе расширений. Тест ходит по всему дереву импортов приложения и
 * идёт параллельно с остальным набором: лишняя синхронная возня с ФС здесь
 * тормозит соседние воркеры, а не только себя.
 */
const FILES = (function index(dir: string, acc = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) index(p, acc)
    else acc.add(p)
  }
  return acc
})(SRC)

/** Путь модуля по спецификатору импорта, либо null — если это пакет/ассет. */
function resolveSpec(spec: string, fromFile: string): string | null {
  const clean = spec.replace(/\?.*$/, '') // `…glsl?url&no-inline`, `…wasm?url`
  if (ASSET.test(clean)) return null
  let base: string
  if (clean.startsWith('.')) base = resolve(dirname(fromFile), clean)
  else {
    // `@solid-primitives/…` и прочие скоуп-пакеты: под алиас не подходят — пакет.
    const key = ALIAS_KEYS.find((k) => clean === k || clean.startsWith(k + '/'))
    if (!key) return null
    base = join(SRC, ALIASES[key], clean.slice(key.length))
  }
  for (const e of ['', ...CODE_EXTS]) if (FILES.has(base + e)) return base + e
  for (const e of CODE_EXTS) if (FILES.has(join(base, 'index' + e))) return join(base, 'index' + e)
  return null
}

/** Модули, достижимые из `main.tsx` по статическим импортам (пути от `src/`). */
function eagerGraph(): Set<string> {
  const seen = new Set<string>()
  const stack = [ENTRY]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file) || !/\.[jt]sx?$/.test(file)) continue
    seen.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const spec = m[1]
      if (!spec.startsWith('.') && !spec.startsWith('@')) continue // npm-пакет
      const next = resolveSpec(spec, file)
      if (next) stack.push(next)
    }
  }
  return new Set([...seen].map((p) => p.slice(SRC.length + 1)))
}

/**
 * Узлы, которые обязаны остаться за `import()`. Каждый — с местом, где стоит
 * его ленивая точка входа: если модуль тут, а ленивой точки нет — пин соврёт
 * зелёным, поэтому точка входа проверяется отдельным тестом ниже.
 */
const MUST_STAY_LAZY: Record<string, string> = {
  // Попап набора стикеров: сетка набора + StickerViewer. Открывается кликом по
  // стикеру в ленте (`components/Chat.tsx`) и по строке набора в поиске
  // стикеров (`rightSidebar/StickersSearchTab.tsx` — сам внутри EmojiDropdown).
  'components/stickers/StickerSetModal.tsx': 'components/Chat.tsx',
  // Пикер эмодзи/стикеров/гифок — `Composer.tsx:63`.
  'components/emoji/EmojiDropdown.tsx': 'components/Composer.tsx',
  // Инфо-панель чата — не первый кадр.
  'components/UserInfoPanel.tsx': 'components/Chat.tsx',
  // Экран настроек — открывается из левого сайдбара.
  'components/SettingsView.tsx': 'components/SidebarScreens.tsx',
  // Редактор медиа — самый тяжёлый узел, нужен только при отправке/сторис.
  'components/mediaEditor/MediaEditor.tsx': 'components/messages/SendMediaPopup.tsx',
  // Подсветка кода (prismjs) — только внутри блока кода в сообщении.
  'components/prism.ts': 'components/CodeBlock.tsx',
}

describe('ленивые чанки: тяжёлые узлы не втягиваются в главный бандл', () => {
  const eager = eagerGraph()

  // Санити: обход вообще дошёл до приложения. Без этого «ничего не достижимо»
  // (например, если сломается резолвер) выглядело бы как зелёный пин.
  it('обход доходит до ядра приложения', () => {
    expect(eager.has('App.tsx')).toBe(true)
    expect(eager.has('components/Chat.tsx')).toBe(true)
    expect(eager.has('components/Composer.tsx')).toBe(true)
    expect(eager.size).toBeGreaterThan(300)
  })

  for (const [mod, owner] of Object.entries(MUST_STAY_LAZY)) {
    it(`${mod} не достижим статически (ленивая точка входа — ${owner})`, () => {
      expect(eager.has(mod)).toBe(false)
    })

    it(`${mod} действительно подключён через import() в ${owner}`, () => {
      const src = readFileSync(join(SRC, owner), 'utf8')
      // Спецификатор в владельце — относительный либо алиасный; сверяем по
      // разрешённому пути, а не по тексту, чтобы пин не ломался от смены формы.
      const dynamic = [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)]
        .map((m) => resolveSpec(m[1], join(SRC, owner)))
        .filter((p): p is string => p !== null)
        .map((p) => p.slice(SRC.length + 1))
      expect(dynamic).toContain(mod)
    })
  }

  // Список алиасов обязан совпадать с `vite.config.ts`: разъехавшись, он тихо
  // сделает часть рёбер невидимой — и пин начнёт зеленеть на пустом месте.
  it('таблица алиасов совпадает с vite.config.ts', () => {
    const cfg = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8')
    const block = cfg.slice(cfg.indexOf('alias: {'), cfg.indexOf('},', cfg.indexOf('alias: {')))
    const fromCfg: Record<string, string> = {}
    for (const m of block.matchAll(/'(@[^']*)':\s*r\('src\/?([^']*)'\)/g)) fromCfg[m[1]] = m[2]
    expect(fromCfg).toEqual(ALIASES)
  })
})
