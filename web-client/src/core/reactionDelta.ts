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
  /** карточка зрителя — своя реакция сразу попадает в recent (tweb добавляет
   * свой peer в recent_reactions оптимистично), иначе чип успевает мигнуть
   * числом и лишь потом, с серверным эхом, сменится на аватары */
  me?: { id: number; name: string; avatarUrl?: string },
): ReactionCount[] | undefined | null {
  const cur = list ? [...list] : []
  const i = cur.findIndex((r) => r.emoji === emoji)
  if (action === 'add') {
    const recent = mine && me ? [me] : undefined
    if (i < 0) cur.push({ emoji, count: 1, mine, recent })
    else {
      if (mine && cur[i].mine) return null // эхо своей уже применённой реакции
      cur[i] = {
        ...cur[i],
        count: cur[i].count + 1,
        mine: cur[i].mine || mine,
        recent: withMe(cur[i].recent, mine ? me : undefined),
      }
    }
  } else {
    if (i < 0) return null
    if (mine && !cur[i].mine) return null // эхо своего уже применённого снятия
    const next = {
      ...cur[i],
      count: cur[i].count - 1,
      mine: cur[i].mine && !mine,
      recent: mine && me ? cur[i].recent?.filter((p) => p.id !== me.id) : cur[i].recent,
    }
    if (next.count <= 0) cur.splice(i, 1)
    else cur[i] = next
  }
  return cur.length ? cur : undefined
}

// Свежие реагировавшие идут первыми (tweb recent_reactions), дублей нет.
function withMe(
  recent: ReactionCount['recent'],
  me?: { id: number; name: string; avatarUrl?: string },
): ReactionCount['recent'] {
  if (!me) return recent
  const rest = (recent ?? []).filter((p) => p.id !== me.id)
  return [me, ...rest].slice(0, 3)
}
