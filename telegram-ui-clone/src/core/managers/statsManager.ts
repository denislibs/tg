import type { RestClient } from '../net/restClient'

// Статистика каналов/супергрупп (аналог tweb stats.getBroadcastStats). Все ряды
// сервер считает на лету из реальных данных (посты/просмотры/присоединения) —
// клиент только рисует. Доступ только у создателя/админа канала.

// StatPoint — точка временного ряда: сутки (YYYY-MM-DD) + значение.
export interface StatPoint {
  date: string
  value: number
}

// TopPost — пост в топе по просмотрам.
export interface TopPost {
  msgId: number
  seq: number
  text: string
  views: number
  date: string
}

// ChannelStatsSummary — числовой обзор (карточки Overview).
export interface ChannelStatsSummary {
  members: number
  totalViews: number
  postsCount: number
  avgReach: number
  notificationsOn: number
}

// ChannelStats — полная статистика канала.
export interface ChannelStats {
  summary: ChannelStatsSummary
  membersGrowth: StatPoint[]
  viewsByDay: StatPoint[]
  postsByDay: StatPoint[]
  topPosts: TopPost[]
}

interface RawSummary {
  members: number
  total_views: number
  posts_count: number
  avg_reach: number
  notifications_on: number
}
interface RawTopPost { msg_id: number; seq: number; text: string; views: number; date: string }
interface RawStats {
  summary: RawSummary
  members_growth: StatPoint[]
  views_by_day: StatPoint[]
  posts_by_day: StatPoint[]
  top_posts: RawTopPost[]
}

export function newStatsManager({ rest }: { rest: Pick<RestClient, 'get'> }) {
  return {
    async getChannelStats(chatId: number): Promise<ChannelStats> {
      const r = await rest.get<RawStats>(`/channels/${chatId}/stats`)
      return {
        summary: {
          members: r.summary.members,
          totalViews: r.summary.total_views,
          postsCount: r.summary.posts_count,
          avgReach: r.summary.avg_reach,
          notificationsOn: r.summary.notifications_on,
        },
        membersGrowth: r.members_growth ?? [],
        viewsByDay: r.views_by_day ?? [],
        postsByDay: r.posts_by_day ?? [],
        topPosts: (r.top_posts ?? []).map((p) => ({
          msgId: p.msg_id, seq: p.seq, text: p.text, views: p.views, date: p.date,
        })),
      }
    },
  }
}

export type StatsManager = ReturnType<typeof newStatsManager>
