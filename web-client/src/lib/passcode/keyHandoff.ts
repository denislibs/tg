// Порт tweb `lib/passcode/keyHandoff.ts` (65c6ea8f8 «Keep the passcode-derived key
// out of localStorage»). Ключ, выведенный из кода, переносится через
// перезагрузку перехода аккаунта (переключение, выход при нескольких аккаунтах,
// удаление аккаунта), чтобы не спрашивать код посреди перехода.
//
// Только `window.sessionStorage`: он живёт в пределах вкладки и умирает вместе с
// ней, так что прерванный переход не оставит ключ на диске. НЕ localStorage и не
// IndexedDB — этот ключ расшифровывает `kv__encrypted` со всеми токенами, и
// записать его на диск значит отдать всё, что код-пароль защищает, любому, кто
// прочитает профиль браузера.
//
// Расхождения с tweb:
//  1. Пишет только окно: у нас все перезагрузки перехода делает вкладка
//     (`accountTransition.ts::commandThenReload`, `useAuthGate`), воркерного
//     писателя (`ApiManager.logOut` → `passcodeKeyHandoff`) нет.
//  2. Пишет каждая перезагружающаяся вкладка, а не только единственная открытая
//     (`sidebarLeft/index.ts:906-913`): активный аккаунт у нас один на все
//     вкладки, переход перезагружает их все, и SharedWorker с ключом может его
//     не пережить.
//  3. Нет чистки старого `encryption_key` с диска (`keyHandoff.ts:52-55`): у нас
//     ключ туда никогда не писался.
import EncryptionKeyStore from '@lib/passcode/keyStore'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'

const HANDOFF_KEY = 'encryption_key_handoff'

function writeEncryptionKeyHandoff(base64Key: string) {
  try {
    window.sessionStorage.setItem(HANDOFF_KEY, base64Key)
  } catch{
    // storage can be unavailable (private mode, storage disabled) — the user just
    // gets the passcode prompt after the reload, which fails closed
  }
}

export async function saveEncryptionKeyForHandoff() {
  if(!DeferredIsUsingPasscode.isUsingPasscodeUndeferred()) return
  // ключа может ещё не быть (вкладка под замком) — не ждём его вечно
  if(!EncryptionKeyStore.getUndeferred()) return
  const base64Key = await EncryptionKeyStore.getAsBase64()
  if(!base64Key) {
    return
  }

  writeEncryptionKeyHandoff(base64Key)
}

export function takeEncryptionKeyHandoff() {
  let base64Key: string | null = null
  try {
    base64Key = window.sessionStorage.getItem(HANDOFF_KEY)
    window.sessionStorage.removeItem(HANDOFF_KEY)
  } catch{ /* storage недоступен — будет экран кода */ }

  return base64Key
}

export async function importHandoffKey(base64Key: string) {
  const keyAsBuffer = new Uint8Array(atob(base64Key).split('').map((c) => c.charCodeAt(0)))
  return crypto.subtle.importKey(
    'raw',
    keyAsBuffer,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt'],
  )
}
