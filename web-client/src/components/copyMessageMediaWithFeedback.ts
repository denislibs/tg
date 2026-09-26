// Порт tweb `src/components/copyMessageMediaWithFeedback.ts:1-31` (812502980,
// коммит 508acd4f5) — общее действие «Копировать медиа» для трёх мест:
// контекстного меню сообщения (`chat/contextMenu.ts`), меню элемента shared
// media (`SearchContextMenu`, `appSearchSuper.ts`) и медиавьювера
// (`mediaViewer/appMediaViewer.ts`). Пункт меню на время копирования
// показывает прелоадер вместо иконки, по итогу — тост и закрытие меню.
//
// Адаптация: аргумент `index` (номер медиа внутри платного/инвойсного
// альбома, `getMediaFromMessage(message, true, index)`) не портирован — наш
// `getMediaFromMessage` адресует одно медиа сообщения
// (`core/media/messageMedia.ts`), а номера ячейки у вызывающих нет.
import type { MyMessage } from '@core/models'
import { getMediaFromMessage } from '@core/media/messageMedia'
import { setButtonMenuItemLoading, type ButtonMenuItemOptions } from '@components/buttonMenu'
import { toastNew } from '@components/toast'
import copyMediaToClipboard from '@helpers/copyMediaToClipboard'
import contextMenuController from '@helpers/contextMenuController'

export default function copyMessageMediaWithFeedback(options: {
  message: MyMessage | undefined
  button: ButtonMenuItemOptions
  cleanup?: () => void
}) {
  const { message, button, cleanup } = options
  const media = getMediaFromMessage(message)
  const buttonElement = button.element
  setButtonMenuItemLoading(button, true, buttonElement)

  void copyMediaToClipboard(media).then(() => {
    toastNew({ langPackKey: 'MediaCopied' })
    if (buttonElement?.closest('.btn-menu')?.classList.contains('active')) {
      contextMenuController.close()
    }
  }).catch((error: unknown) => {
    console.error('media copy failed', error)
    toastNew({ langPackKey: 'MediaCopyFailed' })
  }).finally(() => {
    cleanup?.()
    setButtonMenuItemLoading(button, false, buttonElement)
  })
}
