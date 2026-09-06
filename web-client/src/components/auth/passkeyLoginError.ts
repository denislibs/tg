/**
 * Разбор отказа входа по ключу доступа — ОДИН на обе стартовые карточки.
 *
 * У tweb кнопка входа по passkey это отдельный компонент
 * (`src/components/passkeyLoginButton.tsx`), который обе карточки — и `signQR`
 * (`pages/cards/SignQRCard.tsx:242`), и `signIn`
 * (`pages/cards/SignInCard.tsx`) — просто вставляют; разбор ошибки живёт в
 * нём одном (`passkeyLoginButton.tsx:68-80`). У нас кнопка нарисована прямо в
 * карточках (текст берётся из РАЗНЫХ ключей: `Login.Passkey` со стрелкой на
 * QR-карточке, `Login.Passkey.Action` на карточке номера), а вот разбор
 * отказа — предмет один, и лежит он здесь, а не копией в каждой карточке.
 *
 * Что делает оригинал (`passkeyLoginButton.tsx:68-80`):
 *   • `SESSION_PASSWORD_NEEDED` (:69-71) → карточка пароля;
 *   • `PASSKEY_CREDENTIAL_NOT_FOUND` (:72-74) → тост `Login.Passkey.Error.NotFound`;
 *   • всё прочее (:75-76) → тост `Login.Passkey.Error`.
 * Молча не гасится НИЧЕГО — в том числе отмена системного диалога WebAuthn.
 *
 * Что из этого есть у нас:
 *   • `SESSION_PASSWORD_NEEDED` — предмета НЕТ: наш `/auth/passkey/finish`
 *     выдаёт сессию без второго фактора
 *     (`backend/internal/usecase/auth/password.go:101-109`,
 *     `MintPasskeySession` — «второй фактор не спрашивается, как в Telegram»),
 *     то есть до карточки пароля этот путь не доходит в принципе;
 *   • `PASSKEY_CREDENTIAL_NOT_FOUND` — отличить НЕЧЕМ: бэкенд отвечает одним
 *     `401 «passkey login failed»` на любой отказ проверки
 *     (`backend/internal/adapter/delivery/http/passkey_handler.go:244-247`),
 *     отдельного имени отказа на проводе нет. Поэтому ключ
 *     `Login.Passkey.Error.NotFound` не заводится: пустой ключ в словаре хуже,
 *     чем его отсутствие.
 * Остаётся общая ветка — тост `Login.Passkey.Error` (текст 1:1 с tweb
 * `langSign.ts:36`) плюс след в консоли.
 *
 * ── Почему отмена диалога тоже показывается ────────────────────────────────
 * `navigator.credentials.get` бросает `NotAllowedError` И когда пользователь
 * закрыл системный диалог, И когда подходящего ключа на устройстве нет вовсе
 * (discoverable-логин): браузер намеренно не различает эти случаи, чтобы не
 * отдавать сайту факт наличия ключа. Значит «тихо погасить NotAllowedError как
 * отмену» означало бы погасить и «ключей нет» — ровно ту тишину, из-за которой
 * кнопка выглядела сломанной. Оригинал этой ветки тоже не делает.
 */
import { toastNew } from '@components/toast'

export function reportPasskeyLoginError(where: string, err: unknown): void {
  console.error(`${where}: passkey login error:`, err)
  toastNew({ langPackKey: 'Login.Passkey.Error' })
}
