// Порядок диалогов — производная от готового индекса, никогда ручная
// перестановка. Любая ручная перестановка возвращает ВТОРОЕ правило сортировки
// в дополнение к легальным, а лишнее правило означает ровно исходный баг: кэш
// даёт один порядок, ответ сети/воркера другой, и список перетасовывается
// через ~250 мс после первого кадра.
//
// Task 6 (снос старого пути): легаси-путь `applyDialogs`/`dialogIndex` на main
// снесён вместе с `setDialogs` (Task 2-5 перевели realtime-кадры, действия
// mute/pin/archive/theme, персист и, наконец, сетевой догон/гидрацию на
// владельца — `core/managers/dialogsManager.ts`). Теперь легальная точка
// сортировки на main РОВНО ОДНА — `sortDialogsByIndex` (зеркало DialogOp, индекс
// НЕ считает, берёт готовым), а сам `dialogIndex()` (порт tweb
// `generateDialogIndex`) зовётся РОВНО В ОДНОМ месте всего клиента —
// `core/managers/dialogsManager.ts` (владелец, живёт в воркере). Пересчёт
// dialogIndex на main воссоздал бы исходный баг — только теперь между воркером
// и main вместо кэша и сети.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC_ROOT = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

// Комментарии выкидываем: в них объясняется, КАК было раньше (`firstUnpinned` +
// `slice`, легаси applyDialogs) или упоминается dialogIndex() прозой (см.
// докблоки chatsStore.ts/dialogsManager.ts) — без этого инвариант ловил бы
// собственную документацию, а не код.
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const RAW = readFileSync(join(__dirname, 'chatsStore.ts'), 'utf8')
const SRC = stripComments(RAW)

/** Границы одной функции по её сигнатуре — конец: закрывающая скобка в нулевой колонке. */
function functionBody(marker: string): { start: number; end: number; body: string } {
  const start = SRC.indexOf(marker)
  expect(start).toBeGreaterThan(-1) // переименовали функцию — почини тест осознанно
  const end = SRC.indexOf('\n}\n', start)
  return { start, end, body: SRC.slice(start, end) }
}

describe('chatsStore: на main порядок не считают — только готовый индекс из DialogOp', () => {
  it('вне sortDialogsByIndex (единственная легальная точка сортировки) нет ручных перестановок списка', () => {
    const { start, end } = functionBody('function sortDialogsByIndex')
    const body = SRC.slice(0, start) + SRC.slice(end)

    expect(body).not.toMatch(/\.splice\(/)
    expect(body).not.toMatch(/\.sort\(/)
    expect(body).not.toMatch(/firstUnpinned/)
  })

  it('сортировка живёт ровно в одном месте: sortDialogsByIndex (зеркало)', () => {
    expect(SRC.match(/\.sort\(/g) ?? []).toHaveLength(1)
  })

  // Зеркальный путь не имеет права пересчитывать dialogIndex на main — иначе
  // это снова два источника порядка, тот самый баг, ради которого заведён
  // dialogIndex, только теперь между воркером и main.
  it('зеркальный путь (sortDialogsByIndex) НЕ пересчитывает dialogIndex — chatsStore.ts вообще его не импортирует', () => {
    // \b...\b — иначе матчится и легитимное поле dialogIndexById (индекс из
    // готовой операции, см. докблок ChatsState.dialogIndexById), не только сам
    // dialogIndex().
    expect(SRC).not.toMatch(/\bdialogIndex\b/)
  })

  // Решающая проверка норм задачи: dialogIndex() — не просто «не в chatsStore»,
  // а РОВНО в одном месте всего клиента. Новый вызов где-нибудь ещё (компонент,
  // другой стор, другой менеджер) — второй источник порядка.
  it('dialogIndex() зовётся ровно в одном месте всего клиента — core/managers/dialogsManager.ts', () => {
    const definitionFile = 'core/dialogs/dialogIndex.ts' // сама функция — не вызов
    const callers = walk(SRC_ROOT)
      .map((f) => f.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'))
      .filter((rel) => rel !== definitionFile)
      .filter((rel) => /\bdialogIndex\(/.test(stripComments(readFileSync(join(SRC_ROOT, rel), 'utf8'))))

    expect(callers).toEqual(['core/managers/dialogsManager.ts'])
  })
})
