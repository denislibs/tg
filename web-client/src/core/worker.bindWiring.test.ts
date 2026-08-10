// Финальное ревью ветки worker-rootscope (I-1): worker.ts НЕ импортируется
// нигде во время выполнения (единственная ссылка на него в репозитории —
// `import type { WorkerRegistry }` в bootstrap.ts:7, стирается при сборке;
// причина — четыре верхнеуровневых сайд-эффекта модуля, включая обращение к
// IndexedDB, см. комментарий в workerScope.ts). Значит, проводку внутри
// bind() нельзя проверить, ВЫЗВАВ её, — только прочитав исходник текстом
// (тот же приём, что stores/noManualOrder.test.ts и
// core/state/noAdHocReads.test.ts используют для инвариантов, которые тоже
// не сводятся к прогону кода).
//
// Ревьюер финального ревью вырезал ОДНОВРЕМЕННО две строки в bind() —
// `smp.setOnPortDisconnect(() => { indexOfAndSplice(ports, smp) })` (Задача 2:
// без неё мёртвые порты закрытых вкладок копятся в ports[] до конца жизни
// воркера) и тело `smp.onAny(...)` с `workerScope.receiveFrom(smp, ...)`
// (Задача 1: без неё кадр, порождённый вкладкой, не ретранслируется соседним
// вкладкам) — получил 176 файлов / 1166 зелёных тестов. Это подпорка, не
// решение (настоящее — вынести бок-эффекты под `function main()` и сделать
// worker.ts импортируемым, см. бэклог 1C.2); здесь только текстовый заслон,
// чтобы вырезание этих строк не проходило молча.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAW = readFileSync(join(__dirname, 'worker.ts'), 'utf8')

// Комментарии выкидываем — иначе исходник самодокументируется через
// собственные пояснения, а не через реальный код (та же оговорка, что в
// noManualOrder.test.ts).
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** Тело function bind(ep: Endpoint) { … } — извлекаем балансировкой фигурных
 *  скобок (внутри bind() есть вложенные if/стрелки, наивный поиск первой
 *  `\n}\n`, как в noManualOrder.test.ts, тут даст обрезок). */
function bindBody(): string {
  const marker = 'function bind(ep: Endpoint) {'
  const start = SRC.indexOf(marker)
  expect(start).toBeGreaterThan(-1) // переименовали/переписали bind() — почини тест осознанно
  let i = start + marker.length
  let depth = 1
  while (depth > 0 && i < SRC.length) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') depth--
    i++
  }
  expect(depth).toBe(0) // не нашли закрывающую скобку — разметка теста поехала
  return SRC.slice(start, i)
}

describe('worker.ts:bind() — проводка не вырезана (текстовый инвариант, worker.ts не импортируем в тестах)', () => {
  const body = bindBody()

  it('setOnPortDisconnect снимает отключившийся порт из ports[] через indexOfAndSplice (Задача 2)', () => {
    expect(body).toMatch(/\.setOnPortDisconnect\(/)
    expect(body).toMatch(/indexOfAndSplice\(ports,\s*smp\)/)
  })

  it('onAny ретранслирует кадр вкладки соседям через workerScope.receiveFrom (Задача 1)', () => {
    expect(body).toMatch(/workerScope\.receiveFrom\(smp,/)
  })
})
