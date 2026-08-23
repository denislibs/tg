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
//  • `updateSentStoryReaction` несёт МОЙ выбор и только его — общий агрегат
//    приезжает внутри самой истории, и брать счётчик отсюда нельзя.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { useStoriesStore } from '../../stores/storiesStore'
import type { StoryItem } from '../../core/stories/story'
import { storyMyReaction } from '../../core/stories/story'
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
    useStoriesStore.setState({ groups: [{ author: bob, stories: [story(1)] }], loaded: true })
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

  it('updateSentStoryReaction ставит МОЮ реакцию', () => {
    rootScope.dispatchEventSingle(RT.storyReaction, {
      _: 'updateSentStoryReaction',
      peer: { _: 'peerUser', user_id: 2 },
      story_id: 1,
      reaction: { _: 'reactionEmoji', emoticon: '👍' },
    })

    expect(storyMyReaction(useStoriesStore.getState().groups[0].stories[0])).toBe('👍')
  })

  it('пустой эмодзи в кадре — «реакцию сняли», а не реакция с пустым значением', () => {
    useStoriesStore.getState().setMyReaction(1, '👍')

    rootScope.dispatchEventSingle(RT.storyReaction, {
      _: 'updateSentStoryReaction',
      peer: { _: 'peerUser', user_id: 2 },
      story_id: 1,
      reaction: { _: 'reactionEmoji', emoticon: '' },
    })

    expect(storyMyReaction(useStoriesStore.getState().groups[0].stories[0])).toBeNull()
  })
})
