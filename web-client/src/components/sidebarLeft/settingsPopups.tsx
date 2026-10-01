/**
 * ВРЕМЕННЫЕ МОСТЫ вкладок настроек к React-попапам (снимаются задачами 2C-10,
 * 2C-13, 2C-14, 2C-17, 2C-18, 2C-19, 2C-20). Имена и сигнатуры — tweb (`showPremiumPopup`,
 * `showStarsPopup`, `showMyQrCodePopup`, `showLogOutPopup`, `showSendGiftPicker`,
 * `showPasskeyPopup`, `showBirthdayPopup`/`saveMyBirthday` из `components/popups/*`),
 * чтобы Solid-вкладки (корень `sidebarLeft/tabs/settings.solid.tsx`,
 * `passkeys.solid.tsx`, `editProfile.solid.tsx`) звали их ровно как оригинал
 * (`settings.tsx:97-117`, `:419-446`, `passkeys.tsx:103`, `editProfile.tsx:328-339`);
 * задача 2C заменяет импорт на свой Solid-попап и удаляет строку отсюда.
 *
 * Попапы открываются через глобальный `popupStore` (`PopupHost` живёт в
 * React-дереве шелла, у него есть `ManagersProvider`), поэтому вызов из
 * Solid-обработчика — обычная функция, React в `.solid.tsx` не попадает.
 */
import { useEffect, useRef } from 'react'
import type { Passkey } from '@layer'
import type { Managers } from '@/client/bootstrap'
import type { MaybePromise } from '@types'
import type { Birthday } from '@core/peers/peer'
import { toastNew } from '@components/toast'
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
import BirthdayModal from '../settings/BirthdayModal'

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

function BirthdayBridge({ api, initialDate, onSave }: {
  api: PopupApi
  initialDate?: Birthday
  onSave: (date: Birthday | null) => MaybePromise<boolean>
}) {
  useRemoveAfterHide(api)
  return (
    <BirthdayModal
      open={api.open}
      initial={initialDate ?? null}
      onClose={api.requestClose}
      // tweb `birthday.tsx:295-301`: кнопка «Save» ждёт `onSave` и закрывает
      // попап при любом исходе (`callback` → `return true`)
      onSave={(date) => { void Promise.resolve(onSave(date)).finally(api.requestClose) }}
    />
  )
}

// ВРЕМЕННО до 2C-14 (tweb `popups/birthday.tsx:52-307`). Вход — только выбор
// даты: приватности «кто видит» (`getPrivacy('inputPrivacyKeyBirthday')`,
// :59-64) и кнопки «Remove» (`fromProfile && initialDate`, :282-291) у
// React-модалки нет — их приносит порт 2C-14.
export function showBirthdayPopup(props: {
  initialDate?: Birthday
  onSave: (date: Birthday | null) => MaybePromise<boolean>
}) {
  openPopup((p) => <BirthdayBridge api={p} initialDate={props.initialDate} onSave={props.onSave} />, 'birthday')
}

// ВРЕМЕННО до 2C-14 (tweb `popups/birthday.tsx:30-39`). `managers` — параметром:
// DI-ручки вне React у нас нет (как `showLogOutPopup`). `setMyBirthday` —
// наш `PATCH /me {birthday}` (`profile.update`).
export async function saveMyBirthday(managers: Pick<Managers, 'profile'>, date: Birthday | null) {
  try {
    await managers.profile.update({ birthday: date })
    return true
  } catch(error) {
    console.error(error)
    toastNew({ langPackKey: 'Error.AnError' })
    return false
  }
}
