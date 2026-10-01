/**
 * ВРЕМЕННЫЕ МОСТЫ вкладок настроек к React-попапам (снимаются задачами 2C-10,
 * 2C-13, 2C-17, 2C-18, 2C-19, 2C-20). Имена и сигнатуры — tweb (`showPremiumPopup`,
 * `showStarsPopup`, `showMyQrCodePopup`, `showLogOutPopup`, `showSendGiftPicker`,
 * `showPasskeyPopup` из `components/popups/*`), чтобы Solid-вкладки (корень
 * `sidebarLeft/tabs/settings.solid.tsx`, `passkeys.solid.tsx`) звали их ровно как
 * оригинал (`settings.tsx:97-117`, `:419-446`, `passkeys.tsx:103`); задача 2C
 * заменяет импорт на свой Solid-попап и удаляет строку отсюда.
 *
 * Попапы открываются через глобальный `popupStore` (`PopupHost` живёт в
 * React-дереве шелла, у него есть `ManagersProvider`), поэтому вызов из
 * Solid-обработчика — обычная функция, React в `.solid.tsx` не попадает.
 */
import { useEffect, useRef } from 'react'
import type { Passkey } from '@layer'
import type { Managers } from '@/client/bootstrap'
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
import PasskeyIntroPopup from '../settings/PasskeyIntroPopup'

/**
 * `StarsPopup`/`QrModal`/`PasskeyIntroPopup` сами гасят узел через 300 мс после `open = false`
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

function PasskeyPopupBridge({ api, onCreation }: { api: PopupApi; onCreation?: (passkey: Passkey) => void }) {
  useRemoveAfterHide(api)
  return (
    <PasskeyIntroPopup
      open={api.open}
      onClose={api.requestClose}
      onCreated={(passkey) => {
        api.requestClose()
        onCreation?.(passkey)
      }}
    />
  )
}

// ВРЕМЕННО до 2C-10 (tweb `popups/passkey.tsx:34-66`: `showFeatureDetailsPopup`
// с тремя рядами и кнопками Create/Skip; без WebAuthn — одна Unsupported).
// Создание — портированный `createPasskey` (`components/popups/passkey.ts`),
// закрытие и `onCreation` — после успеха, как у оригинала (`:47-55`).
export function showPasskeyPopup(onCreation?: (passkey: Passkey) => void) {
  openPopup((p) => <PasskeyPopupBridge api={p} onCreation={onCreation} />, 'passkey')
}
