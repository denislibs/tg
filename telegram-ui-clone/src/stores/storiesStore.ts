// src/stores/storiesStore.ts
import { create } from 'zustand'
import type { StoryGroup, StoryItem } from '../core/managers/storiesManager'

interface StoriesState {
  groups: StoryGroup[]
  loaded: boolean
  setGroups: (g: StoryGroup[]) => void
  markViewed: (authorId: number, storyId: number) => void
  // realtime (story_new): добавить историю в группу автора. No-op, если группы
  // автора нет (её подтянет полный рефетч ленты) или история уже есть.
  addStory: (authorId: number, story: StoryItem) => void
  // realtime (story_deleted): убрать историю; пустая группа удаляется.
  removeStory: (authorId: number, storyId: number) => void
  // realtime (story_reaction): выставить суммарный счётчик; myReaction меняем
  // только когда событие про текущего юзера (передан аргумент).
  applyStoryReaction: (storyId: number, reactionsCount: number, myReaction?: string | null) => void
  // оптимистично: поставить/сменить/снять свою реакцию (до подтверждения по WS).
  setMyReaction: (storyId: number, reaction: string | null) => void
}

// Заменить историю по id внутри groups (иммутабельно).
function patchStory(groups: StoryGroup[], storyId: number, fn: (s: StoryItem) => StoryItem): StoryGroup[] {
  return groups.map((g) =>
    g.stories.some((s) => s.id === storyId)
      ? { ...g, stories: g.stories.map((s) => (s.id === storyId ? fn(s) : s)) }
      : g,
  )
}

export const useStoriesStore = create<StoriesState>((set) => ({
  groups: [],
  loaded: false,
  setGroups: (groups) => set({ groups, loaded: true }),
  markViewed: (authorId, storyId) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.author.id === authorId
          ? { ...g, stories: g.stories.map((s) => (s.id === storyId ? { ...s, viewed: true } : s)) }
          : g,
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
        reactionsCount,
        myReaction: myReaction === undefined ? s.myReaction : myReaction,
      })),
    })),
  setMyReaction: (storyId, reaction) =>
    set((state) => ({
      groups: patchStory(state.groups, storyId, (s) => {
        const prev = s.myReaction
        if (prev === reaction) return s
        // Разбивка реакций: снять свой голос с prev, добавить к new.
        let reactions = s.reactions.map((r) => ({ ...r }))
        if (prev) {
          reactions = reactions
            .map((r) => (r.emoji === prev ? { ...r, count: r.count - 1, mine: false } : r))
            .filter((r) => r.count > 0)
        }
        if (reaction) {
          const hit = reactions.find((r) => r.emoji === reaction)
          if (hit) { hit.count += 1; hit.mine = true }
          else reactions.push({ emoji: reaction, count: 1, mine: true })
        }
        const delta = (reaction ? 1 : 0) - (prev ? 1 : 0)
        return { ...s, myReaction: reaction, reactionsCount: Math.max(0, s.reactionsCount + delta), reactions }
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
