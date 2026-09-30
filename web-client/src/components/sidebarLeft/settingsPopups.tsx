/**
 * ВРЕМЕННЫЕ МОСТЫ Solid-вкладок настроек к React-попапам (снимаются задачами
 * 2C-13, 2C-15, 2C-17, 2C-18, 2C-19, 2C-20). Имена и сигнатуры — tweb
 * (`showPremiumPopup`, `showStarsPopup`, `showMyQrCodePopup`, `showLogOutPopup`,
 * `showSendGiftPicker`, `showStickersPopup` из `components/popups/*`), чтобы
 * Solid-корень (`sidebarLeft/tabs/settings.solid.tsx`, `settings.tsx:97-117`,
 * `:419-446`) и «Стикеры и эмодзи» (`sidebarLeft/tabs/stickersAndEmoji.solid.tsx`,
 * `stickersAndEmoji.tsx:188`) звали их ровно как оригинал; задача 2C заменяет
 * импорт на свой Solid-попап и удаляет строку отсюда.
 *
 * Попапы открываются через глобальный `popupStore` (`PopupHost` живёт в
 * React-дереве шелла, у него есть `ManagersProvider`), поэтому вызов из
 * Solid-обработчика — обычная функция, React в `.solid.tsx` не попадает.
 */
import { useEffect, useRef } from 'react'
import type { Managers } from '@/client/bootstrap'
import type { InputStickerSetAddress } from '@core/managers/stickersManager'
import { openPopup, type PopupApi } from '@stores/popupStore'
import { useChatsStore } from '@stores/chatsStore'
import { gradientFor } from '@core/dialogToChat'
import { useMediaUrl } from '@core/hooks/useMediaUrl'
import { getPeerPhotoId } from '@core/peers/peer'
import { getUserTitle } from '@core/peers/getPeerTitle'
import { publicUsernameLink } from '@core/publicLink'
import PremiumModal from '../PremiumModal'
import StarsPopup from '../stars/StarsPopup'
import QrModal from '../QrModal'

/**
 * `StarsPopup`/`QrModal` сами гасят узел через 300 мс после `open = false`
 * (`usePopupTransition`, `settings/kit.tsx`), но стеку попапов о конце
 * выхода не сообщают — снимаем запись тем же сроком.
 */
function useRemoveAfterHide(api: PopupApi) {
  const { open, onExitComplete } = api
  const onExitRef = useRef(onExitComplete)
  onExitRef.current = onExitComplete
  useEffect(() => {
    if(open) return
    const id = window.setTimeout(() => onExitRef.current(), 300)
    return () => window.clearTimeout(id)
  }, [open])
}

// ВРЕМЕННО до 2C-18 (tweb `popups/premium.tsx`)
export function showPremiumPopup() {
  openPopup((p) => <PremiumModal open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} />, 'premium')
}

function StarsPopupBridge({ api }: { api: PopupApi }) {
  useRemoveAfterHide(api)
  return <StarsPopup open={api.open} onClose={api.requestClose} />
}

// ВРЕМЕННО до 2C-19 (tweb `popups/stars.tsx`). Ветки `{ton: true}` нет — TON у
// нас нет (О-6 плана 2C), строки TON в корне тоже.
export function showStarsPopup() {
  openPopup((p) => <StarsPopupBridge api={p} />, 'stars')
}

function MyQrCodeBridge({ api }: { api: PopupApi }) {
  useRemoveAfterHide(api)
  const user = useChatsStore((st) => st.me?.user)
  const name = user ? getUserTitle(user) : ''
  const avatarSrc = useMediaUrl(getPeerPhotoId(user?.photo) || null)
  // Ссылка — `t.me/username` на своём хосте ссылок (`core/publicLink.ts`).
  return (
    <QrModal
      open={api.open}
      onClose={api.requestClose}
      url={user?.username ? publicUsernameLink(user.username) : location.origin}
      label={user?.username ? `@${user.username}` : name}
      avatar={{
        src: avatarSrc,
        background: user ? gradientFor(user.id) : undefined,
        text: (name || '?').trim().charAt(0).toUpperCase(),
      }}
    />
  )
}

// ВРЕМЕННО до 2C-17 (tweb `popups/myQrCode.tsx`)
export function showMyQrCodePopup() {
  openPopup((p) => <MyQrCodeBridge api={p} />, 'my-qr-code')
}

// ВРЕМЕННО до 2C-13 (tweb `popups/logOut.ts`: `confirmationPopup` «Выйти?» →
// `apiManager.logOut()`). До порта — то же действие, что у пункта бургера
// (`MainMenu.tsx` → `useAuthGate.logout`), без подтверждения: подтверждение
// приходит с попапом 2C-13 сразу в оба входа.
export function showLogOutPopup(managers: Managers) {
  void managers.auth.logout().catch(() => { location.reload() })
}

// ВРЕМЕННО до 2C-20 (tweb `popups/sendGiftPicker.ts`: выбор получателя →
// `showSendGiftPopup`). Выбора получателя у нас нет (2C-16), наш
// `stars/SendGiftPopup` открывается только из чата с известным получателем —
// строка корня до 2C-20 ничего не открывает, как и до переезда корня.
export function showSendGiftPicker() {}

// ВРЕМЕННО до 2C-15 (tweb `popups/stickers.tsx`, `showStickersPopup(input)`):
// попап набора — наш React `StickerSetModal`. Без колбэка отправки: у оригинала
// `chatInput` по умолчанию — ввод открытого чата (`stickers.tsx:46`), и клик по
// стикеру отправляет в него (`:155-162`); у нас отправку попапу даёт только
// `Chat.tsx`, поэтому из настроек сетка лишь смотрится — до 2C-15. Импорт
// ленивый, как у клика по стикеру в ленте (`Chat.tsx`): попап — свой чанк
// (`lazyChunks.test.ts`).
export function showStickersPopup(input: InputStickerSetAddress) {
  void import('../stickers/StickerSetModal').then((m) => { m.openStickerSetModal(input) })
}
