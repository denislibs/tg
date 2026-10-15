// src/stores/storiesStore.ts
//
// Зеркало ленты историй. Истории лежат КОНСТРУКТОРАМИ схемы (`storyItem`),
// поэтому мутаторы правят их параметры, а не поля своей плоской записи:
// «моя реакция» — `sent_reaction` истории, общий агрегат — `views`, закреп и
// правка — флаги `pFlags`. Операции чтения — `core/stories/story.ts`.
//
// Порядок групп — порядок ряда историй и карусели вьювера, как у tweb: позиция
// пира `generateSortIndexForCache` (`appStoriesManager.ts:197-221`) и заморозка
// сортировки, пока на ряд или вьювер смотрят (`stories/store.tsx:227`, `:495-510`).
// Расхождения:
//  1. Позиции считает не воркерный менеджер (`stories_position`), а сам стор:
//     витрина `/stories` приезжает целиком, и порядок выводится из неё здесь же.
//  2. Под заморозкой новые группы ДОПИСЫВАЮТСЯ в конец (у tweb `addPeers`
//     вставляет по позиции всегда, откладывая только смену позиции уже
//     показанных) — вьювер держит группу индексом в `groups`, и вставка в
//     середину увела бы его на чужого автора. Разморозка пересортирует всё.
//  3. Ветки «changelog» (`isChangelog`) в ключе нет — служебного пира историй
//     Telegram у нас нет.
import { create } from 'zustand'
import type { StoryGroup } from '../core/managers/storiesManager'
import type { StoryItem, StoryItemReal } from '../core/stories/story'
import { realStory, storyDate, storyMyReaction } from '../core/stories/story'
import type { ReactionCount } from '../core/models'
import { reactionKey } from '../core/reactions/messageReactions'
import rootScope from '@lib/rootScope'
import tsNow from '../helpers/tsNow'

/** tweb `StoriesSegment['type']` (`appStoriesManager.ts:76-79`). */
export type StoriesSegmentType = 'unread' | 'close' | 'read'
export type StoriesSegments = { type: StoriesSegmentType, length: number }[]
/** tweb `StoriesSortingFreezeType` (`stories/store.tsx:36`). */
export type StoriesSortingFreezeType = 'list' | 'viewer'

/** tweb `getUnreadType` (`appStoriesManager.ts:667-679`): по умолчанию — последняя история. */
export function getStoriesUnreadType(group: Pick<StoryGroup, 'stories' | 'maxReadId'>, story: StoryItem | undefined = group.stories[group.stories.length - 1]): StoriesSegmentType | undefined {
  if(!story) return undefined
  return story.id > group.maxReadId ? (realStory(story)?.pFlags?.close_friends ? 'close' : 'unread') : 'read'
}

/** tweb `getPeerStoriesSegments` (`appStoriesManager.ts:681-708`): подряд идущие истории одного типа — один сегмент. */
export function getStoriesSegments(group: Pick<StoryGroup, 'stories' | 'maxReadId'>): StoriesSegments | undefined {
  if(!group.stories.length) return undefined
  const segments: StoriesSegments = []
  let lastSegment: StoriesSegments[0] | undefined
  for(const story of group.stories) {
    const type = getStoriesUnreadType(group, story)!
    if(lastSegment?.type !== type) segments.push(lastSegment = { length: 1, type })
    else ++lastSegment.length
  }
  return segments
}

/**
 * tweb `generateSortIndexForCache` (`appStoriesManager.ts:197-221`): число из
 * цифр `isMe`, `isUnread`, `isPremium` и даты последней истории — свои первыми,
 * затем непрочитанные, премиум, свежие (расхождение 3).
 */
export function getStoriesSortIndex(group: StoryGroup, myId: number = rootScope.myId): number | undefined {
  const lastStory = group.stories[group.stories.length - 1]
  if(!lastStory) return undefined
  const isMe = group.author.id === myId
  const isUnread = getStoriesUnreadType(group) !== 'read'
  const isPremium = !!group.author.pFlags?.premium
  return +([isMe, isUnread, isPremium].map((b) => +b).join('') + storyDate(lastStory))
}

/** По убыванию позиции (tweb `insertInDescendSortedArray`, `store.tsx:653-659`); стабильно. */
export function sortStoryGroups(groups: StoryGroup[]): StoryGroup[] {
  return groups
    .map((group, idx) => ({ group, idx, index: getStoriesSortIndex(group) ?? 0 }))
    .sort((a, b) => b.index - a.index || a.idx - b.idx)
    .map(({ group }) => group)
}

// tweb `freezedSorting` (`store.tsx:227`)
const freezedSorting = new Set<StoriesSortingFreezeType>()

/** Расхождение 2: под заморозкой — прежний порядок, новые группы в конец. */
function arrange(prev: StoryGroup[], next: StoryGroup[]): StoryGroup[] {
  if(!freezedSorting.size) return sortStoryGroups(next)
  const byAuthor = new Map(next.map((g) => [g.author.id, g]))
  const out: StoryGroup[] = []
  for(const g of prev) {
    const n = byAuthor.get(g.author.id)
    if(!n) continue
    out.push(n)
    byAuthor.delete(g.author.id)
  }
  return out.concat(sortStoryGroups([...byAuthor.values()]))
}

interface StoriesState {
  groups: StoryGroup[]
  loaded: boolean
  setGroups: (g: StoryGroup[]) => void
  /** tweb `toggleSorting` (`store.tsx:495-510`): снятие последней заморозки пересортирует. */
  toggleSorting: (type: StoriesSortingFreezeType, freeze: boolean) => void
  // Подвинуть ГОРИЗОНТ прочтения у автора (только вперёд): признака на самой
  // истории больше нет.
  markRead: (authorId: number, maxReadId: number) => void
  // realtime `updateStory` (tweb `onUpdateStory`, appStoriesManager.ts:1710-1721):
  // история приезжает целиком и ЗАМЕНЯЕТ прежнюю с тем же номером у автора;
  // нового номера нет — дописывается. No-op, если группы автора нет (её подтянет
  // полный рефетч ленты).
  addStory: (authorId: number, story: StoryItem) => void
  // realtime (story_deleted): убрать историю; пустая группа удаляется.
  removeStory: (authorId: number, storyId: number) => void
  // оптимистично: поставить/сменить/снять свою реакцию (до подтверждения по WS).
  // История — пара (автор, номер): номера у разных авторов совпадают.
  setMyReaction: (authorId: number, storyId: number, reaction: string | null) => void
  // закреп истории в профиле (pin/unpin) — отражаем в модели ленты.
  setStoryPinned: (authorId: number, storyId: number, pinned: boolean) => void
}

// Заменить историю (автор, номер) внутри groups (иммутабельно). Номер истории —
// порядковый внутри автора, поэтому без автора правка задела бы одноимённую
// историю другого автора. Удалённая история (`storyItemDeleted`) правкам не
// подлежит — у неё нет ни одного из параметров.
function patchStory(groups: StoryGroup[], authorId: number, storyId: number, fn: (s: StoryItemReal) => StoryItem): StoryGroup[] {
  return groups.map((g) =>
    g.author.id === authorId && g.stories.some((s) => s.id === storyId)
      ? { ...g, stories: g.stories.map((s) => (s.id === storyId && realStory(s) ? fn(s as StoryItemReal) : s)) }
      : g,
  )
}

/** tweb `isStoryExpired`: срок вышел (`expire_date` в секундах эпохи); у удалённой срока нет. */
export function storyExpired(story: StoryItem): boolean {
  const real = realStory(story)
  return !!real && real.expire_date <= tsNow(true)
}

/** Флаги истории с одним переключённым; выключенный флаг СНИМАЕТСЯ, а не
 *  становится `false` — «выключено» это отсутствие ключа. */
function withFlag(s: StoryItemReal, name: 'pinned' | 'edited', on: boolean): StoryItemReal['pFlags'] {
  const next = { ...s.pFlags }
  if (on) next[name] = true
  else delete next[name]
  return Object.keys(next).length ? next : undefined
}

export const useStoriesStore = create<StoriesState>((set) => ({
  groups: [],
  loaded: false,
  setGroups: (groups) => set((state) => ({ groups: arrange(state.groups, groups), loaded: true })),
  toggleSorting: (type, freeze) => {
    if(freeze) {
      freezedSorting.add(type)
      return
    }
    freezedSorting.delete(type)
    if(!freezedSorting.size) set((state) => ({ groups: sortStoryGroups(state.groups) }))
  },
  markRead: (authorId, maxReadId) =>
    set((state) => ({
      groups: arrange(state.groups, state.groups.map((g) =>
        g.author.id === authorId && maxReadId > g.maxReadId ? { ...g, maxReadId } : g,
      )),
    })),
  addStory: (authorId, story) =>
    set((state) => ({
      groups: arrange(state.groups, state.groups.map((g) => {
        if (g.author.id !== authorId) return g
        const prev = g.stories.find((s) => s.id === story.id)
        // Замена целиком, как у tweb: личное (`sent_reaction`, `chosen_order`)
        // сервер кладёт в тело под каждого получателя.
        if (prev) return { ...g, stories: g.stories.map((s) => (s.id === story.id ? story : s)) }
        // Истёкшая история в активную ленту не входит (tweb `isStoryExpired`,
        // appStoriesManager.ts:1740): её присылают закреплённой.
        if (storyExpired(story)) return g
        // Новая — на своё место по номеру: кадры двух быстрых историй могут прийти
        // вразнобой, а последняя в группе задаёт кольцо и позицию группы.
        const at = g.stories.findIndex((s) => s.id > story.id)
        return { ...g, stories: at < 0 ? [...g.stories, story] : [...g.stories.slice(0, at), story, ...g.stories.slice(at)] }
      })),
    })),
  removeStory: (authorId, storyId) =>
    set((state) => ({
      groups: state.groups
        .map((g) => (g.author.id === authorId ? { ...g, stories: g.stories.filter((s) => s.id !== storyId) } : g))
        .filter((g) => g.stories.length > 0),
    })),
  setMyReaction: (authorId, storyId, reaction) =>
    set((state) => ({
      groups: patchStory(state.groups, authorId, storyId, (s) => {
        const prev = storyMyReaction(s)
        if (prev === reaction) return s
        // Разбивка реакций: снять свой голос с prev, добавить к new. «Моя» это
        // `chosen_order`, а не булево поле, поэтому снятие — УДАЛЕНИЕ ключа.
        let results: ReactionCount[] = (s.views?.reactions ?? []).map((r) => ({ ...r }))
        if (prev) {
          results = results
            .map((r) => (reactionKey(r.reaction) === prev ? { ...r, count: r.count - 1, chosen_order: undefined } : r))
            .filter((r) => r.count > 0)
            .map(({ chosen_order, ...rest }) => (chosen_order === undefined ? rest : { ...rest, chosen_order }))
        }
        if (reaction) {
          const hit = results.find((r) => reactionKey(r.reaction) === reaction)
          if (hit) { hit.count += 1; hit.chosen_order = 0 }
          else results.push({ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: reaction }, count: 1, chosen_order: 0 })
        }
        const delta = (reaction ? 1 : 0) - (prev ? 1 : 0)
        return {
          ...s,
          views: {
            _: 'storyViews',
            views_count: s.views?.views_count ?? 0,
            reactions: results,
            reactions_count: Math.max(0, (s.views?.reactions_count ?? 0) + delta),
          },
          sent_reaction: reaction ? { _: 'reactionEmoji', emoticon: reaction } : undefined,
        }
      }),
    })),
  setStoryPinned: (authorId, storyId, pinned) =>
    set((state) => ({ groups: patchStory(state.groups, authorId, storyId, (s) => ({ ...s, pFlags: withFlag(s, 'pinned', pinned) })) })),
}))

interface LoadDeps {
  stories: { feed(): Promise<StoryGroup[]> }
}

// Fetch the stories feed and populate the store.
// Номера чтений: ответ старше УЖЕ ПРИМЕНЁННОГО отбрасывается, иначе медленный
// ранний GET /stories затёр бы снимок поновее. Упавший новый запрос ничего не
// отбрасывает: успешный старый всё равно применяется.
let loadSeq = 0
let appliedSeq = 0

export async function loadStories(managers: LoadDeps): Promise<void> {
  const mine = ++loadSeq
  const groups = await managers.stories.feed()
  if (mine < appliedSeq) return
  appliedSeq = mine
  useStoriesStore.getState().setGroups(groups)
}
