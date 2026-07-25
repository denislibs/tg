// src/core/managers/storiesManager.ts
import type { RestClient } from '../net/restClient'

// Агрегат одной реакции истории (эмодзи + счётчик + поставил ли её текущий юзер).
export interface StoryReaction { emoji: string; count: number; mine: boolean }
export interface StoryItem {
  id: number
  mediaId: number
  caption: string
  createdAt: string
  viewed: boolean
  // Реакции истории (4b): суммарный счётчик, моя реакция (эмодзи|null) и разбивка.
  reactionsCount: number
  myReaction: string | null
  reactions: StoryReaction[]
}
export interface StoryGroup { author: { id: number; displayName: string; avatarUrl: string }; stories: StoryItem[] }

// Период жизни истории в секундах (tweb story period). Дефолт — 24ч.
export type StoryPeriod = 21600 | 43200 | 86400 | 172800
export const DEFAULT_STORY_PERIOD: StoryPeriod = 86400

// StatPoint — точка временного ряда: сутки (YYYY-MM-DD) + значение.
export interface StoryStatPoint { date: string; value: number }
// StoryStats — статистика истории (аналог tweb stats.getStoryStats): всего
// просмотров + ряд просмотров по дням + суммарные реакции и их разбивка по эмодзи.
export interface StoryStats {
  views: number
  viewsByDay: StoryStatPoint[]
  reactionsTotal: number
  reactions: { emoji: string; count: number }[]
}

// Сырая история из ленты/событий (snake_case).
interface RawStory {
  id: number
  media_id: number
  caption: string
  created_at: string
  viewed: boolean
  reactions_count?: number
  my_reaction?: string | null
  reactions?: { emoji: string; count: number; mine: boolean }[]
}

export function mapStory(s: RawStory): StoryItem {
  return {
    id: s.id,
    mediaId: s.media_id,
    caption: s.caption,
    createdAt: s.created_at,
    viewed: s.viewed,
    reactionsCount: s.reactions_count ?? 0,
    myReaction: s.my_reaction ?? null,
    reactions: (s.reactions ?? []).map((r) => ({ emoji: r.emoji, count: r.count, mine: r.mine })),
  }
}

export function newStoriesManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'del'> }) {
  return {
    async feed(): Promise<StoryGroup[]> {
      const r = await rest.get<{ groups: { author: { id: number; display_name: string; avatar_url: string }; stories: RawStory[] }[] }>('/stories')
      return (r.groups ?? []).map((g) => ({
        author: { id: g.author.id, displayName: g.author.display_name, avatarUrl: g.author.avatar_url },
        stories: g.stories.map(mapStory),
      }))
    },
    async post(args: { mediaId: number; caption?: string; privacy?: 'everyone' | 'contacts' | 'selected'; allowIds?: number[]; period?: number }): Promise<number> {
      const r = await rest.post<{ id: number }>('/stories', {
        media_id: args.mediaId,
        caption: args.caption ?? '',
        privacy: args.privacy ?? 'contacts',
        allow_user_ids: args.allowIds ?? [],
        period: args.period ?? DEFAULT_STORY_PERIOD,
      })
      return r.id
    },
    async view(id: number): Promise<void> { await rest.post(`/stories/${id}/view`, {}) },
    // Реакция на историю (4b): POST ставит/меняет, DELETE снимает.
    async setReaction(id: number, reaction: string): Promise<void> { await rest.post(`/stories/${id}/reaction`, { reaction }) },
    async removeReaction(id: number): Promise<void> { await rest.del(`/stories/${id}/reaction`) },
    async viewers(id: number): Promise<{ id: number; displayName: string; avatarUrl: string }[]> {
      const r = await rest.get<{ viewers: { id: number; display_name: string; avatar_url: string }[] }>(`/stories/${id}/viewers`)
      return (r.viewers ?? []).map((v) => ({ id: v.id, displayName: v.display_name, avatarUrl: v.avatar_url }))
    },
    async stats(id: number): Promise<StoryStats> {
      const r = await rest.get<{ views: number; views_by_day: StoryStatPoint[]; reactions_total?: number; reactions?: { emoji: string; count: number }[] }>(`/stories/${id}/stats`)
      return {
        views: r.views,
        viewsByDay: r.views_by_day ?? [],
        reactionsTotal: r.reactions_total ?? 0,
        reactions: r.reactions ?? [],
      }
    },
    async del(id: number): Promise<void> { await rest.del(`/stories/${id}`) },
  }
}
export type StoriesManager = ReturnType<typeof newStoriesManager>
