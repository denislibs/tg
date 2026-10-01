/**
 * Порт tweb `src/components/popups/passkey.tsx:9-32` (812502980) — `createPasskey`:
 * регистрация ключа доступа (начало на сервере → `navigator.credentials.create`
 * → завершение), тост об успехе или ошибке; ошибка пробрасывается, чтобы
 * вызывающий (кнопка вкладки, кнопка попапа) не счёл ключ созданным.
 *
 * Сам попап `showPasskeyPopup` (`:34-66`, `showFeatureDetailsPopup`) — задача
 * 2C-10; до неё — мост к React в `sidebarLeft/settingsPopups.tsx`, и 2C-10
 * допишет его сюда.
 *
 * Расхождения с оригиналом:
 *  1. `rootScope.managers.appAccountManager.initPasskeyRegistration()/
 *     registerPasskey()` → `managers.auth.passkeyRegisterBegin()/
 *     passkeyRegisterFinish(session, attestation)` (`core/managers/authManager.ts`):
 *     у нас REST go-webauthn, сессия begin/finish — отдельный токен. Менеджеры
 *     передаются аргументом — модульного `rootScope.managers` у нас нет
 *     (`core/hooks/useManagers.tsx`).
 *  2. `PublicKeyCredential.parseCreationOptionsFromJSON` + `getInputPasskeyCredential`
 *     → `core/webauthnBrowser.ts::createPasskey` (свой разбор base64url-полей и
 *     сборка ответа под `protocol.ParseCredentialCreationResponseBody`): так
 *     WebAuthn работает и в браузерах без `parseCreationOptionsFromJSON`.
 */
import type { Passkey } from '@layer'
import type { Managers } from '@/client/bootstrap'
import { createPasskey as createPasskeyCredential } from '@core/webauthnBrowser'
import { toastNew } from '@components/toast'

export async function createPasskey(managers: Managers): Promise<Passkey> {
  const { session, options } = await managers.auth.passkeyRegisterBegin()

  try {
    const credential = await createPasskeyCredential(options)
    const passkey = await managers.auth.passkeyRegisterFinish(session, credential)
    toastNew({ langPackKey: 'Passkey.Created' })
    return passkey
  } catch(err) {
    console.error('passkey error', err)
    toastNew({ langPackKey: 'Passkey.CreationError' })
    throw err
  }
}
