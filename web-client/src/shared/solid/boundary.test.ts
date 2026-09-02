import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSolidFile } from './fileRuntime'

// Граница двух рантаймов держится ИМЕНЕМ ФАЙЛА, а имя ничего не проверяет само
// по себе. Этот скан — то, что делает соглашение обязательным: без него
// Solid-файл мог бы импортировать React, собраться и молча получить два
// рантайма в одном дереве. Тот же приём, что у `core/scrollWriters.test.ts`.
//
// Маска — ТОТ ЖЕ `isSolidFile`, что кормит `solid({include})`/`react({exclude})`
// в конфигах (см. fileRuntime.ts). Раньше здесь был отдельный литерал
// `p.endsWith('.solid.tsx')`, который не матчил `*.solid.test.tsx` — ровно тот
// класс файлов, ради которого fileRuntime и появился, — и скан «нет импортов
// React» проходил мимо них молча.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (isSolidFile(p)) out.push(p)
  }
  return out
}

// ── Конфигурация двух рантаймов ──────────────────────────────────────────────
//
// Проверяется ПОВЕДЕНИЕ плагина, а не текст конфига. Прежняя редакция сверяла
// исходник регэкспами (`/include:\s*\[SOLID_FILE_PATTERN\]/`) и краснела бы на
// законной правке — `[SOLID_FILE_PATTERN, ...extra]`, переименование импорта,
// перенос вызова в переменную, — при полностью исправной сборке. Обратное тоже
// верно: текст мог совпасть, а плагин получить другой паттерн (найдено ревью
// волны 0, пункт 3 задачи #104).
//
// Теперь конфиг ИМПОРТИРУЕТСЯ, из его `plugins` достаётся сам плагин Solid, и у
// него спрашивается ровно то, ради чего он там стоит: берёт ли он `*.solid.tsx`
// и оставляет ли `*.tsx` соседу. Это и есть граница рантаймов.
//
// У React-плагина так же спросить нельзя: его `transform` собирается в
// `configResolved`/`options` и без полного контекста Vite не вызывается
// (проверено). Поэтому его `exclude` остаётся под сканом исходника — но скан
// ищет ИДЕНТИФИКАТОР внутри вызова, а не точный литерал массива.
describe('конфигурация двух рантаймов', () => {
  const load = async (name: string) => {
    const mod = await import(/* @vite-ignore */ resolve(__dirname, '../../..', name))
    return mod.default as { plugins?: unknown[] }
  }

  /** Плагин Solid из массива `plugins` конфига (он там один и с этим именем). */
  const solidPluginOf = (config: { plugins?: unknown[] }) =>
    (config.plugins ?? [])
      .flat()
      .find((p): p is { name: string; transform: (code: string, id: string) => unknown } =>
        !!p && typeof p === 'object' && (p as { name?: string }).name === 'solid')

  const JSX_SOURCE = 'export const A = () => <div>x</div>\n'

  it.each(['vite.config.ts', 'vitest.config.ts'])('%s подключает плагин Solid', async (name) => {
    expect(solidPluginOf(await load(name))).toBeDefined()
  })

  it.each(['vite.config.ts', 'vitest.config.ts'])(
    '%s: плагин Solid берёт *.solid.tsx и НЕ берёт обычный *.tsx',
    async (name) => {
      const plugin = solidPluginOf(await load(name))!
      // `transform` вызывается с контекстом плагина Rollup; из него нужен
      // только `error` — на валидном исходнике он не зовётся.
      const run = (id: string) => plugin.transform.call({ error: () => {} }, JSX_SOURCE, id)

      expect(await run('/x/a.solid.tsx'), 'Solid-файл обязан пройти через плагин Solid').toBeTruthy()
      expect(await run('/x/a.tsx'), 'React-файл плагин Solid трогать не должен').toBeFalsy()
    },
  )

  it('vite.config.ts исключает Solid-файлы из React-плагина ТЕМ ЖЕ паттерном — иначе JSX преобразуется дважды', () => {
    const src = readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf8')
    // Ищем идентификатор ВНУТРИ вызова `react(...)`, а не точный вид массива:
    // `[SOLID_FILE_PATTERN, ...ещё]` — законная правка, и краснеть на ней пин
    // не должен. Что паттерн ОДИН на оба плагина, держит импорт из fileRuntime.
    expect(src).toContain("from './src/shared/solid/fileRuntime'")
    const call = /react\(\{([\s\S]*?)\}\)/.exec(src)
    expect(call, 'вызов react({...}) в конфиге не найден').not.toBeNull()
    expect(call![1]).toMatch(/exclude:[\s\S]*SOLID_FILE_PATTERN/)
  })
})

describe('граница двух JSX-рантаймов', () => {
  it('в *.solid.tsx нет импортов React', () => {
    const root = resolve(__dirname, '../..')
    const offenders = walk(root)
      .filter((p) => /from\s+['"]react(-dom)?['"]/.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(root.length + 1))

    expect(offenders).toEqual([])
  })

  it('скан вообще что-то видит — иначе пустой список ничего не доказывает', () => {
    expect(walk(resolve(__dirname, '../..')).length).toBeGreaterThan(0)
  })
})
