// ВРЕМЕННО до сноса последнего React-портала (у tweb React нет; правило 2
// плана волны 7). Контейнер `createPortal` для React-попапов и меню.
//
// Это ОДИН узел прямо в body окна, где живёт приложение (`getOverlayRoot()`),
// а не сам body. Вынос клиента в Document PiP (`components/clientPip.solid.tsx`,
// порт tweb `clientPip.tsx`) переносит DOM-узлы body в окно выноса и обратно;
// React об этом не знает, и портал прямо в body после переноса снимал бы свой
// узел не у того родителя (`removeChild` → `NotFoundError`). Узел-хозяин же
// переезжает целиком: созданный до выноса — как узел body (`moved`, `:69-76`),
// созданный в выносе — как временный корень (`:106-120`), — а цель портала
// остаётся той же, и React её не меняет.
import { getOverlayRoot } from '@helpers/appWindow'

let host: HTMLElement | undefined

export function usePortalContainer(): HTMLElement {
  if(!host?.isConnected) {
    const root = getOverlayRoot()
    host = root.ownerDocument.createElement('div')
    root.append(host)
  }

  return host
}
