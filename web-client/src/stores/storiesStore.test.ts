// src/stores/storiesStore.test.ts
//
// Истории лежат в зеркале КОНСТРУКТОРАМИ схемы, поэтому и проверяется тут форма
// конструктора: «моя реакция» — параметр `sent_reaction` истории, общий агрегат
// — `views`, закреп и правка — флаги `pFlags`, а «моя» в чипе разбивки это
// `chosen_order`, а не булево поле.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStoriesStore, loadStories, getStoriesSortIndex, getStoriesSegments } from './storiesStore'
import rootScope from '@lib/rootScope'
import type { StoryGroup } from '../core/managers/storiesManager'
import type { ReactionCount } from '../core/models'
import type { StoryItem, StoryItemReal } from '../core/stories/story'
import { isStoryEdited, isStoryPinned, isStoryRead, storyCaption, storyMyReaction, storyPrivacy, storyReactionsCount } from '../core/stories/story'

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
  { author: { _: 'user' as const, id: 7, first_name: 'Me' }, stories: [mkStory()], maxReadId: 0 },
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

  it('markRead двигает ГОРИЗОНТ группы и только вперёд', () => {
    useStoriesStore.getState().setGroups([{ author: bob, stories: [mkStory({ id: 3 })], maxReadId: 0 }])
    // Прочитанность — свойство ГРУППЫ: у самой истории признака больше нет.
    useStoriesStore.getState().markRead(2, 3)
    expect(useStoriesStore.getState().groups[0].maxReadId).toBe(3)
    expect(isStoryRead(first(), useStoriesStore.getState().groups[0].maxReadId)).toBe(true)
    // Повторное чтение старой истории горизонт не откатывает.
    useStoriesStore.getState().markRead(2, 1)
    expect(useStoriesStore.getState().groups[0].maxReadId).toBe(3)
    // Чужой автор не задет.
    useStoriesStore.getState().markRead(999, 9)
    expect(useStoriesStore.getState().groups[0].maxReadId).toBe(3)
  })

  it('addStory appends to the author group, skipping duplicates and unknown authors', () => {
    useStoriesStore.getState().setGroups([{ author: bob, stories: [mkStory({ id: 1 })], maxReadId: 0 }])
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
    useStoriesStore.getState().setGroups([{ author: bob, stories: [mkStory({ id: 1 }), mkStory({ id: 2 })], maxReadId: 0 }])
    useStoriesStore.getState().removeStory(2, 1)
    expect(useStoriesStore.getState().groups[0].stories.map((s) => s.id)).toEqual([2])
    useStoriesStore.getState().removeStory(2, 2)
    expect(useStoriesStore.getState().groups).toHaveLength(0) // empty group removed
  })

  it('applyStoryReaction ставит счётчик; свою реакцию — только когда она передана', () => {
    useStoriesStore.getState().setGroups([{
      author: bob,
      stories: [mkStory({ id: 5, sent_reaction: { _: 'reactionEmoji', emoticon: '❤' }, views: views(1) })],
      maxReadId: 0,
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
      maxReadId: 0,
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
    useStoriesStore.getState().setGroups([{ author: me, stories: [mkStory({ id: 5 })], maxReadId: 0 }])
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
      maxReadId: 0,
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

// Порядок ленты — позиция tweb `generateSortIndexForCache` (appStoriesManager.ts:197-221):
// свои → непрочитанные → премиум → свежесть последней истории; заморозка
// `toggleSorting` (stories/store.tsx:495-510) держит порядок, пока на него смотрят.
describe('storiesStore — порядок ленты', () => {
  const g = (id: number, maxReadId: number, ids: number[], premium = false): StoryGroup => ({
    author: { _: 'user', id, first_name: 'U' + id, ...(premium ? { pFlags: { premium: true as const } } : {}) },
    stories: ids.map((sid) => mkStory({ id: sid, date: 1787334148 + sid })),
    maxReadId,
  })
  const order = () => useStoriesStore.getState().groups.map((x) => x.author.id)

  beforeEach(() => {
    rootScope.myId = 7
    useStoriesStore.setState({ groups: [], loaded: false })
  })

  it('свои первыми даже прочитанные, затем непрочитанные, премиум, свежие', () => {
    useStoriesStore.getState().setGroups([
      g(2, 9, [9]), // прочитан
      g(3, 0, [1]), // непрочитан, старый
      g(7, 5, [5]), // свои, прочитаны
      g(4, 0, [2]), // непрочитан, свежее
      g(5, 0, [1], true), // непрочитан, премиум
    ])
    expect(order()).toEqual([7, 5, 4, 3, 2])
    expect(getStoriesSortIndex(g(2, 0, []))).toBeUndefined()
  })

  it('заморозка держит порядок, снятие последней пересортирует; новые под заморозкой — в конец', () => {
    useStoriesStore.getState().setGroups([g(3, 0, [1]), g(2, 0, [2])])
    expect(order()).toEqual([2, 3])

    const st = useStoriesStore.getState()
    st.toggleSorting('list', true)
    st.toggleSorting('viewer', true)
    st.markRead(2, 2)
    st.setGroups([g(2, 2, [2]), g(3, 0, [1]), g(9, 0, [5])])
    expect(order()).toEqual([2, 3, 9])

    st.toggleSorting('viewer', false)
    expect(order()).toEqual([2, 3, 9])
    st.toggleSorting('list', false)
    expect(order()).toEqual([9, 3, 2])
  })

  it('сегменты кольца: подряд идущие одного типа сливаются, close — непрочитанная для близких', () => {
    const group = g(2, 2, [1, 2, 3, 4])
    group.stories[3] = mkStory({ id: 4, pFlags: { close_friends: true } })
    expect(getStoriesSegments(group)).toEqual([
      { type: 'read', length: 2 },
      { type: 'unread', length: 1 },
      { type: 'close', length: 1 },
    ])
  })
})
