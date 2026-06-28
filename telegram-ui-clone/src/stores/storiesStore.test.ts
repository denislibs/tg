// src/stores/storiesStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStoriesStore, loadStories } from './storiesStore'
import type { StoryGroup } from '../core/managers/storiesManager'

const groups: StoryGroup[] = [
  {
    author: { id: 7, displayName: 'Me', avatarUrl: '' },
    stories: [{ id: 1, mediaId: 11, caption: '', createdAt: 't0', viewed: false }],
  },
]

function fakeManagers(over: Partial<{ groups: StoryGroup[] }> = {}) {
  return {
    stories: { feed: async () => over.groups ?? groups },
  }
}

describe('storiesStore', () => {
  beforeEach(() => useStoriesStore.setState({ groups: [], loaded: false }))

  it('loadStories populates groups + marks loaded', async () => {
    await loadStories(fakeManagers() as never)
    const s = useStoriesStore.getState()
    expect(s.groups).toHaveLength(1)
    expect(s.groups[0].author.displayName).toBe('Me')
    expect(s.loaded).toBe(true)
  })

  it('setGroups replaces groups + marks loaded', () => {
    useStoriesStore.getState().setGroups(groups)
    const s = useStoriesStore.getState()
    expect(s.groups).toEqual(groups)
    expect(s.loaded).toBe(true)
  })
})
