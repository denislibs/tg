import type { StatsBroadcastStats, StatsMegagroupStats, StatsMessageStats } from '@layer'
import type { RestClient } from '../net/restClient'

/**
 * Порт tweb `lib/appManagers/appStatisticsManager.ts` (812502980) — статистика
 * канала, группы и поста для вкладки `AppStatisticsTab`
 * (`components/sidebarRight/tabs/statistics.solid.tsx`). Ответы — уже
 * конструкторы схемы (`stats.broadcastStats`/`stats.megagroupStats`/
 * `stats.messageStats`), их собирает бэкенд (`domain/mtstats.go`).
 *
 * Расхождения с оригиналом:
 *  1. Нет `dcId` в ответе и `getInvokeOptions` (`:19-36`): дата-центр один,
 *     `stats_dc` не производится (`domain/mtchat.go`, шапка `channelFull`).
 *  2. Нет `loadAsyncGraph` (`:74-83`): бэкенд считает все ряды сразу и
 *     `statsGraphAsync`/`zoom_token` не отдаёт.
 *  3. Нет `getMessagePublicForwards`/`getStoryPublicForwards`/`getStoryStats`/
 *     `getPollStats` (`:105-127`, `:152-212`): публичных пересылок, статистики
 *     историй (для этой вкладки) и опросов у бэкенда нет — Б-121, Б-122.
 *  4. Параметр `dark` не передаётся: цвета графиков клиент берёт из темы
 *     (`statistics.solid.tsx::makeColors`), бэкенд палитру не выбирает.
 *  5. `recent_posts_interactions[].msg_id` — уже клиентский номер поста
 *     (`seq`), `generateMessageId` (`:59-63`) не нужен.
 */
export type GetStatsParams = {
  peerId: PeerId,
  mid?: number
}

export function newStatsManager({ rest }: { rest: Pick<RestClient, 'get'> }) {
  return {
    /** tweb `:50-72` — `stats.getBroadcastStats`. */
    async getBroadcastStats({ peerId }: GetStatsParams): Promise<{ stats: StatsBroadcastStats }> {
      const stats = await rest.get<StatsBroadcastStats>(`/channels/${peerId}/stats`)
      return { stats }
    },

    /** tweb `:85-103` — `stats.getMegagroupStats`: та же ручка, группа отвечает своим конструктором. */
    async getMegagroupStats({ peerId }: GetStatsParams): Promise<{ stats: StatsMegagroupStats }> {
      const stats = await rest.get<StatsMegagroupStats>(`/channels/${peerId}/stats`)
      return { stats }
    },

    /** tweb `:129-150` — `stats.getMessageStats`. */
    async getMessageStats({ peerId, mid }: GetStatsParams): Promise<{ stats: StatsMessageStats }> {
      const stats = await rest.get<StatsMessageStats>(`/chats/${peerId}/messages/${mid}/stats`)
      return { stats }
    },
  }
}

export type StatsManager = ReturnType<typeof newStatsManager>
