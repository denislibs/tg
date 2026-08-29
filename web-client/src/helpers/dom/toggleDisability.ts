// Порт tweb `src/helpers/dom/toggleDisability.ts` — 1:1.
//
// Возвращает ОБРАТНОЕ действие, а не булево: вызывающий не помнит, что именно
// он выключил, — он просто зовёт возвращённую функцию в `finally`. Так сделан
// «завершить все сессии» во вкладке «Устройства» (tweb
// `sidebarLeft/tabs/activeSessions.tsx:71,78`): кнопка гасится на время
// запроса и оживает в `finally` независимо от исхода.
import toArray from '@helpers/array/toArray'

export default function toggleDisability(elements: HTMLElement | HTMLElement[], disable: boolean): () => void {
  const list = toArray(elements)

  if(disable) {
    list.forEach((el) => el.setAttribute('disabled', 'true'))
  } else {
    list.forEach((el) => el.removeAttribute('disabled'))
  }

  return () => toggleDisability(list, !disable)
}
