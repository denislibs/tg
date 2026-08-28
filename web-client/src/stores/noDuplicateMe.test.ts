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
 *  - `stores/chatsStore.ts` (loadChats): НЕ второй вывод факта, а
 *    альтернативный путь ЗАПРОСА уже посчитанного воркером значения —
 *    `managers.auth.me()` бьёт в тот же `authManager`, тот же токен, что и
 *    boot-цепочка воркера. Единственный надёжный канал холодного старта:
 *    `SuperMessagePort` не буферизует события, а подписка на `rt:me`
 *    (`startRealtime()`) подключается из эффекта ПОСЛЕ первого рендера —
 *    воркерный `/me` может разрешиться раньше и разослать `rt:me` в пустоту.
 *    Заодно тестируется в изоляции без живого воркера/rootScope
 *    (chatsStore.test.ts: «loadChats populates me/meId»).
 *  - `components/EmojiStatusPicker.tsx`, `components/PremiumCheckout.tsx`,
 *    `components/settings/EditProfile.tsx`: мгновенный отклик на действие
 *    пользователя (попап закрывается/оплата проходит/экран уходит назад) —
 *    не ждём round-trip broadcast'а; воркер параллельно публикует тот же
 *    снимок остальным вкладкам (rt:me), повторное применение идемпотентно.
 */
const ALLOWED = [
  'client/realtime/storeProjection.ts',
  'stores/chatsStore.ts',
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

/**
 * Второе зеркало того же факта — `rootScope.myId` (порт tweb rootScope.ts:253):
 * его читает императивный код, которому нельзя знать про zustand (лента
 * `components/chat/bubbles.ts`, порт tweb bubbles.ts). Скан выше его не поймал бы
 * ВООБЩЕ (там нет `setMe(`), поэтому пин — второй, с тем же смыслом и тем же
 * allow-list'ом: писатель у двух зеркал обязан быть один — проектор на `rt:me`.
 * В tweb `myId` пишет сам rootScope из подписки на `user_auth`; у нас это был бы
 * второй писатель факта `me` мимо проектора — расхождение сознательное (разбор в
 * докблоке поля).
 *
 * ALLOWED_MYID уже, чем ALLOWED: оптимистичным исключениям для React-стора
 * (EmojiStatusPicker/PremiumCheckout/EditProfile — мгновенный отклик на СВОЁ
 * действие, где `me` меняется, а id остаётся прежним) в поле `myId` писать
 * нечего. `stores/chatsStore.ts` (loadChats) тоже не в списке: там холодный старт
 * запрашивает `me` у воркера, а тот на любой успешный /me публикует `rt:me` —
 * зеркало `myId` наполняет тот же кадр через проектор.
 */
const ALLOWED_MYID = ['client/realtime/storeProjection.ts']

/**
 * НЕ про запись зеркала: `lib/rootScope.ts` — САМ ОБЪЯВЛЯЕТ поле и инициализирует
 * его в конструкторе (`this.myId = 0`, порт tweb `NULL_PEER_ID`). Без этого
 * исключения скан ловил бы объявление владельца поля, а не второго писателя.
 */
const NOT_APPLICABLE_MYID = ['lib/rootScope.ts']

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

  it('прямые записи `.myId = ...` есть только в allow-list', () => {
    const offenders = walk(SRC)
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED_MYID.includes(rel) && !NOT_APPLICABLE_MYID.includes(rel))
      .filter((rel) => /\.myId\s*=[^=]/.test(readFileSync(join(SRC, rel), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('allow-list `myId` не разбух молча: каждая запись реально пишет `.myId = ...`', () => {
    for (const rel of ALLOWED_MYID) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(src, `${rel}: ожидалась запись .myId = ...`).toMatch(/\.myId\s*=[^=]/)
    }
  })
})
