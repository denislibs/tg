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

describe('конфигурация двух рантаймов', () => {
  // Строка `solid({...})` в ПРОДУКТОВОМ vite.config.ts иначе не покрыта ничем:
  // её удаление ломает сборку, но не красит ни одного теста (vitest читает
  // vitest.config.ts). По норме проекта такая строка обязана иметь тест либо
  // пометку. Даём тест — тем же сканом исходника, что `core/scrollWriters.test.ts`.
  const configs = ['vite.config.ts', 'vitest.config.ts']

  it.each(configs)('%s подключает vite-plugin-solid', (name) => {
    const src = readFileSync(resolve(__dirname, '../../..', name), 'utf8')
    expect(src).toContain("from 'vite-plugin-solid'")
    expect(src).toMatch(/solid\(\{\s*include:/)
  })

  // Маска Solid-файлов больше не литерал в каждом конфиге (задача 3 вынесла
  // её в `SOLID_FILE_PATTERN` — см. fileRuntime.ts): оба конфига импортируют
  // ОДИН И ТОТ ЖЕ объект и подставляют его в `include`. Сам regexp уже
  // проверен в fileRuntime.test.ts (какие имена он матчит) — дублировать это
  // здесь незачем. Этот тест проверяет другое: что include реально питается
  // от общего источника, а не от параллельного литерала, который мог бы
  // рассинхронизироваться с react({exclude}) — то, из-за чего было падение
  // в задаче 1 (`*.solid.test.tsx` попадал под оба плагина).
  it.each(configs)(
    '%s передаёт в solid({include}) общий SOLID_FILE_PATTERN из fileRuntime',
    (name) => {
      const src = readFileSync(resolve(__dirname, '../../..', name), 'utf8')
      expect(src).toContain("from './src/shared/solid/fileRuntime'")
      expect(src).toMatch(/include:\s*\[SOLID_FILE_PATTERN\]/)
    },
  )

  it('vite.config.ts исключает Solid-файлы из React-плагина ТЕМ ЖЕ паттерном — иначе JSX преобразуется дважды', () => {
    const src = readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf8')
    expect(src).toMatch(/react\(\{\s*exclude:\s*\[SOLID_FILE_PATTERN\]/)
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
