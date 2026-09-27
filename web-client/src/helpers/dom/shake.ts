// Порт tweb `src/helpers/dom/shake.ts:1-20` (812502980) — «потрясти» элемент:
// отказ без слов (строку нельзя выбрать/снять). Зовут вкладка ссылки папки
// (`sidebarLeft/tabs/sharedFolder.solid.tsx`). Без анимаций (режим экономии,
// `liteMode`) — ничего, как у оригинала.
import liteMode from '@helpers/liteMode'

export default function shake(element: HTMLElement) {
  if(!liteMode.isAvailable('animations')) {
    return
  }

  const keyframes: Keyframe[] = [
    { transform: 'translateX(0)' },
    { transform: 'translateX(.25rem)' },
    { transform: 'translateX(-.25rem)' },
    { transform: 'translateX(0)' },
  ]

  element.animate([...keyframes, ...keyframes, ...keyframes], {
    duration: 300,
    iterations: 1,
    easing: 'ease-in-out',
  })
}
