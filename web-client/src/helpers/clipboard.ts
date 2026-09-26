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
//
// ЗАПИСЬ `ClipboardItem` (`canWriteClipboardItem`/`writeClipboardItem`,
// 812502980 `:8-34`, коммит 508acd4f5) портирована 1:1 — её потребитель
// `helpers/copyMediaToClipboard.ts` (картинка в буфер из контекстного меню и
// медиавьювера). Адаптация одна: `getAppWindow()` (окно Document PiP) →
// `window`, как во всём порте (`helpers/dom/clickEvent.ts`). Параметр
// `appWindow` оставлен: через него оригинал передаёт окно, и тем же путём
// его подменяет тест.

type ClipboardItemData = ConstructorParameters<typeof ClipboardItem>[0]

// Конструктор берётся У ОКНА, а не глобальным именем: `ClipboardItem` нет в
// небезопасном контексте и в части браузеров — тогда вызов имени бросил бы
// `ReferenceError`, а проверка ниже честно отвечает «нельзя».
function getClipboardContext(appWindow: Window = window) {
  const ClipboardItemConstructor = (appWindow as Window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  const clipboard = appWindow.navigator.clipboard as Clipboard | undefined

  return { ClipboardItemConstructor, clipboard }
}

export function canWriteClipboardItem(mimeType: string, appWindow: Window = window) {
  const { ClipboardItemConstructor, clipboard } = getClipboardContext(appWindow)
  return !!(
    ClipboardItemConstructor &&
    clipboard?.write &&
    // `supports` появился позже самого `ClipboardItem`: нет метода — нет и отказа
    (!(ClipboardItemConstructor.supports as unknown) || ClipboardItemConstructor.supports(mimeType))
  )
}

export function writeClipboardItem(data: ClipboardItemData, appWindow: Window = window) {
  const { ClipboardItemConstructor, clipboard } = getClipboardContext(appWindow)
  if (!ClipboardItemConstructor || !clipboard?.write) {
    throw new Error('Clipboard item writing is not supported')
  }

  return clipboard.write([new ClipboardItemConstructor(data)])
}

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
