// ВРЕМЕННО до порта своих пачек (шапка `GlobalOverlays.tsx`): один React-корень
// глобальных оверлеев на статичном `#react-overlays` (`index.html`). Зовёт
// `bootstrapIm` — оверлеи нужны только мессенджеру; корень живёт вечно, как и
// страница (выход из аккаунта — перезагрузка).
import { mountReact } from '@shared/react/mountReact'
import type { Managers } from '@/client/bootstrap'
import GlobalOverlays from './GlobalOverlays'

export function mountGlobalOverlays(managers: Managers) {
  return mountReact(document.getElementById('react-overlays')!, GlobalOverlays, {}, managers)
}
