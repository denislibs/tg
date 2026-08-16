// Stage 1C.2 (Task 2): карточки пиров — воркерный peersManager единственный
// владелец (он же решает, ЧТО изменилось, и публикует это операцией rt:peer_op),
// а `core/peerCache.ts` — зеркало витрины. Прямая запись в зеркало МИМО проектора —
// второй независимый вывод того же факта (ровно баг, который чинит эта задача: до
// неё зеркало писали ещё usePeers `.then(upsert)` и обработчик RT.userUpdate с
// `patch` + `refresh().then(upsert)`, и на упавшем до-фетче аватара кэш воркера
// и витрина расходились навсегда — см. docs/superpowers/plans/
// 2026-08-11-stage1c2-duplicate-facts.md).
//
// Новый файл, зовущий `applyPeerOps`, — красная линия: либо публикуй операцию из
// владельца (peersManager) и применяй её проектором, либо осознанно добавь сюда
// с обоснованием и пометкой ПРЯМО У ВЫЗОВА (см. web-client/CLAUDE.md «Тесты»).
// Образец — core/noDuplicateMediaUrl.test.ts / stores/noManualOrder.test.ts.
//
// Зеркало ЖИВЁТ В ОБЫЧНОМ МОДУЛЕ, а не в zustand, потому что карточку читает не
// только React: императивная лента берёт имя автора синхронно на построении узла
// (`components/chat/peerTitle.ts`), а стор ей запрещён. Второе зеркало под ленту
// было бы дублем факта — поэтому оно одно, и этот пин сторожит именно его.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

/**
 * Единственный писатель: `client/realtime/storeProjection.ts` (APPLY[RT.peerOp] —
 * переигрывает операции, опубликованные владельцем). Исключений нет и заводить
 * их незачем: у пиров нет оптимистичного пути витрины (в отличие от `me`, где
 * своё же действие пользователя показывают до round-trip'а) — карточку чужого
 * юзера витрина не сочиняет, она её только показывает.
 */
const ALLOWED = [
  'core/peerCache.ts', // сам модуль зеркала: определение applyPeerOps
  'client/realtime/storeProjection.ts',
]

function writesToPeerMirror(src: string): boolean {
  return /\bapplyPeerOps\(/.test(src)
}

function offendersOf(call: RegExp): string[] {
  return walk(SRC)
    .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
    .filter((rel) => !ALLOWED.includes(rel))
    .filter((rel) => call.test(readFileSync(join(SRC, rel), 'utf8')))
}

describe('зеркало пиров: воркер владеет карточками, витрина только зеркалит', () => {
  it('писатели зеркала есть только в allow-list', () => {
    const offenders = walk(SRC)
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.includes(rel))
      .filter((rel) => writesToPeerMirror(readFileSync(join(SRC, rel), 'utf8')))

    expect(offenders).toEqual([])
  })

  // Сброс зеркала — тоже только проектор, на кадр rt:logging_out: реакция на
  // объявленное намерение, а не своя эвристика (см. «Выводить намерение из
  // значения» в web-client/CLAUDE.md).
  it('resetPeerMirror(...) зовут только зеркало и проектор', () => {
    expect(offendersOf(/\bresetPeerMirror\(/)).toEqual([])
  })

  it('allow-list не разбух молча: каждая запись реально пишет в зеркало', () => {
    for (const rel of ALLOWED) {
      expect(writesToPeerMirror(readFileSync(join(SRC, rel), 'utf8')), `${rel}: ожидался applyPeerOps(...)`).toBe(true)
    }
  })

  // Владелец обязан публиковать операцию, а не снимок кэша: снимок вернул бы
  // витрине право самой вычислять разницу — то самое второе правило, от которого
  // эта задача избавляется. Форма — как у MessageOp этапа 1B.
  it('peersManager публикует операции (PeerOp), а не весь кэш', () => {
    const src = readFileSync(join(SRC, 'core/managers/peersManager.ts'), 'utf8')
    expect(src).toMatch(/export type PeerOp\s*=/)
    expect(src).toMatch(/op: 'upsert'/)
    expect(src).toMatch(/op: 'patch'/)
  })
})
