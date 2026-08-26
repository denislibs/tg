// Порт tweb `helpers/clipboard.ts` — копирование текста в буфер обмена.
//
// Портирован ТЕКСТОВЫЙ путь целиком, вместе с фолбэком на `execCommand('copy')`
// через временную `<textarea>` (оригинал :7-49): `navigator.clipboard` нет в
// небезопасном контексте (http-стенд) и он отказывает без пользовательского
// жеста, а копирование из контекстного меню обязано работать и там.
//
// НЕ портирован html-вариант (`copyTextToClipboard(text, html)` и ветка
// `contentEditable` фолбэка): второй аргумент собирает только
// `prepareTextWithEntitiesForCopying` (`wrapRichText` + `documentFragmentToHTML`),
// которого в проекте нет — копируется чистый текст, как и в React-версии меню.
// Опция `rethrow` тоже не портирована: её единственный потребитель в tweb —
// попап QR-кода.

// https://stackoverflow.com/a/30810322
function fallbackCopyTextToClipboard(text: string) {
  const textArea = document.createElement('textarea')
  textArea.value = text

  // Avoid scrolling to bottom
  textArea.style.top = '0'
  textArea.style.left = '0'
  textArea.style.position = 'fixed'

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    document.execCommand('copy')
    window.getSelection()?.removeAllRanges()
  } catch(err) {
    console.error('unable to copy', err)
  } finally {
    document.body.removeChild(textArea)
  }
}

export async function copyTextToClipboard(text: string) {
  if(!navigator.clipboard) {
    fallbackCopyTextToClipboard(text)
    return
  }

  try {
    await navigator.clipboard.writeText(text)
  } catch(err) {
    console.error('clipboard error', err)
    fallbackCopyTextToClipboard(text)
  }
}
