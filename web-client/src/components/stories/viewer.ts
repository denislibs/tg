// ВРЕМЕННО до волны 4 (порт tweb `components/stories/viewer.tsx`): вход во вьювер
// историй. У tweb `createStoriesViewer` (`viewer.tsx:3556-3575`) — Solid-порталом в
// `#stories-viewer`; вьювер у нас пока React (`components/StoryViewer.tsx`), поэтому
// здесь — ФУНКЦИЯ того же имени, которая монтирует его островом `mountReact`
// (направление «React внутри не-React», правило 2 плана каркаса) и снимает корень
// по выходу. Обёрток вокруг Solid-ряда нет: ряд зовёт функцию, как зовёт её tweb
// (`stories/list.tsx:93`).
//
// Расхождения с оригиналом (до порта вьювера):
//  1. Пир вьювера — `peerId`, а не текущий пир контекста `StoriesProvider` (его у нас
//     нет): React-вьювер берёт группу индексом в `useStoriesStore.groups`, индекс
//     ищется здесь. `target` — по пиру: его аватарка в ряду (tweb `list.tsx:80-83`
//     читает `items.get(stories.peer)` — того пира, на котором вьювер СЕЙЧАС).
//  2. Заморозку сортировки на время вьювера (`toggleSorting('viewer', …)` у tweb
//     ставит сам вьювер) ставит эта функция: вьювер держит группу индексом.
import { mountReact } from '@shared/react/mountReact'
import { getProxiedManagers } from '@/client/bootstrap'
import { useStoriesStore } from '@stores/storiesStore'
import StoryViewer from '@components/StoryViewer'

export function createStoriesViewer(props: {
  peerId: PeerId,
  /** аватарка-источник морфа для пира, на котором стоит вьювер */
  target?: (peerId: PeerId) => Element | null | undefined,
  onExit?: () => void
}): () => void {
  const { groups, toggleSorting } = useStoriesStore.getState()
  const groupIndex = groups.findIndex((group) => group.author.id === props.peerId)
  if(groupIndex === -1) {
    props.onExit?.()
    return () => {}
  }

  toggleSorting('viewer', true)
  const host = document.createElement('div')
  ;(document.getElementById('stories-viewer') ?? document.body).append(host)

  let island: ReturnType<typeof mountReact> | undefined
  const dispose = () => {
    if(!island) return
    island.unmount()
    island = undefined
    host.remove()
    useStoriesStore.getState().toggleSorting('viewer', false)
  }

  island = mountReact(host, StoryViewer, {
    groupIndex,
    getTarget: (index: number) => {
      const group = useStoriesStore.getState().groups[index]
      return (group && props.target?.(group.author.id)) ?? null
    },
    onClose: () => {
      // Снятие корня из его же колбэка React не допускает синхронно.
      queueMicrotask(dispose)
      props.onExit?.()
    },
  }, getProxiedManagers())

  return dispose
}
