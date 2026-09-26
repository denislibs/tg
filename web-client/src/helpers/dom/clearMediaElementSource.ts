// Порт tweb `helpers/dom/clearMediaElementSource.ts` (812502980) — дословно,
// только формат под `.oxlintrc.json` (без `;`).
// Освобождает декодер медиа-элемента: пауза, сброс источника и `load()`,
// после которого браузер отпускает буферы. Зовётся на уходе элемента
// (tweb `createAvatarVideo.ts` — на `middleware.onClean`).
export default function clearMediaElementSource(element: HTMLImageElement | HTMLMediaElement) {
  const isMedia = element.tagName === 'AUDIO' || element.tagName === 'VIDEO'
  const media = element as HTMLMediaElement

  if(isMedia) {
    try {
      media.pause()
    } catch{}

    media.srcObject = null
    // Assign through the property before removing the attribute. createVideo
    // installs a setter here to release stream/* bookkeeping.
    media.src = ''
  }

  element.removeAttribute('src')
  if(isMedia) {
    try {
      media.load()
    } catch{}
  }
}
