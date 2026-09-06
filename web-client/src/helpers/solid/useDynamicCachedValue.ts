/**
 * Порт tweb `src/helpers/solid/useDynamicCachedValue.ts` — 1:1 по логике.
 * ОДНО расхождение по имени, найденное ревью задачи 1: оригинал называет тип
 * записи кэша `T`, что в его файле затеняет generic-параметр `useDynamicCachedValue<T>`
 * (легальный, но вводящий в заблуждение приём — снаружи функции это один `T`,
 * внутри уже другой). Здесь он `CacheEntry<V>` — то же тело, имя без тени.
 *
 * Расшаривает ОДИН реактивный корень (со своими эффектами/таймерами) между
 * всеми потребителями с тем же `cacheKey`: если два места дерева одновременно
 * держат `useFullPeer(peerId)` на одного пира, они получают ОДИН экземпляр
 * `_useFullPeer` — один `setInterval`/`setTimeout` TTL, а не по одному на
 * каждого потребителя. Счётчик `count` — рефкаунт: корень живёт, пока жив хоть
 * один подписчик, и гасится (`dispose()`), когда снимается последний.
 *
 * Нужен `stores/fullPeers.solid.ts` (полная карточка — сетевой запрос + TTL);
 * `stores/peers.solid.ts` этим примитивом не пользуется — там чтение
 * синхронное и без побочных эффектов, делить нечего.
 */
import { createMemo, createRoot, Accessor, onCleanup } from 'solid-js'

type CacheEntry<V> = Partial<{
  count: number
  factory: () => V
  value: V
  dispose: () => void
}>

const cache = new Map<string, CacheEntry<any>>()

export default function useDynamicCachedValue<T>(cacheKey: Accessor<string>, factory: () => T): Accessor<T> {
  return createMemo(() => {
    const currentKey = cacheKey()
    let entry = cache.get(currentKey)

    if (!entry) {
      entry = { count: 0, factory }
      entry.value = createRoot((dispose) => {
        entry!.dispose = dispose
        return factory()
      })
      cache.set(currentKey, entry)
    }

    ++entry.count!

    onCleanup(() => {
      if (!--entry!.count!) {
        entry!.dispose!()
        cache.delete(currentKey)
      }
    })

    return entry.value
  })
}
