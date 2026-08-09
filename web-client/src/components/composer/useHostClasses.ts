// src/components/composer/useHostClasses.ts
// Классы состояний, которые tweb ставит НЕ на свой узел, а на предка:
//   `is-helper-active` → на контейнер чата (`this.chat.container`, input.ts:4886-4890);
//   `is-recording` / `is-locked` → на `.chat-input` (chatRecording.ts:792, :946).
// Оба узла рендерит Chat.tsx, композер ими не владеет, поэтому предка ищем по DOM —
// ровно так же, как это делает оригинал (у него это готовая ссылка на объект чата).
import { useEffect, type RefObject } from 'react'

/** Держит на ближайшем предке по `selector` ровно тот набор классов, что передан. */
export function useHostClasses(ref: RefObject<HTMLElement | null>, selector: string, classes: string) {
  useEffect(() => {
    const names = classes.split(' ').filter(Boolean)
    if (!names.length) return
    const host = ref.current?.closest(selector)
    if (!host) return
    host.classList.add(...names)
    return () => host.classList.remove(...names)
  }, [ref, selector, classes])
}
