// src/core/managers/storiesManager.ts
//
// Витрины историй отвечают КОНТЕЙНЕРАМИ схемы (`stories.allStories`,
// `stories.stories`, `stories.storyViewsList`), а сами истории — конструктором
// `storyItem`. Маппера здесь больше нет: форма провода и форма модели совпали,
// операции над историей живут в `core/stories/story.ts`.
//
// Разбор — docs/readiness/tl-stories-analysis.md.
import type { RestClient } from '../net/restClient'
import type { Chat, UserReal } from '../peers/peer'
import { getPeerId } from '../peers/peerId'
import type { MediaArea, StoryItem, StoryPrivacy } from '../stories/story'

export type { MediaArea, StoryItem, StoryPrivacy } from '../stories/story'

/** Текущее окно stealth-режима (`storiesStealthMode`). Границы — секунды эпохи;
 *  «окна нет» это ОТСУТСТВИЕ параметра, а не `null` под тем же ключом. */
export interface StealthState {
  _: 'storiesStealthMode'
  active_until_date?: number
  cooldown_until_date?: number
}

/**
 * Группа историй одного автора на витрине.
 *
 * На проводе это `peerStories` со ССЫЛКОЙ `peer`, а карточки авторов едут ОДИН
 * раз вектором `users` контейнера. Здесь ссылка уже разрешена — тем же приёмом,
 * каким строка списка чатов получает карточку пира: менеджер знает контейнер
 * целиком, а витрине нужен готовый автор.
 */
export interface StoryGroup { author: UserReal; stories: StoryItem[] }

// Период жизни истории в секундах (tweb story period). Дефолт — 24ч.
export type StoryPeriod = 21600 | 43200 | 86400 | 172800
export const DEFAULT_STORY_PERIOD: StoryPeriod = 86400

// StatPoint — точка временного ряда: сутки (YYYY-MM-DD) + значение.
export interface StoryStatPoint { date: string; value: number }
// StoryStats — статистика истории. ОБЪЯВЛЕННОЕ расхождение со схемой (Р12
// разбора): `stats.storyStats` состоит из двух `StatsGraph`, то есть из
// DataJSON для графической библиотеки, а у нас свой ряд по дням.
export interface StoryStats {
  views: number
  viewsByDay: StoryStatPoint[]
  reactionsTotal: number
  reactions: { emoji: string; count: number }[]
}

/** stories.allStories — контейнер ленты. */
interface AllStories {
  peer_stories?: { _: 'peerStories'; peer: Parameters<typeof getPeerId>[0]; stories: StoryItem[] }[]
  users?: UserReal[]
  chats?: Chat[]
  stealth_mode?: StealthState
}

/** stories.stories — плоский список (архив, закреплённые). */
interface Stories { stories?: StoryItem[]; users?: UserReal[]; chats?: Chat[] }

/** stories.storyViewsList — просмотры вместе с карточками зрителей. */
export interface StoryViewsList {
  count: number
  views: { _: 'storyView'; user_id: number; date: number; reaction?: { _: 'reactionEmoji'; emoticon: string } }[]
  users: UserReal[]
}

export function newStoriesManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'put' | 'patch' | 'del'> }) {
  return {
    // Ссылка `peer` разрешается по вектору `users` того же контейнера — если
    // карточки нет, группа отбрасывается: показывать историю без автора хуже,
    // чем не показывать её вовсе (то же правило, что у фильтра папок).
    async feed(): Promise<StoryGroup[]> {
      const r = await rest.get<AllStories>('/stories')
      const byId = new Map<number, UserReal>((r.users ?? []).map((u) => [u.id, u]))
      const out: StoryGroup[] = []
      for (const g of r.peer_stories ?? []) {
        const author = byId.get(Number(getPeerId(g.peer)))
        if (author) out.push({ author, stories: g.stories ?? [] })
      }
      return out
    },
    async post(args: { mediaId: number; caption?: string; privacy?: StoryPrivacy; allowIds?: number[]; period?: number; mediaAreas?: MediaArea[] }): Promise<number> {
      const r = await rest.post<{ id: number }>('/stories', {
        media_id: args.mediaId,
        caption: args.caption ?? '',
        privacy: args.privacy ?? 'contacts',
        allow_user_ids: args.allowIds ?? [],
        period: args.period ?? DEFAULT_STORY_PERIOD,
        media_areas: args.mediaAreas ?? [],
      })
      return r.id
    },
    // Репост чужой истории (tweb fwd_from): создаёт свою историю со ссылкой на
    // оригинал; media берётся с бэка от источника. Возвращает id новой истории.
    async repost(args: { sourceAuthorId: number; sourceStoryId: number; caption?: string; privacy?: StoryPrivacy; allowIds?: number[]; period?: number }): Promise<number> {
      const r = await rest.post<{ id: number }>('/stories/repost', {
        source_author_id: args.sourceAuthorId,
        source_story_id: args.sourceStoryId,
        caption: args.caption ?? '',
        privacy: args.privacy ?? 'contacts',
        allow_user_ids: args.allowIds ?? [],
        period: args.period ?? DEFAULT_STORY_PERIOD,
      })
      return r.id
    },
    // Поделиться историей в чаты: в каждый чат уходит медиа-сообщение с
    // атрибуцией. Возвращает число успешно отправленных.
    async share(id: number, peerIds: number[]): Promise<number> {
      const r = await rest.post<{ sent: number }>(`/stories/${id}/share`, { peer_ids: peerIds })
      return r.sent ?? 0
    },
    async view(id: number): Promise<void> { await rest.post(`/stories/${id}/view`, {}) },
    // Close friends: список id близких друзей + его полная замена.
    async closeFriends(): Promise<number[]> {
      const r = await rest.get<{ user_ids: number[] }>('/me/close_friends')
      return r.user_ids ?? []
    },
    async setCloseFriends(ids: number[]): Promise<void> { await rest.put('/me/close_friends', { user_ids: ids }) },
    // Stealth mode: текущее окно + активация. Ошибки (409 cooldown / 503
    // недоступно) прокидываются наружу как HttpError — обрабатывает вызывающий.
    async stealthState(): Promise<StealthState> {
      return await rest.get<StealthState>('/stories/stealth')
    },
    async activateStealth(): Promise<StealthState> {
      return await rest.post<StealthState>('/stories/stealth/activate', {})
    },
    // Архив: свои истёкшие истории, постранично (offsetId — id последнего).
    async archive(limit?: number, offsetId?: number): Promise<StoryItem[]> {
      const qs = new URLSearchParams()
      if (limit != null) qs.set('limit', String(limit))
      if (offsetId != null) qs.set('offset_id', String(offsetId))
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      const r = await rest.get<Stories>(`/stories/archive${suffix}`)
      return r.stories ?? []
    },
    // Закреп в профиле: pin/unpin своей истории.
    async pin(id: number, pinned: boolean): Promise<void> { await rest.post(`/stories/${id}/pin`, { pinned }) },
    async pinnedStories(peer: number): Promise<StoryItem[]> {
      const r = await rest.get<Stories>(`/stories/pinned?peer=${peer}`)
      return r.stories ?? []
    },
    // Редактирование: подпись/приватность (+allow-лист для selected).
    async editStory(id: number, patch: { caption?: string; privacy?: StoryPrivacy; allowIds?: number[]; mediaAreas?: MediaArea[] }): Promise<void> {
      const body: Record<string, unknown> = {}
      if (patch.caption != null) body.caption = patch.caption
      if (patch.privacy != null) body.privacy = patch.privacy
      if (patch.allowIds != null) body.allow_user_ids = patch.allowIds
      if (patch.mediaAreas != null) body.media_areas = patch.mediaAreas
      await rest.patch(`/stories/${id}`, body)
    },
    // Реакция на историю: POST ставит/меняет, DELETE снимает.
    async setReaction(id: number, reaction: string): Promise<void> { await rest.post(`/stories/${id}/reaction`, { reaction }) },
    async removeReaction(id: number): Promise<void> { await rest.del(`/stories/${id}/reaction`) },
    // Просмотры: контейнер `stories.storyViewsList` — сам просмотр (кто, когда,
    // чем отреагировал) и карточки зрителей РАЗНЫМИ векторами.
    async viewers(id: number): Promise<StoryViewsList> {
      const r = await rest.get<Partial<StoryViewsList>>(`/stories/${id}/viewers`)
      return { count: r.count ?? 0, views: r.views ?? [], users: r.users ?? [] }
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
