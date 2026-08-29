/**
 * Тест на `createHelper()` из `promiseCollector.solid.tsx`. Обычный `.test.ts`
 * (не `.solid.test.tsx`): проверяется чистая функция без JSX, Solid-рантайм
 * тут не нужен — тот же приём, что у `SolidIsland.tsx` (React-файл вызывает
 * `mountSolid` как обычную функцию, не становясь Solid-файлом).
 *
 * Пин на строку `collectPromise = () => {}` (`promiseCollector.solid.tsx`,
 * "lose reference to the promises array"). Без неё `collect`, вызванный ПОСЛЕ
 * `await()`, продолжает push'ить в тот же массив `promises`, и следующий
 * `await()` неожиданно ждёт промис, о котором вызывающий уже не знает.
 */
import { describe, expect, it } from 'vitest'
import { PromiseCollector } from './promiseCollector.solid'

describe('PromiseCollector.createHelper', () => {
  it('collect, вызванный ПОСЛЕ await(), не растит пул — следующий await() не ждёт его', async () => {
    const helper = PromiseCollector.createHelper()

    let resolveEarly!: () => void
    helper.onCollect(
      new Promise<void>((r) => {
        resolveEarly = r
      }),
    )
    resolveEarly()
    await helper.await()

    // Поздний collect — тот случай, который `let collectPromise` гасит:
    // содержимое вкладки может звать `usePromiseCollector().collect(...)` и
    // после открытия (например, в реактивном эффекте), и этот промис уже
    // никто не должен ждать.
    let lateSettled = false
    helper.onCollect(
      new Promise<void>((r) => {
        // Намеренно НЕ резолвим — если бы поздний промис всё ещё попадал в
        // пул, второй `await()` ниже завис бы на нём и тест словил бы это по
        // таймауту, а не по значению.
        void r
      }),
    )

    const second = helper.await().then(() => {
      lateSettled = true
    })
    void second

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(lateSettled).toBe(true)
  })
})
