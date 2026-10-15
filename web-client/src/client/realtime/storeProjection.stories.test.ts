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
//  • `updateSentStoryReaction` несёт МОЙ выбор и адресует историю парой
//    (peer, story_id): tweb кадр не слушает (В-4), но наш общий `updateStory`
//    личного не несёт, и без обработчика реакция со второго устройства терялась.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(1787334200 * 1000))
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

  it('новые авторы — ОДИН рефетч ленты на пачку кадров: группы без карточки автора не бывает', () => {
    // после офлайна getDifference переигрывает десятки строк подряд
    for (const id of [404, 405, 406]) {
      rootScope.dispatchEventSingle(RT.story, {
        _: 'updateStory',
        peer: { _: 'peerUser', user_id: id },
        story: story(9),
      })
    }
    expect(feed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)

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

  // tweb кадр не слушает: там сервер присылает зрителю `updateStory` с его
  // `sent_reaction`. Наш общий `updateStory` личного не несёт, поэтому моя реакция
  // на втором устройстве едет этим кадром и адресуется парой (peer, story_id).
  it('updateSentStoryReaction ставит МОЮ реакцию именно на историю этого автора', () => {
    useStoriesStore.setState({
      groups: [
        { author: bob, stories: [story(1)], maxReadId: 0 },
        { author: { _: 'user', id: 3, first_name: 'Eve' }, stories: [story(1)], maxReadId: 0 },
      ],
      loaded: true,
    })

    rootScope.dispatchEventSingle(RT.storyReaction, {
      _: 'updateSentStoryReaction',
      peer: { _: 'peerUser', user_id: 2 },
      story_id: 1,
      reaction: { _: 'reactionEmoji', emoticon: '👍' },
    })

    const [bobGroup, eveGroup] = useStoriesStore.getState().groups
    expect(storyMyReaction(bobGroup.stories[0])).toBe('👍')
    expect(storyMyReaction(eveGroup.stories[0])).toBeNull()
  })

  it('пустой эмодзи в кадре — «реакцию сняли»', () => {
    useStoriesStore.getState().setMyReaction(2, 1, '👍')

    rootScope.dispatchEventSingle(RT.storyReaction, {
      _: 'updateSentStoryReaction',
      peer: { _: 'peerUser', user_id: 2 },
      story_id: 1,
      reaction: { _: 'reactionEmoji', emoticon: '' },
    })

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
