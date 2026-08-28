// src/stores/storiesStore.ts
//
// Зеркало ленты историй. Истории лежат КОНСТРУКТОРАМИ схемы (`storyItem`),
// поэтому мутаторы правят их параметры, а не поля своей плоской записи:
// «моя реакция» — `sent_reaction` истории, общий агрегат — `views`, закреп и
// правка — флаги `pFlags`. Операции чтения — `core/stories/story.ts`.
import { create } from 'zustand'
import type { StoryGroup } from '../core/managers/storiesManager'
import type { StoryItem, StoryItemReal, StoryPrivacy } from '../core/stories/story'
import { realStory, storyMyReaction } from '../core/stories/story'
import type { ReactionCount } from '../core/models'
import { reactionKey } from '../core/reactions/messageReactions'

interface StoriesState {
  groups: StoryGroup[]
  loaded: boolean
  setGroups: (g: StoryGroup[]) => void
  // Подвинуть ГОРИЗОНТ прочтения у автора (только вперёд): признака на самой
  // истории больше нет.
  markRead: (authorId: number, maxReadId: number) => void
  // realtime (story_new): добавить историю в группу автора. No-op, если группы
  // автора нет (её подтянет полный рефетч ленты) или история уже есть.
  addStory: (authorId: number, story: StoryItem) => void
  // realtime (story_deleted): убрать историю; пустая группа удаляется.
  removeStory: (authorId: number, storyId: number) => void
  // realtime (story_reaction): выставить суммарный счётчик; своя реакция
  // меняется только когда событие про текущего юзера (передан аргумент).
  applyStoryReaction: (storyId: number, reactionsCount: number, myReaction?: string | null) => void
  // оптимистично: поставить/сменить/снять свою реакцию (до подтверждения по WS).
  setMyReaction: (storyId: number, reaction: string | null) => void
  // закреп истории в профиле (pin/unpin) — отражаем в модели ленты.
  setStoryPinned: (storyId: number, pinned: boolean) => void
  // применить результат редактирования (подпись/приватность/allow-лист) + флаг edited.
  applyStoryEdit: (storyId: number, patch: { caption?: string; privacy?: StoryPrivacy; allowIds?: number[] }) => void
}

// Заменить историю по id внутри groups (иммутабельно). Удалённая история
// (`storyItemDeleted`) правкам не подлежит — у неё нет ни одного из параметров.
function patchStory(groups: StoryGroup[], storyId: number, fn: (s: StoryItemReal) => StoryItem): StoryGroup[] {
  return groups.map((g) =>
    g.stories.some((s) => s.id === storyId)
      ? { ...g, stories: g.stories.map((s) => (s.id === storyId && realStory(s) ? fn(s as StoryItemReal) : s)) }
      : g,
  )
}

/** Флаги истории с одним переключённым; выключенный флаг СНИМАЕТСЯ, а не
 *  становится `false` — «выключено» это отсутствие ключа. */
function withFlag(s: StoryItemReal, name: 'pinned' | 'edited', on: boolean): StoryItemReal['pFlags'] {
  const next = { ...s.pFlags }
  if (on) next[name] = true
  else delete next[name]
  return Object.keys(next).length ? next : undefined
}

/** Аудитория вектором правил — та же форма, что приезжает с провода. */
function privacyRules(privacy: StoryPrivacy, allowIds: number[]): StoryItemReal['privacy'] {
  switch (privacy) {
    case 'everyone': return [{ _: 'privacyValueAllowAll' }]
    case 'contacts': return [{ _: 'privacyValueAllowContacts' }]
    case 'close': return [{ _: 'privacyValueAllowCloseFriends' }]
    case 'selected': return [{ _: 'privacyValueAllowUsers', users: allowIds }]
  }
}

/** Флаг аудитории истории (`public`/`contacts`/`close_friends`/`selected_contacts`). */
function privacyFlags(s: StoryItemReal, privacy: StoryPrivacy): StoryItemReal['pFlags'] {
  const next = { ...s.pFlags }
  delete next.public
  delete next.contacts
  delete next.close_friends
  delete next.selected_contacts
  if (privacy === 'everyone') next.public = true
  if (privacy === 'contacts') next.contacts = true
  if (privacy === 'close') next.close_friends = true
  if (privacy === 'selected') next.selected_contacts = true
  return next
}

export const useStoriesStore = create<StoriesState>((set) => ({
  groups: [],
  loaded: false,
  setGroups: (groups) => set({ groups, loaded: true }),
  markRead: (authorId, maxReadId) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.author.id === authorId && maxReadId > g.maxReadId ? { ...g, maxReadId } : g,
      ),
    })),
  addStory: (authorId, story) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.author.id === authorId && !g.stories.some((s) => s.id === story.id)
          ? { ...g, stories: [...g.stories, story] }
          : g,
      ),
    })),
  removeStory: (authorId, storyId) =>
    set((state) => ({
      groups: state.groups
        .map((g) => (g.author.id === authorId ? { ...g, stories: g.stories.filter((s) => s.id !== storyId) } : g))
        .filter((g) => g.stories.length > 0),
    })),
  applyStoryReaction: (storyId, reactionsCount, myReaction) =>
    set((state) => ({
      groups: patchStory(state.groups, storyId, (s) => ({
        ...s,
        views: { _: 'storyViews', views_count: s.views?.views_count ?? 0, reactions: s.views?.reactions, reactions_count: reactionsCount },
        sent_reaction: myReaction === undefined
          ? s.sent_reaction
          : (myReaction ? { _: 'reactionEmoji', emoticon: myReaction } : undefined),
      })),
    })),
  setMyReaction: (storyId, reaction) =>
    set((state) => ({
      groups: patchStory(state.groups, storyId, (s) => {
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
  setStoryPinned: (storyId, pinned) =>
    set((state) => ({ groups: patchStory(state.groups, storyId, (s) => ({ ...s, pFlags: withFlag(s, 'pinned', pinned) })) })),
  applyStoryEdit: (storyId, patch) =>
    set((state) => ({
      groups: patchStory(state.groups, storyId, (s) => {
        const next: StoryItemReal = { ...s, caption: patch.caption ?? s.caption }
        next.pFlags = withFlag(next, 'edited', true)
        if (patch.privacy) {
          next.pFlags = privacyFlags(next, patch.privacy)
          next.pFlags = withFlag(next, 'edited', true)
          next.privacy = privacyRules(patch.privacy, patch.allowIds ?? [])
        } else if (patch.allowIds) {
          next.privacy = [{ _: 'privacyValueAllowUsers', users: patch.allowIds }]
        }
        return next
      }),
    })),
}))

interface LoadDeps {
  stories: { feed(): Promise<StoryGroup[]> }
}

// Fetch the stories feed and populate the store.
export async function loadStories(managers: LoadDeps): Promise<void> {
  const groups = await managers.stories.feed()
  useStoriesStore.getState().setGroups(groups)
}
