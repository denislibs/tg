// src/core/managers/storiesManager.ts
import type { RestClient } from '../net/restClient'
import type { UserReal } from '../peers/peer'

// Агрегат одной реакции истории (эмодзи + счётчик + поставил ли её текущий юзер).
export interface StoryReaction { emoji: string; count: number; mine: boolean }

// Приватность истории (4c): 'close' — только близкие друзья автора.
export type StoryPrivacy = 'everyone' | 'contacts' | 'close' | 'selected'

// 4d: media area — интерактивная область поверх истории (tweb StoryMediaArea).
// Координаты в процентах бокса медиа (0..100); rotation — градусы.
export interface MediaAreaCoords { x: number; y: number; w: number; h: number; rotation: number }
export type MediaAreaType = 'geo' | 'venue' | 'reaction' | 'url'
export interface MediaArea {
  type: MediaAreaType
  coordinates: MediaAreaCoords
  // geo/venue:
  lat?: number
  long?: number
  title?: string
  address?: string
  // reaction (suggested reaction sticker):
  reaction?: string
  dark?: boolean
  flipped?: boolean
  // url:
  url?: string
}

// 4d: атрибуция репоста (tweb fwd_from) — автор и id исходной истории.
export interface StoryFwd { authorId: number; storyId: number }

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
  // 4c: приватность, закреп в профиле, признак редактирования, срок жизни.
  privacy: StoryPrivacy
  pinned: boolean
  edited: boolean
  expiresAt: string
  // allowIds — явный allow-лист (для privacy==='selected'); бэк отдаёт его только
  // для СВОИХ историй, чтобы автор мог отредактировать аудиторию.
  allowIds?: number[]
  // 4d: интерактивные области поверх истории + атрибуция репоста.
  mediaAreas: MediaArea[]
  fwdFrom?: StoryFwd
}

// Текущее окно stealth-режима (tweb getStealthMode). null — режим не активен/нет кулдауна.
export interface StealthState { activeUntil: string | null; cooldownUntil: string | null }
// Автор группы историй — КОНСТРУКТОР `user` целиком: имя собирает клиент
// (`core/peers/getPeerTitle.ts`), аватарка это `photo.photo_id`. Прежняя тройка
// {id, displayName, avatarUrl} была плоским снимком пользователя рядом с
// настоящим — вторым источником тех же данных.
export interface StoryGroup { author: UserReal; stories: StoryItem[] }

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
  privacy?: StoryPrivacy
  pinned?: boolean
  edited?: boolean
  expires_at?: string
  allow_user_ids?: number[]
  media_areas?: MediaArea[]
  fwd_from?: { author_id: number; story_id: number }
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
    privacy: s.privacy ?? 'contacts',
    pinned: s.pinned ?? false,
    edited: s.edited ?? false,
    expiresAt: s.expires_at ?? '',
    allowIds: s.allow_user_ids,
    mediaAreas: s.media_areas ?? [],
    fwdFrom: s.fwd_from ? { authorId: s.fwd_from.author_id, storyId: s.fwd_from.story_id } : undefined,
  }
}

export function newStoriesManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'put' | 'patch' | 'del'> }) {
  return {
    async feed(): Promise<StoryGroup[]> {
      const r = await rest.get<{ groups: { author: UserReal; stories: RawStory[] }[] }>('/stories')
      return (r.groups ?? []).map((g) => ({ author: g.author, stories: g.stories.map(mapStory) }))
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
    // Репост чужой истории (4d, tweb fwd_from): создаёт свою историю со ссылкой на
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
    // Поделиться историей в чаты (4d, tweb share): в каждый чат уходит медиа-
    // сообщение с атрибуцией. Возвращает число успешно отправленных.
    async share(id: number, peerIds: number[]): Promise<number> {
      const r = await rest.post<{ sent: number }>(`/stories/${id}/share`, { peer_ids: peerIds })
      return r.sent ?? 0
    },
    async view(id: number): Promise<void> { await rest.post(`/stories/${id}/view`, {}) },
    // Close friends (4c): список id близких друзей + его полная замена.
    async closeFriends(): Promise<number[]> {
      const r = await rest.get<{ user_ids: number[] }>('/me/close_friends')
      return r.user_ids ?? []
    },
    async setCloseFriends(ids: number[]): Promise<void> { await rest.put('/me/close_friends', { user_ids: ids }) },
    // Stealth mode (4c): текущее окно + активация. Ошибки (409 cooldown / 503
    // недоступно) прокидываются наружу как HttpError — обрабатывает вызывающий.
    async stealthState(): Promise<StealthState> {
      const r = await rest.get<{ active_until: string | null; cooldown_until: string | null }>('/stories/stealth')
      return { activeUntil: r.active_until ?? null, cooldownUntil: r.cooldown_until ?? null }
    },
    async activateStealth(): Promise<StealthState> {
      const r = await rest.post<{ active_until: string | null; cooldown_until: string | null }>('/stories/stealth/activate', {})
      return { activeUntil: r.active_until ?? null, cooldownUntil: r.cooldown_until ?? null }
    },
    // Архив (4c): свои истёкшие истории, постранично (offsetId — id последнего).
    async archive(limit?: number, offsetId?: number): Promise<StoryItem[]> {
      const qs = new URLSearchParams()
      if (limit != null) qs.set('limit', String(limit))
      if (offsetId != null) qs.set('offset_id', String(offsetId))
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      const r = await rest.get<{ stories: RawStory[] }>(`/stories/archive${suffix}`)
      return (r.stories ?? []).map(mapStory)
    },
    // Закреп в профиле (4c): pin/unpin своей истории.
    async pin(id: number, pinned: boolean): Promise<void> { await rest.post(`/stories/${id}/pin`, { pinned }) },
    async pinnedStories(peer: number): Promise<StoryItem[]> {
      const r = await rest.get<{ stories: RawStory[] }>(`/stories/pinned?peer=${peer}`)
      return (r.stories ?? []).map(mapStory)
    },
    // Редактирование (4c): подпись/приватность (+allow-лист для selected).
    async editStory(id: number, patch: { caption?: string; privacy?: StoryPrivacy; allowIds?: number[]; mediaAreas?: MediaArea[] }): Promise<void> {
      const body: Record<string, unknown> = {}
      if (patch.caption != null) body.caption = patch.caption
      if (patch.privacy != null) body.privacy = patch.privacy
      if (patch.allowIds != null) body.allow_user_ids = patch.allowIds
      if (patch.mediaAreas != null) body.media_areas = patch.mediaAreas
      await rest.patch(`/stories/${id}`, body)
    },
    // Реакция на историю (4b): POST ставит/меняет, DELETE снимает.
    async setReaction(id: number, reaction: string): Promise<void> { await rest.post(`/stories/${id}/reaction`, { reaction }) },
    async removeReaction(id: number): Promise<void> { await rest.del(`/stories/${id}/reaction`) },
    async viewers(id: number): Promise<UserReal[]> {
      // Маппера нет: карточки приходят конструкторами и кладутся вербатим.
      const r = await rest.get<{ viewers: UserReal[] }>(`/stories/${id}/viewers`)
      return r.viewers ?? []
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
