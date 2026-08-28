// Порт tweb `src/global.d.ts` — расширения DOM-интерфейсов, на которых держатся
// портированные императивные компоненты, и глобальные типы, на которые ссылается
// сгенерированный `layer.d.ts`. Довозим по мере появления потребителей,
// а не весь файл разом.
//
// `HTMLElement.middlewareHelper` — механизм оригинала: узел САМ носит свой
// middleware-хелпер, и тот, кто узел удаляет, тут же его и рушит
// (`components/wrappers/mediaSpoiler.ts`: `mediaSpoiler.middlewareHelper.destroy()`).
// Без этого поля владение временем жизни спойлера пришлось бы держать в
// сторонней карте, чего в оригинале нет.
import type { MiddlewareHelper } from '@helpers/middleware'
import type { CancellablePromise as CancellablePromiseImpl } from '@helpers/cancellablePromise'
import type { Chat, Document, User } from '@layer'

declare global {
  interface HTMLElement {
    middlewareHelper?: MiddlewareHelper
  }

  // ── Глобальные типы, на которые ссылается `layer.d.ts` ────────────────────
  //
  // Сгенерированный `layer.d.ts` импортов не содержит вовсе — он рассчитывает,
  // что эти имена объявлены глобально (так же устроен оригинал). При
  // `skipLibCheck: true` висячая ссылка НЕ ловится тайпчеком и молча делает поле
  // нетипизированным, поэтому набор проверяется отдельным прогоном:
  // `scripts/check-layer-types.mjs`.
  //
  // Блок ниже — выдержка из tweb `src/global.d.ts` (строки 123-133, 143-147,
  // 153-163, 165-276, 282-289), перенесённая дословно.

  type UserId = User.user['id'];
  type ChatId = Chat.chat['id'];
  // type PeerId = `u${UserId}` | `c${ChatId}`;
  // type PeerId = `${UserId}` | `-${ChatId}`;
  type PeerId = number;
  // type PeerId = number;
  type BotId = UserId;
  type DocId = Document.document['id'];
  type Long = string | number;
  // `int256` в схеме есть (методы DH-обмена MTProto), а объявления типа в
  // оригинале нет — кодогенератор его не разбирает и печатает имя как есть.
  // Ещё одна висячая ссылка из-под `skipLibCheck`. Значение берём из
  // `tl_utils.ts:646`: `fetchIntBytes(256, true)` возвращает `Uint8Array`.
  type int256 = Uint8Array;
  type MTLong = string;
  // `MTAppConfig = AppConfig` из оригинала не переносим: подсистемы appConfig у
  // нас пока нет, а на `layer.d.ts` это имя не влияет. Появится подсистема —
  // вернём строку.

  // В оригинале `CancellablePromise` объявлен НЕ глобально — он импортируется в
  // `global.d.ts` и потому виден только внутри него, тогда как `layer.d.ts`
  // ссылается на него как на глобальный (`message.promise`). Ещё одна висячая
  // ссылка, спрятанная за `skipLibCheck`. Чиним псевдонимом.
  type CancellablePromise<T> = CancellablePromiseImpl<T>;

  type MTMimeType = 'video/quicktime' | 'image/gif' | 'image/jpeg' | 'application/pdf' |
    'video/mp4' | 'image/webp' | 'audio/mpeg' | 'audio/ogg' | 'application/octet-stream' |
    'application/x-tgsticker' | 'video/webm' | 'image/svg+xml' | 'image/png' | 'application/json' |
    'application/x-tgwallpattern' | 'audio/wav' | 'image/avif' | 'image/jxl' | 'image/bmp' |
    'application/x-mpegurl' | 'application/x-tgstoryboard' | 'application/x-tgstoryboardmap';

  type ApiFileManagerError = 'DOWNLOAD_CANCELED' | 'UPLOAD_CANCELED' | 'FILE_TOO_BIG' | 'REFERENCE_IS_NOT_REFRESHED';
  type StorageError = 'STORAGE_OFFLINE' | 'NO_ENTRY_FOUND' | 'IDB_CREATE_TIMEOUT';
  // ОТСТУПЛЕНИЕ от оригинала, единственное в этом блоке. В tweb этот псевдоним
  // назван `ReferenceError` и тем самым перекрывает встроенный глобальный
  // `ReferenceError` из lib.es5 — TS сообщает об этом как о error TS2300
  // «Duplicate identifier», просто в оригинале ошибка спрятана за
  // `skipLibCheck`. Имя используется ровно в одном месте (`LocalFileError`
  // ниже), поэтому переименование локально и ничего не тянет.
  type MTReferenceError = 'NO_NEW_CONTEXT' | 'NO_CONTEXT';
  type NetworkerError = 'NETWORK_BAD_RESPONSE' | 'NETWORK_BAD_REQUEST';
  type FiltersError = 'PINNED_DIALOGS_TOO_MUCH';
  type LottieError = 'FRAME_OUT_OF_RANGE' | 'ITEM_DESTROYED' | 'FILE_INVALID';

  type LocalFileError = ApiFileManagerError | MTReferenceError | StorageError;
  type LocalErrorType = LocalFileError | NetworkerError | FiltersError | LottieError |
    'UNKNOWN' | 'NO_DOC' | 'MIDDLEWARE' | 'PORT_DISCONNECTED' | 'NO_AUTO_DOWNLOAD' | 'CHAT_PRIVATE' | 'NO_WASM' |
    'CANCELED' | 'TIMEOUT' | 'TAB_ALREADY_OPEN' |
    // Наше, сверх набора оригинала: `appDownloadManager.ts:99` — ответ
    // медиа-эндпоинта не 2xx либо без тела. У tweb этой ветки нет, потому что
    // файл там приходит не по HTTP. Отдельным термом, чтобы было видно, что
    // добавлено нами, а не потеряно при переносе.
    'NO_FILE';

  type ServerErrorType =
    | 'FILE_REFERENCE_EXPIRED'
    | 'SESSION_REVOKED'
    | 'AUTH_KEY_DUPLICATED'
    | 'SESSION_PASSWORD_NEEDED'
    | 'CONNECTION_NOT_INITED'
    | 'ERROR_EMPTY'
    | 'MTPROTO_CLUSTER_INVALID'
    | 'BOT_PRECHECKOUT_TIMEOUT'
    | 'TMP_PASSWORD_INVALID'
    | 'PASSWORD_HASH_INVALID'
    | 'CHANNEL_PRIVATE'
    | 'VOICE_MESSAGES_FORBIDDEN'
    | 'PHOTO_INVALID_DIMENSIONS'
    | 'PHOTO_SAVE_FILE_INVALID'
    | 'USER_ALREADY_PARTICIPANT'
    | 'USERNAME_INVALID'
    | 'USERNAME_PURCHASE_AVAILABLE'
    | 'USERNAMES_ACTIVE_TOO_MUCH'
    | 'BOT_INVALID'
    | 'USERNAME_NOT_OCCUPIED'
    | 'PINNED_TOO_MUCH'
    | 'LOCATION_INVALID'
    | 'FILE_ID_INVALID'
    | 'CHANNEL_FORUM_MISSING'
    | 'TRANSCRIPTION_FAILED'
    | 'USER_NOT_PARTICIPANT'
    | 'PEER_ID_INVALID'
    | 'MSG_VOICE_MISSING'
    | 'CHAT_ADMIN_REQUIRED'
    | 'QUERY_ID_INVALID'
    | 'CHAT_ADMIN_INVITE_REQUIRED'
    | 'BOT_APP_INVALID'
    | 'FILTER_NOT_SUPPORTED'
    | 'INVITES_TOO_MUCH'
    | 'AICOMPOSE_FLOOD_PREMIUM'
    | 'AICOMPOSE_TONE_SLUG_INVALID'
    | 'AICOMPOSE_TONE_INVALID'
    | 'TONE_NOT_FOUND'
    | 'FILTERS_TOO_MUCH'
    | 'PEERS_LIST_EMPTY'
    | 'INVITE_SLUG_EXPIRED'
    | 'DIALOG_FILTERS_TOO_MUCH'
    | 'CHATLISTS_TOO_MUCH'
    | 'FRESH_RESET_AUTHORISATION_FORBIDDEN'
    | 'NO_USER'
    | 'USER_PRIVACY_RESTRICTED'
    | 'REACTION_INVALID'
    | 'INVITE_HASH_EXPIRED'
    | 'PHONE_NOT_OCCUPIED'
    | 'PARTICIPANT_ID_INVALID'
    | 'PREMIUM_ACCOUNT_REQUIRED'
    | 'BOOST_NOT_MODIFIED'
    | 'PREMIUM_GIFTED_NOT_ALLOWED'
    | `FLOOD_WAIT_${number}`
    | 'MESSAGE_NOT_MODIFIED'
    | 'MESSAGE_EMPTY'
    | 'MESSAGE_ID_REQUIRED'
    | 'SLUG_INVALID'
    | `PREMIUM_SUB_ACTIVE_UNTIL_${number}`
    | `PHONE_MIGRATE_${number}`
    | `NETWORK_MIGRATE_${number}`
    | `USER_MIGRATE_${number}`
    | `STATS_MIGRATE_${number}`
    | `FILE_MIGRATE_${number}`
    | `CALL_MIGRATE_${number}`
    | 'MSG_WAIT_FAILED'
    | 'MSG_WAIT_TIMEOUT'
    | 'SAVED_DIALOGS_UNSUPPORTED'
    | 'YOUR_PRIVACY_RESTRICTED'
    | 'INVITE_REQUEST_SENT'
    | 'GROUPCALL_INVALID'
    | 'TIME_TOO_BIG'
    | 'TIME_TOO_SMALL'
    | 'TIME_INVALID'
    | 'GROUPCALL_FORBIDDEN'
    | 'VIDEO_CHANNEL_INVALID'
    | 'GROUPCALL_JOIN_MISSING'
    | `SLOWMODE_WAIT_${number}`
    | 'BALANCE_TOO_LOW'
    | 'FORM_EXPIRED'
    | `FLOOD_PREMIUM_WAIT_${number}`
    | 'STORY_ID_TOO_MANY'
    | `FILE_REFERENCE_${number}_EXPIRED`
    | 'ADDRESS_STREET_LINE1_INVALID'
    | 'ADDRESS_STREET_LINE2_INVALID'
    | 'ADDRESS_COUNTRY_INVALID'
    | 'ADDRESS_CITY_INVALID'
    | 'ADDRESS_STATE_INVALID'
    | 'ADDRESS_POSTCODE_INVALID'
    | 'REQ_INFO_NAME_INVALID'
    | 'REQ_INFO_EMAIL_INVALID'
    | 'REQ_INFO_PHONE_INVALID'
    | 'FILE_REFERENCE_INVALID'
    | 'USER_NOT_MUTUAL_CONTACT'
    | 'FROZEN_METHOD_INVALID'
    | 'EMAIL_INVALID'
    | 'EMAIL_NOT_ALLOWED'
    | 'EMAIL_VERIFY_EXPIRED'
    | 'CODE_INVALID'
    | 'PASSWORD_RECOVERY_NA'
    | '2FA_RECENT_CONFIRM'
    | `2FA_CONFIRM_WAIT_${number}`
    | 'PASSKEY_CREDENTIAL_NOT_FOUND'
    | 'SUMMARY_FLOOD_PREMIUM'
    | 'AUTH_TOKEN_EXPIRED'
    | 'CHANNELS_TOO_MUCH'
    | 'BOOSTS_REQUIRED'
    | 'USERNAME_OCCUPIED'
  ;

  type ErrorType = LocalErrorType | ServerErrorType;

  type ApiError = {
    type: ErrorType,
    stack?: string,
    message?: string,
    code?: number,
    handled?: boolean,
    originalError?: any,
  };

  // `MessagesStorageKey` в оригинале объявлен не здесь, а экспортом
  // `appMessagesManager.ts:207` — при этом `layer.d.ts` ссылается на него как на
  // глобальный. У самого tweb это висячая ссылка, незаметная из-за
  // `skipLibCheck`. Определение взято оттуда дословно, положено туда, где оно
  // разрешается.
  type MessagesStorageType = 'history' | 'scheduled';
  type MessagesStorageKey = `${PeerId}_${MessagesStorageType}`;
}

export {}
