// Кадры историй: один конструктор на «появилась» и «исчезла» плюс отдельный
// кадр личного выбора.
//
// Пин держит ровно то, ради чего порт делался:
//
//  • ветвление идёт по конструктору ВНУТРИ кадра (`storyItem` против
//    `storyItemDeleted`), а не по имени кадра — прежде это были два разных
//    типа, и удалённая история отличалась от новой только конвертом;
//  • история приезжает ЦЕЛИКОМ и применяется точечно; полный рефетч ленты
//    остаётся ровно для НОВОГО автора, чьей карточки в зеркале ещё нет;
//  • `updateSentStoryReaction` стор не меняет: tweb его не слушает (В-4), свою
//    реакцию вторая вкладка получает телом `updateStory`.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { useStoriesStore } from '../../stores/storiesStore'
import type { StoryItem, StoryItemReal } from '../../core/stories/story'
import { storyCaption, storyMyReaction } from '../../core/stories/story'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const media = { _: 'messageMediaPhoto' as const, photo: { _: 'photo' as const, id: 11, sizes: [] } }
const story = (id: number): StoryItem =>
  ({ _: 'storyItem', id, date: 1787334148, expire_date: 1787420548, media })

const bob = { _: 'user' as const, id: 2, first_name: 'Bob' }
const feed = vi.fn(async () => [])

describe('storeProjection — кадры историй', () => {
  beforeAll(() => registerStoreProjection({ stories: { feed } } as unknown as Managers))

  beforeEach(() => {
    feed.mockClear()
    useStoriesStore.setState({ groups: [{ author: bob, stories: [story(1)], maxReadId: 0 }], loaded: true })
  })

  it('storyItem известного автора применяется ТОЧЕЧНО, без рефетча ленты', () => {
    rootScope.dispatchEventSingle(RT.story, {
      _: 'updateStory',
      peer: { _: 'peerUser', user_id: 2 },
      story: story(2),
    })

    expect(useStoriesStore.getState().groups[0].stories.map((s) => s.id)).toEqual([1, 2])
    expect(feed).not.toHaveBeenCalled()
  })

  it('storyItemDeleted — ТОТ ЖЕ кадр — убирает историю', () => {
    rootScope.dispatchEventSingle(RT.story, {
      _: 'updateStory',
      peer: { _: 'peerUser', user_id: 2 },
      story: { _: 'storyItemDeleted', id: 1 },
    })

    // Группа опустела — и исчезла вместе с последней историей.
    expect(useStoriesStore.getState().groups).toHaveLength(0)
  })

  it('новый автор — рефетч ленты: группы без карточки автора не бывает', () => {
    rootScope.dispatchEventSingle(RT.story, {
      _: 'updateStory',
      peer: { _: 'peerUser', user_id: 404 },
      story: story(9),
    })

    expect(feed).toHaveBeenCalledTimes(1)
    expect(useStoriesStore.getState().groups.map((g) => g.author.id)).toEqual([2])
  })

  it('updateReadStories двигает ГОРИЗОНТ группы', () => {
    rootScope.dispatchEventSingle(RT.storyRead, {
      _: 'updateReadStories',
      peer: { _: 'peerUser', user_id: 2 },
      max_id: 5,
    })

    // Прочтение приехало с ДРУГОГО устройства зрителя — кольцо гаснет и здесь.
    expect(useStoriesStore.getState().groups[0].maxReadId).toBe(5)
  })

  // tweb `updateSentStoryReaction` не слушает (grep по lib и components пуст,
  // В-4): своя реакция на другом устройстве придёт в теле `updateStory`, а не
  // этим кадром. Кадр остаётся в каталоге, но стор не меняет.
  it('updateSentStoryReaction стор не меняет', () => {
    const before = useStoriesStore.getState().groups

    rootScope.dispatchEventSingle(RT.storyReaction, {
      _: 'updateSentStoryReaction',
      peer: { _: 'peerUser', user_id: 2 },
      story_id: 1,
      reaction: { _: 'reactionEmoji', emoticon: '👍' },
    })

    expect(useStoriesStore.getState().groups).toBe(before)
    expect(storyMyReaction(useStoriesStore.getState().groups[0].stories[0])).toBeNull()
  })

  it('updateStory с тем же номером ЗАМЕНЯЕТ историю: правка подписи доходит', () => {
    rootScope.dispatchEventSingle(RT.story, {
      _: 'updateStory',
      peer: { _: 'peerUser', user_id: 2 },
      story: { ...(story(1) as StoryItemReal), caption: 'edited' },
    })

    const stories = useStoriesStore.getState().groups[0].stories
    expect(stories).toHaveLength(1)
    expect(storyCaption(stories[0])).toBe('edited')
  })
})
