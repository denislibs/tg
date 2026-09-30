// Порт tweb `helpers/dom/toggleDisability.ts` (812502980) — 1:1. Первый
// потребитель — угловая кнопка вкладки «Новый канал»
// (`sidebarLeft/tabs/newChannel.solid.tsx`): на время запроса кнопка
// заперта, возвращённая функция отпирает её обратно.
import toArray from '@helpers/array/toArray'

export default function toggleDisability(elements: HTMLElement | HTMLElement[], disable: boolean): () => void {
  elements = toArray(elements)

  if(disable) {
    elements.forEach((el) => el.setAttribute('disabled', 'true'))
  } else {
    elements.forEach((el) => el.removeAttribute('disabled'))
  }

  return () => toggleDisability(elements, !disable)
}
