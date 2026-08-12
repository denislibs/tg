// Порядок диалогов — производная от готового индекса, никогда ручная
// перестановка. Любая ручная перестановка возвращает ВТОРОЕ правило сортировки
// в дополнение к легальным, а лишнее правило означает ровно исходный баг: кэш
// даёт один порядок, ответ сети/воркера другой, и список перетасовывается
// через ~250 мс после первого кадра.
//
// Task 2 (перенос владения диалогами в воркер) завёл ВТОРОЕ легальное место —
// они не конкурируют, потому что пишут РАЗНЫЕ (пока непересекающиеся) пути:
//   - `applyDialogs` — легаси-путь `setDialogs`/`loadChats` (Task 4/3 перевели
//     mute/pin/archive/theme и realtime-кадры на владельца — здесь остался
//     только он), индекс считает САМ через `dialogIndex()` (порт tweb generateDialogIndex);
//   - `sortDialogsByIndex` — зеркало операций воркера (`applyDialogOps`,
//     rt:dialog_op), индекс НЕ считает — берёт готовым из DialogOp (его уже
//     посчитал воркерный dialogsManager той же чистой `dialogIndex()`).
// Легаси-путь целиком уходит в Task 6 — тогда `applyDialogs`/dialogIndex здесь
// пропадают и остаётся только зеркало.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAW = readFileSync(join(__dirname, 'chatsStore.ts'), 'utf8')

// Комментарии выкидываем: в них объясняется, КАК было раньше (`firstUnpinned` +
// `slice`), и без этого инвариант ловил бы собственную документацию.
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const SORT_FUNCTIONS = ['function applyDialogs', 'function sortDialogsByIndex']

/** Границы одной функции по её сигнатуре — конец: закрывающая скобка в нулевой колонке. */
function functionBody(marker: string): { start: number; end: number; body: string } {
  const start = SRC.indexOf(marker)
  expect(start).toBeGreaterThan(-1) // переименовали функцию — почини тест осознанно
  const end = SRC.indexOf('\n}\n', start)
  return { start, end, body: SRC.slice(start, end) }
}

/** Тело файла без ОБЕИХ легальных точек сортировки. */
function bodyOutsideSortFunctions(): string {
  let body = SRC
  // С конца, чтобы индексы первой вырезки не съехали для второй.
  for (const marker of [...SORT_FUNCTIONS].reverse()) {
    const { start, end } = functionBody(marker)
    body = body.slice(0, start) + body.slice(end)
  }
  return body
}

describe('chatsStore: порядок только через готовый индекс (dialogIndex или DialogOp)', () => {
  it('вне двух легальных точек сортировки нет ручных перестановок списка', () => {
    const body = bodyOutsideSortFunctions()

    expect(body).not.toMatch(/\.splice\(/)
    expect(body).not.toMatch(/\.sort\(/)
    expect(body).not.toMatch(/firstUnpinned/)
  })

  it('сортировка живёт ровно в двух местах: applyDialogs (легаси) и sortDialogsByIndex (зеркало)', () => {
    expect(SRC.match(/\.sort\(/g) ?? []).toHaveLength(SORT_FUNCTIONS.length)
  })

  it('легаси-путь (applyDialogs) считает индекс через dialogIndex, а не самодельной формулой', () => {
    expect(SRC).toMatch(/dialogIndex\(/)
    // 0x10000 / 0x7fff0000 — детали формулы, им место в dialogIndex.ts
    expect(SRC).not.toMatch(/0x10000|0x7fff0000/)
  })

  // Зеркальный путь не имеет права пересчитывать dialogIndex на main — иначе
  // это снова два источника порядка (кэш/воркер и main), тот самый баг, ради
  // которого заведён applyDialogs, только теперь между воркером и main.
  it('зеркальный путь (sortDialogsByIndex) НЕ пересчитывает dialogIndex', () => {
    const { body } = functionBody('function sortDialogsByIndex')
    expect(body).not.toMatch(/dialogIndex\(/)
  })
})
