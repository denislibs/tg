// Stage 1C.2 (Task 2): карточки пиров — воркерный peersManager единственный
// владелец (он же решает, ЧТО изменилось, и публикует это операцией rt:peer_op),
// а `peersStore` — зеркало. Прямая запись в стор МИМО проектора — второй
// независимый вывод того же факта (ровно баг, который чинит эта задача: до неё
// стор писали ещё usePeers `.then(upsert)` и обработчик RT.userUpdate с
// `patch` + `refresh().then(upsert)`, и на упавшем до-фетче аватара кэш воркера
// и стор расходились навсегда — см. docs/superpowers/plans/
// 2026-08-11-stage1c2-duplicate-facts.md).
//
// Новый файл, пишущий в peersStore вне allow-list, — красная линия: либо
// публикуй операцию из владельца (peersManager) и применяй её проектором, либо
// осознанно добавь сюда с обоснованием и пометкой ПРЯМО У ВЫЗОВА (см.
// web-client/CLAUDE.md «Тесты»). Образец — noDuplicateMe.test.ts / noManualOrder.test.ts.
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
const ALLOWED = ['client/realtime/storeProjection.ts']

/**
 * Запись в стор ищем не по голым `upsert(`/`patch(` (их полно у других сторов),
 * а по обращениям К ЭТОМУ стору. Читающее обращение ровно одно —
 * `usePeersStore.getState().byId` (usePeers), его вырезаем перед проверкой,
 * поэтому деструктуризация писателя (`const { upsert } = usePeersStore.getState()`)
 * тоже считается нарушением, а не проскакивает мимо шаблона.
 */
function writesToPeersStore(src: string): boolean {
  const withoutReads = src.split('usePeersStore.getState().byId').join('')
  return /usePeersStore\.(getState|setState)\s*\(/.test(withoutReads)
    // хук-селектором тоже можно достать писателя: usePeersStore((s) => s.upsert)
    || /usePeersStore\(\s*\(?[^)]*\)?\s*=>\s*s?\.?\s*\w*\.?(upsert|patch)/.test(src)
}

describe('peersStore: воркер владеет карточками пиров, витрина только зеркалит', () => {
  it('писатели peersStore есть только в allow-list', () => {
    const offenders = walk(SRC)
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.includes(rel))
      .filter((rel) => writesToPeersStore(readFileSync(join(SRC, rel), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('allow-list не разбух молча: каждая запись реально пишет в peersStore', () => {
    for (const rel of ALLOWED) {
      expect(writesToPeersStore(readFileSync(join(SRC, rel), 'utf8')), `${rel}: ожидалась запись в peersStore`).toBe(true)
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
