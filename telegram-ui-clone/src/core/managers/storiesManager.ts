// src/core/managers/storiesManager.ts
import type { RestClient } from '../net/restClient'

export interface StoryItem { id: number; mediaId: number; caption: string; createdAt: string; viewed: boolean }
export interface StoryGroup { author: { id: number; displayName: string; avatarUrl: string }; stories: StoryItem[] }

// StatPoint — точка временного ряда: сутки (YYYY-MM-DD) + значение.
export interface StoryStatPoint { date: string; value: number }
// StoryStats — статистика истории (аналог tweb stats.getStoryStats): всего
// просмотров + ряд просмотров по дням. Реакций/пересылок у историй нет.
export interface StoryStats { views: number; viewsByDay: StoryStatPoint[] }

export function newStoriesManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'del'> }) {
  return {
    async feed(): Promise<StoryGroup[]> {
      const r = await rest.get<{ groups: { author: { id: number; display_name: string; avatar_url: string }; stories: { id: number; media_id: number; caption: string; created_at: string; viewed: boolean }[] }[] }>('/stories')
      return (r.groups ?? []).map((g) => ({
        author: { id: g.author.id, displayName: g.author.display_name, avatarUrl: g.author.avatar_url },
        stories: g.stories.map((s) => ({ id: s.id, mediaId: s.media_id, caption: s.caption, createdAt: s.created_at, viewed: s.viewed })),
      }))
    },
    async post(args: { mediaId: number; caption?: string; privacy?: 'everyone' | 'contacts' | 'selected'; allowIds?: number[] }): Promise<number> {
      const r = await rest.post<{ id: number }>('/stories', {
        media_id: args.mediaId,
        caption: args.caption ?? '',
        privacy: args.privacy ?? 'contacts',
        allow_user_ids: args.allowIds ?? [],
      })
      return r.id
    },
    async view(id: number): Promise<void> { await rest.post(`/stories/${id}/view`, {}) },
    async viewers(id: number): Promise<{ id: number; displayName: string; avatarUrl: string }[]> {
      const r = await rest.get<{ viewers: { id: number; display_name: string; avatar_url: string }[] }>(`/stories/${id}/viewers`)
      return (r.viewers ?? []).map((v) => ({ id: v.id, displayName: v.display_name, avatarUrl: v.avatar_url }))
    },
    async stats(id: number): Promise<StoryStats> {
      const r = await rest.get<{ views: number; views_by_day: StoryStatPoint[] }>(`/stories/${id}/stats`)
      return { views: r.views, viewsByDay: r.views_by_day ?? [] }
    },
    async del(id: number): Promise<void> { await rest.del(`/stories/${id}`) },
  }
}
export type StoriesManager = ReturnType<typeof newStoriesManager>
