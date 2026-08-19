// src/stores/storiesStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStoriesStore, loadStories } from './storiesStore'
import type { StoryGroup, StoryItem } from '../core/managers/storiesManager'

const mkStory = (over: Partial<StoryItem> = {}): StoryItem => ({
  id: 1, mediaId: 11, caption: '', createdAt: 't0', viewed: false,
  reactionsCount: 0, myReaction: null, reactions: [],
  privacy: 'contacts', pinned: false, edited: false, expiresAt: 't1', mediaAreas: [], ...over,
})

const groups: StoryGroup[] = [
  { author: { _: 'user' as const, id: 7, first_name: 'Me' }, stories: [mkStory()] },
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
    expect(s.groups[0].author.first_name).toBe('Me')
    expect(s.loaded).toBe(true)
  })

  it('setGroups replaces groups + marks loaded', () => {
    useStoriesStore.getState().setGroups(groups)
    const s = useStoriesStore.getState()
    expect(s.groups).toEqual(groups)
    expect(s.loaded).toBe(true)
  })

  it('addStory appends to the author group, skipping duplicates and unknown authors', () => {
    useStoriesStore.getState().setGroups([{ author: { _: 'user' as const, id: 2, first_name: 'Bob' }, stories: [mkStory({ id: 1 })] }])
    useStoriesStore.getState().addStory(2, mkStory({ id: 2 }))
    expect(useStoriesStore.getState().groups[0].stories.map((s) => s.id)).toEqual([1, 2])
    // duplicate id → no-op
    useStoriesStore.getState().addStory(2, mkStory({ id: 2 }))
    expect(useStoriesStore.getState().groups[0].stories).toHaveLength(2)
    // unknown author → no-op (full feed reload handles it)
    useStoriesStore.getState().addStory(999, mkStory({ id: 3 }))
    expect(useStoriesStore.getState().groups).toHaveLength(1)
  })

  it('removeStory drops the story and empties out the group', () => {
    useStoriesStore.getState().setGroups([{ author: { _: 'user' as const, id: 2, first_name: 'Bob' }, stories: [mkStory({ id: 1 }), mkStory({ id: 2 })] }])
    useStoriesStore.getState().removeStory(2, 1)
    expect(useStoriesStore.getState().groups[0].stories.map((s) => s.id)).toEqual([2])
    useStoriesStore.getState().removeStory(2, 2)
    expect(useStoriesStore.getState().groups).toHaveLength(0) // empty group removed
  })

  it('applyStoryReaction sets count; myReaction only when provided', () => {
    useStoriesStore.getState().setGroups([{ author: { _: 'user' as const, id: 2, first_name: 'Bob' }, stories: [mkStory({ id: 5, myReaction: '❤', reactionsCount: 1 })] }])
    // event about another user → count updates, myReaction untouched
    useStoriesStore.getState().applyStoryReaction(5, 4)
    expect(useStoriesStore.getState().groups[0].stories[0]).toMatchObject({ reactionsCount: 4, myReaction: '❤' })
    // event about me (myReaction provided, even null)
    useStoriesStore.getState().applyStoryReaction(5, 3, null)
    expect(useStoriesStore.getState().groups[0].stories[0]).toMatchObject({ reactionsCount: 3, myReaction: null })
  })

  it('setMyReaction adds/switches/removes optimistically with count + breakdown', () => {
    useStoriesStore.getState().setGroups([{ author: { _: 'user' as const, id: 2, first_name: 'Bob' }, stories: [mkStory({ id: 5, reactionsCount: 1, reactions: [{ emoji: '🔥', count: 1, mine: false }] })] }])
    // add ❤
    useStoriesStore.getState().setMyReaction(5, '❤')
    let st = useStoriesStore.getState().groups[0].stories[0]
    expect(st.myReaction).toBe('❤')
    expect(st.reactionsCount).toBe(2)
    expect(st.reactions).toContainEqual({ emoji: '❤', count: 1, mine: true })
    // switch ❤ → 🔥 (count unchanged, breakdown moves)
    useStoriesStore.getState().setMyReaction(5, '🔥')
    st = useStoriesStore.getState().groups[0].stories[0]
    expect(st.myReaction).toBe('🔥')
    expect(st.reactionsCount).toBe(2)
    expect(st.reactions.find((r) => r.emoji === '🔥')).toEqual({ emoji: '🔥', count: 2, mine: true })
    expect(st.reactions.find((r) => r.emoji === '❤')).toBeUndefined()
    // remove
    useStoriesStore.getState().setMyReaction(5, null)
    st = useStoriesStore.getState().groups[0].stories[0]
    expect(st.myReaction).toBeNull()
    expect(st.reactionsCount).toBe(1)
    expect(st.reactions.find((r) => r.emoji === '🔥')).toEqual({ emoji: '🔥', count: 1, mine: false })
  })

  it('setStoryPinned toggles the pinned flag of the matching story', () => {
    useStoriesStore.getState().setGroups([{ author: { _: 'user' as const, id: 7, first_name: 'Me' }, stories: [mkStory({ id: 5, pinned: false })] }])
    useStoriesStore.getState().setStoryPinned(5, true)
    expect(useStoriesStore.getState().groups[0].stories[0].pinned).toBe(true)
    useStoriesStore.getState().setStoryPinned(5, false)
    expect(useStoriesStore.getState().groups[0].stories[0].pinned).toBe(false)
  })

  it('applyStoryEdit patches caption/privacy and marks edited (unset fields kept)', () => {
    useStoriesStore.getState().setGroups([{ author: { _: 'user' as const, id: 7, first_name: 'Me' }, stories: [mkStory({ id: 5, caption: 'old', privacy: 'contacts', edited: false })] }])
    // change both
    useStoriesStore.getState().applyStoryEdit(5, { caption: 'new', privacy: 'close' })
    let st = useStoriesStore.getState().groups[0].stories[0]
    expect(st).toMatchObject({ caption: 'new', privacy: 'close', edited: true })
    // omitting a field keeps the previous value, still flags edited
    useStoriesStore.getState().applyStoryEdit(5, { caption: 'newer' })
    st = useStoriesStore.getState().groups[0].stories[0]
    expect(st).toMatchObject({ caption: 'newer', privacy: 'close', edited: true })
  })
})
