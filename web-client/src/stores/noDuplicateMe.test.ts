// Stage 1C.2 (Task 1): `me`/`meId` — воркер единственный вычислитель факта
// (workerCore.ts::setMe → rt:me), витрина зеркалит через
// client/realtime/storeProjection.ts (APPLY[RT.me]). Прямой
// chatsStore.setMe(...) МИМО проектора — второй независимый вывод того же
// факта (ровно баг, который чинит эта задача, см. docs/superpowers/plans/
// 2026-08-11-stage1c2-duplicate-facts.md) — допустим ТОЛЬКО в allow-list ниже,
// и то с обоснованием комментарием ПРЯМО У ВЫЗОВА в самом файле (см.
// web-client/CLAUDE.md «Тесты»). Новый файл с `.setMe(` вне списка — красная
// линия: либо переведи вызов на storeProjection (rt:me), либо осознанно
// добавь сюда с обоснованием и пометкой у строки. Образец — noManualOrder.test.ts.
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
 * Единственный безусловный писатель: `client/realtime/storeProjection.ts`
 * (APPLY[RT.me] — применяет rt:me от воркера). Остальные — allow-listed
 * исключения; обоснование у каждого — комментарий прямо у вызова в файле:
 *  - `stores/chatsStore.ts` (loadChats): тестируется в изоляции без живого
 *    воркера/rootScope (chatsStore.test.ts: «loadChats populates dialogs +
 *    meId»), зовётся из ~20 мест как рефетч диалогов; значение сходится с
 *    воркерным (тот же /me).
 *  - `stores/dialogsPersist.ts` (hydrateDialogsFromPersist): гидратация с
 *    диска до поднятия воркера — чтение вчерашнего кэша, не независимый
 *    вывод факта.
 *  - `core/hooks/useAuthGate.ts` (logout): синхронный локальный сброс тем же
 *    блоком, что dialogs/State; воркер отдельно разошлёт rt:me:null.
 *  - `components/EmojiStatusPicker.tsx`, `components/PremiumCheckout.tsx`,
 *    `components/settings/EditProfile.tsx`: мгновенный отклик на действие
 *    пользователя (попап закрывается/оплата проходит/экран уходит назад) —
 *    не ждём round-trip broadcast'а; воркер параллельно публикует тот же
 *    снимок остальным вкладкам (rt:me), повторное применение идемпотентно.
 */
const ALLOWED = [
  'client/realtime/storeProjection.ts',
  'stores/chatsStore.ts',
  'stores/dialogsPersist.ts',
  'core/hooks/useAuthGate.ts',
  'components/EmojiStatusPicker.tsx',
  'components/PremiumCheckout.tsx',
  'components/settings/EditProfile.tsx',
]

/**
 * НЕ про chatsStore: `core/workerCore.ts` определяет СВОЙ, одноимённый, но
 * совсем другой `function setMe(...)` — локальный хелпер воркера, который
 * кэширует `me` и зовёт `broadcast(RT.me, u)` (см. докблок у него). Воркер не
 * импортирует main-thread zustand-сторы (другой поток исполнения) — совпадение
 * имени, не тот же вызов. Без этого исключения скан ловил бы ОПРЕДЕЛЕНИЕ
 * функции, а не вызов chatsStore.setMe.
 */
const NOT_APPLICABLE = ['core/workerCore.ts']

describe('chatsStore.setMe: воркер вычисляет `me`, витрина только зеркалит', () => {
  it('прямые вызовы .setMe(...) есть только в allow-list', () => {
    const offenders = walk(SRC)
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.includes(rel) && !NOT_APPLICABLE.includes(rel))
      .filter((rel) => /\bsetMe\(/.test(readFileSync(join(SRC, rel), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('allow-list не разбух молча: каждая запись реально зовёт .setMe(...)', () => {
    for (const rel of ALLOWED) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(src, `${rel}: ожидался вызов .setMe(...)`).toMatch(/\bsetMe\(/)
    }
  })
})
