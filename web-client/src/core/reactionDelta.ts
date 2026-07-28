// src/core/reactionDelta.ts
//
// Чистая дельта агрегата реакций сообщения (count±1 по emoji) — общая для
// главного стора (оптимистичный клик + эхо) и воркер-кэша (SSOT). Единственная
// реализация, чтобы стор и воркер не разошлись (иначе реакция из кэша ≠ реакция
// из стора). Идемпотентна для своих действий: серверное эхо собственного
// add/remove (mine=true) поверх уже применённого оптимистичного апдейта — no-op.
import type { ReactionCount } from './models'

// Возвращает новый список реакций, либо null — если применять нечего (эхо своего
// уже применённого действия), чтобы вызывающий не пересобирал сообщение зря.
export function reactionDelta(
  list: ReactionCount[] | undefined,
  emoji: string,
  action: 'add' | 'remove',
  mine: boolean,
): ReactionCount[] | undefined | null {
  const cur = list ? [...list] : []
  const i = cur.findIndex((r) => r.emoji === emoji)
  if (action === 'add') {
    if (i < 0) cur.push({ emoji, count: 1, mine })
    else {
      if (mine && cur[i].mine) return null // эхо своей уже применённой реакции
      cur[i] = { emoji, count: cur[i].count + 1, mine: cur[i].mine || mine }
    }
  } else {
    if (i < 0) return null
    if (mine && !cur[i].mine) return null // эхо своего уже применённого снятия
    const next = { emoji, count: cur[i].count - 1, mine: cur[i].mine && !mine }
    if (next.count <= 0) cur.splice(i, 1)
    else cur[i] = next
  }
  return cur.length ? cur : undefined
}
