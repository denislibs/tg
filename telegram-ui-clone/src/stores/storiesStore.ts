// src/stores/storiesStore.ts
import { create } from 'zustand'
import type { StoryGroup } from '../core/managers/storiesManager'

interface StoriesState {
  groups: StoryGroup[]
  loaded: boolean
  setGroups: (g: StoryGroup[]) => void
}

export const useStoriesStore = create<StoriesState>((set) => ({
  groups: [],
  loaded: false,
  setGroups: (groups) => set({ groups, loaded: true }),
}))

interface LoadDeps {
  stories: { feed(): Promise<StoryGroup[]> }
}

// Fetch the stories feed and populate the store.
export async function loadStories(managers: LoadDeps): Promise<void> {
  const groups = await managers.stories.feed()
  useStoriesStore.getState().setGroups(groups)
}
