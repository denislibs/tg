// Порядок диалогов — производная от данных (`core/dialogs/dialogIndex.ts`, порт
// tweb `generateDialogIndex`). Любая ручная перестановка возвращает ВТОРОЕ правило
// сортировки, а два правила означают ровно исходный баг: кэш даёт один порядок,
// ответ сети другой, и список перетасовывается через ~250 мс после первого кадра.
//
// Единственное разрешённое место сортировки — `applyDialogs`.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAW = readFileSync(join(__dirname, 'chatsStore.ts'), 'utf8')

// Комментарии выкидываем: в них объясняется, КАК было раньше (`firstUnpinned` +
// `slice`), и без этого инвариант ловил бы собственную документацию.
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** Тело файла без `applyDialogs` — там сортировка легальна. */
function bodyOutsideApplyDialogs(): string {
  const start = SRC.indexOf('function applyDialogs')
  expect(start).toBeGreaterThan(-1) // переименовали функцию — почини тест осознанно
  // Конец функции — по закрывающей скобке в нулевой колонке.
  const end = SRC.indexOf('\n}\n', start)
  return SRC.slice(0, start) + SRC.slice(end)
}

describe('chatsStore: порядок только через dialogIndex', () => {
  it('вне applyDialogs нет ручных перестановок списка', () => {
    const body = bodyOutsideApplyDialogs()

    expect(body).not.toMatch(/\.splice\(/)
    expect(body).not.toMatch(/\.sort\(/)
    expect(body).not.toMatch(/firstUnpinned/)
  })

  it('сортировка живёт ровно в одном месте', () => {
    expect(SRC.match(/\.sort\(/g) ?? []).toHaveLength(1)
  })

  it('индекс считается через dialogIndex, а не самодельной формулой', () => {
    expect(SRC).toMatch(/dialogIndex\(/)
    // 0x10000 / 0x7fff0000 — детали формулы, им место в dialogIndex.ts
    expect(SRC).not.toMatch(/0x10000|0x7fff0000/)
  })
})
