// src/stores/storiesStore.test.ts
//
// Истории лежат в зеркале КОНСТРУКТОРАМИ схемы, поэтому и проверяется тут форма
// конструктора: «моя реакция» — параметр `sent_reaction` истории, общий агрегат
// — `views`, закреп и правка — флаги `pFlags`, а «моя» в чипе разбивки это
// `chosen_order`, а не булево поле.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStoriesStore, loadStories } from './storiesStore'
import type { StoryGroup } from '../core/managers/storiesManager'
import type { ReactionCount } from '../core/models'
import type { StoryItem, StoryItemReal } from '../core/stories/story'
import { isStoryEdited, isStoryPinned, storyCaption, storyMyReaction, storyPrivacy, storyReactionsCount } from '../core/stories/story'

const media = { _: 'messageMediaPhoto' as const, photo: { _: 'photo' as const, id: 11, sizes: [] } }

const mkStory = (over: Partial<StoryItemReal> = {}): StoryItem => ({
  _: 'storyItem', id: 1, date: 1787334148, expire_date: 1787420548, media, ...over,
})

/** Агрегат реакций истории. `chosen_order` ставится только своей реакции. */
const views = (count: number, results: ReactionCount[] = []): StoryItemReal['views'] =>
  ({ _: 'storyViews', views_count: 0, reactions: results, reactions_count: count })

const chip = (emoticon: string, count: number, mine = false): ReactionCount => ({
  _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon }, count,
  ...(mine ? { chosen_order: 0 } : {}),
})

const groups: StoryGroup[] = [
  { author: { _: 'user' as const, id: 7, first_name: 'Me' }, stories: [mkStory()] },
]

function fakeManagers(over: Partial<{ groups: StoryGroup[] }> = {}) {
  return {
    stories: { feed: async () => over.groups ?? groups },
  }
}

const bob = { _: 'user' as const, id: 2, first_name: 'Bob' }
const me = { _: 'user' as const, id: 7, first_name: 'Me' }
const first = () => useStoriesStore.getState().groups[0].stories[0]

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
    useStoriesStore.getState().setGroups([{ author: bob, stories: [mkStory({ id: 1 })] }])
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
    useStoriesStore.getState().setGroups([{ author: bob, stories: [mkStory({ id: 1 }), mkStory({ id: 2 })] }])
    useStoriesStore.getState().removeStory(2, 1)
    expect(useStoriesStore.getState().groups[0].stories.map((s) => s.id)).toEqual([2])
    useStoriesStore.getState().removeStory(2, 2)
    expect(useStoriesStore.getState().groups).toHaveLength(0) // empty group removed
  })

  it('applyStoryReaction ставит счётчик; свою реакцию — только когда она передана', () => {
    useStoriesStore.getState().setGroups([{
      author: bob,
      stories: [mkStory({ id: 5, sent_reaction: { _: 'reactionEmoji', emoticon: '❤' }, views: views(1) })],
    }])
    // событие про ЧУЖОЕ действие → счётчик обновился, своя реакция не тронута
    useStoriesStore.getState().applyStoryReaction(5, 4)
    expect(storyReactionsCount(first())).toBe(4)
    expect(storyMyReaction(first())).toBe('❤')
    // событие про меня (реакция передана, пусть и null)
    useStoriesStore.getState().applyStoryReaction(5, 3, null)
    expect(storyReactionsCount(first())).toBe(3)
    expect(storyMyReaction(first())).toBeNull()
  })

  it('setMyReaction добавляет/меняет/снимает оптимистично: счётчик и чипы', () => {
    useStoriesStore.getState().setGroups([{
      author: bob,
      stories: [mkStory({ id: 5, views: views(1, [chip('🔥', 1)]) })],
    }])
    // add ❤
    useStoriesStore.getState().setMyReaction(5, '❤')
    expect(storyMyReaction(first())).toBe('❤')
    expect(storyReactionsCount(first())).toBe(2)
    expect((first() as StoryItemReal).views?.reactions).toContainEqual(chip('❤', 1, true))
    // switch ❤ → 🔥 (count unchanged, breakdown moves)
    useStoriesStore.getState().setMyReaction(5, '🔥')
    expect(storyMyReaction(first())).toBe('🔥')
    expect(storyReactionsCount(first())).toBe(2)
    const results = () => (first() as StoryItemReal).views?.reactions ?? []
    expect(results().find((r) => r.reaction._ === 'reactionEmoji' && r.reaction.emoticon === '🔥')).toEqual(chip('🔥', 2, true))
    expect(results().find((r) => r.reaction._ === 'reactionEmoji' && r.reaction.emoticon === '❤')).toBeUndefined()
    // remove — своя пометка СНИМАЕТСЯ, а не становится ложной: `chosen_order`
    // отсутствует, потому что «не поставил» это отсутствие параметра.
    useStoriesStore.getState().setMyReaction(5, null)
    expect(storyMyReaction(first())).toBeNull()
    expect(storyReactionsCount(first())).toBe(1)
    expect(results().find((r) => r.reaction._ === 'reactionEmoji' && r.reaction.emoticon === '🔥')).toEqual(chip('🔥', 1))
  })

  it('setStoryPinned переключает ФЛАГ истории, а снятый флаг исчезает', () => {
    useStoriesStore.getState().setGroups([{ author: me, stories: [mkStory({ id: 5 })] }])
    useStoriesStore.getState().setStoryPinned(5, true)
    expect(isStoryPinned(first())).toBe(true)
    useStoriesStore.getState().setStoryPinned(5, false)
    expect(isStoryPinned(first())).toBe(false)
    expect((first() as StoryItemReal).pFlags?.pinned).toBeUndefined()
  })

  it('applyStoryEdit правит подпись/аудиторию и поднимает флаг edited', () => {
    useStoriesStore.getState().setGroups([{
      author: me,
      stories: [mkStory({ id: 5, caption: 'old', pFlags: { contacts: true } })],
    }])
    useStoriesStore.getState().applyStoryEdit(5, { caption: 'new', privacy: 'close' })
    expect(storyCaption(first())).toBe('new')
    expect(storyPrivacy(first())).toBe('close')
    expect(isStoryEdited(first())).toBe(true)
    // Аудитория едет и ВЕКТОРОМ ПРАВИЛ — той же формой, что приезжает с провода.
    expect((first() as StoryItemReal).privacy).toEqual([{ _: 'privacyValueAllowCloseFriends' }])
    // Пропущенное поле сохраняет прежнее значение, флаг edited остаётся.
    useStoriesStore.getState().applyStoryEdit(5, { caption: 'newer' })
    expect(storyCaption(first())).toBe('newer')
    expect(storyPrivacy(first())).toBe('close')
    expect(isStoryEdited(first())).toBe(true)
  })
})
