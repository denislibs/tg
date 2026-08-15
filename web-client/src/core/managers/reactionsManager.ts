// src/core/managers/reactionsManager.ts
// Каталог доступных реакций (Telegram messages.getAvailableReactions) — тонкая
// REST-обёртка над бэковым /reactions, тот же стиль, что stickersManager.ts:
// newXManager({rest}) + отдельный маппер snake_case → camelCase. Каталог
// публичный (одинаковый для всех пользователей), поэтому без параметров.
import type { RestClient } from '../net/restClient'

/**
 * Роли-медиа реакции соответствуют Center (или Static, если центра нет —
 * tweb reaction.ts:817) для статичного чипа и Select+Around для проигрывания
 * при выборе (эффект — отдельная будущая задача, здесь только данные).
 * Отсутствующая роль — undefined (бэк отдаёт 0/omitempty на роль без файла).
 */
export interface AvailableReaction {
  emoji: string
  title: string
  position: number
  premium: boolean
  inactive: boolean
  staticMediaId?: number
  appearMediaId?: number
  selectMediaId?: number
  activateMediaId?: number
  effectMediaId?: number
  aroundMediaId?: number
  centerMediaId?: number
}

interface RawAvailableReaction {
  emoji: string
  title: string
  position: number
  premium: boolean
  inactive: boolean
  static_media_id?: number
  appear_media_id?: number
  select_media_id?: number
  activate_media_id?: number
  effect_media_id?: number
  around_media_id?: number
  center_media_id?: number
}

const mapReaction = (r: RawAvailableReaction): AvailableReaction => ({
  emoji: r.emoji,
  title: r.title,
  position: r.position,
  premium: r.premium,
  inactive: r.inactive,
  staticMediaId: r.static_media_id || undefined,
  appearMediaId: r.appear_media_id || undefined,
  selectMediaId: r.select_media_id || undefined,
  activateMediaId: r.activate_media_id || undefined,
  effectMediaId: r.effect_media_id || undefined,
  aroundMediaId: r.around_media_id || undefined,
  centerMediaId: r.center_media_id || undefined,
})

export function newReactionsManager({ rest }: { rest: Pick<RestClient, 'get'> }) {
  return {
    async list(): Promise<AvailableReaction[]> {
      const r = await rest.get<{ reactions?: RawAvailableReaction[] }>('/reactions')
      return (r.reactions ?? []).map(mapReaction)
    },
  }
}
export type ReactionsManager = ReturnType<typeof newReactionsManager>
