// Вход во вьювер (ВРЕМЕННО до волны 4): пир → индекс группы React-вьювера, цель
// морфа — аватарка пира, на котором вьювер стоит; заморозка сортировки на время
// вьювера и снятие корня по выходу.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryGroup } from '@core/managers/storiesManager'

type IslandProps = { groupIndex: number, getTarget: (i: number) => Element | null, onClose: () => void }
const unmount = vi.fn()
const mountReact = vi.fn((_host: HTMLElement, _c: unknown, _props: IslandProps) => ({ update: vi.fn(), unmount }))
vi.mock('@shared/react/mountReact', () => ({ mountReact }))
vi.mock('@/client/bootstrap', () => ({ getProxiedManagers: () => ({}) }))
vi.mock('@components/StoryViewer', () => ({ default: () => null }))

const { createStoriesViewer } = await import('./viewer')
const { useStoriesStore } = await import('@stores/storiesStore')

const group = (id: number): StoryGroup => ({
  author: { _: 'user', id, first_name: 'U' + id },
  stories: [{ _: 'storyItem', id: 1, date: 1, expire_date: 2, media: { _: 'messageMediaPhoto', photo: { _: 'photo', id: 1, sizes: [] } } }],
  maxReadId: 0,
})

beforeEach(() => {
  mountReact.mockClear()
  unmount.mockClear()
  useStoriesStore.setState({ groups: [group(2), group(3)], loaded: true })
})

describe('createStoriesViewer', () => {
  it('открывает группу пира, цель морфа — по пиру текущей группы; выход снимает корень и заморозку', async () => {
    const avatar = document.createElement('div')
    const onExit = vi.fn()
    createStoriesViewer({ peerId: 3, target: (peerId) => (peerId === 2 ? avatar : null), onExit })

    const props = mountReact.mock.calls[0][2]
    expect(props.groupIndex).toBe(1)
    expect(props.getTarget(0)).toBe(avatar)
    expect(props.getTarget(1)).toBeNull()

    // заморожено: смена ленты под вьювером не двигает его группу
    useStoriesStore.getState().setGroups([group(3), group(2)])
    expect(useStoriesStore.getState().groups.map((g) => g.author.id)).toEqual([2, 3])

    props.onClose()
    expect(onExit).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(unmount).toHaveBeenCalledTimes(1)
  })

  it('пира нет в ленте — вьювер не монтируется, сразу выход', () => {
    const onExit = vi.fn()
    createStoriesViewer({ peerId: 99, onExit })
    expect(mountReact).not.toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
