/**
 * Порт tweb `src/helpers/solid/createMemoOrReturn.ts` — 1:1, без изменений.
 *
 * Полиморфизм входа `stores/peers.solid.ts`/`stores/fullPeers.solid.ts`:
 * `usePeer(peerId)` принимает либо голое значение (снимок на момент вызова —
 * поведение как у обычной функции), либо Accessor (реактивная зависимость —
 * поведение как у `createMemo`). Выбор ветки не портит типов вызывающего:
 * голый `PeerId` возвращает `R` напрямую, `Accessor<PeerId>` — `Accessor<R>`.
 */
import { Accessor, createMemo } from 'solid-js'

export type ValueOrGetter<T> = T | Accessor<T>

export default function createMemoOrReturn<
  T extends ValueOrGetter<any>,
  R,
  V = T extends Accessor<infer V> ? V : T,
>(
  valueOrGetter: T,
  callback: (value: V) => R,
): T extends Accessor<any> ? Accessor<R> : R {
  return typeof valueOrGetter === 'function' ?
    // @ts-ignore — та же форма, что у оригинала: TS не выводит условный тип обратно из ветки
    createMemo(() => callback((valueOrGetter as Accessor<T>)())) :
    // @ts-ignore
    callback(valueOrGetter)
}
