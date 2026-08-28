// Настройки уведомлений ПИРА в форме оригинала — конструктор схемы
// `peerNotifySettings`, а не булево «замьючен» рядом со строкой звука.
//
// Зеркало `backend/internal/domain/mtdialog.go` (шаги A–B программы TL) — то же
// самое с той стороны провода. Правила фазы 0 (дискриминатор `_`, «выключено»
// это отсутствие ключа) — в шапке `core/peers/peer.ts`.
//
// ── Зачем: мьют это СРОК, а не признак ──────────────────────────────────────
// На проводе у нас было `muted: bool`, и это тот же дефект, что был у
// присутствия: признак без срока годности. Цепочка при этом уже была построена
// целиком — UI предлагает «заглушить на час», клиент шлёт срок, бэкенд его
// хранит, — и терял её ровно провод: «на час» работало как «навсегда».
//
// В схеме механизм один: `mute_until` — unix-секунды, ДО которых молчим.
// «Навсегда» это не отдельный флаг, а далёкий срок (`MUTE_UNTIL_FOREVER`),
// «снять» — отсутствие переопределения. Предикат «замьючен ли СЕЙЧАС» здесь
// один — `isPeerMuted`, порт `appNotificationsManager.isMuted` (`:255`).

/**
 * «Замьючено навсегда» — порт tweb `MUTE_UNTIL` (`appManagers/constants.ts:15`)
 * и `domain.MuteUntilForever` бэкенда. Число обязано совпадать с оригиналом
 * побайтово: по нему клиент ОТЛИЧАЕТ «навсегда» от «до такого-то часа».
 */
export const MUTE_UNTIL_FOREVER = 0x7fffffff

/** notificationSoundDefault#97e8bebe = NotificationSound; */
export interface NotificationSoundDefault { _: 'notificationSoundDefault' }
/** notificationSoundNone#6f0c34df = NotificationSound; — уведомление приходит,
 *  просто молча. Это НЕ мьют. */
export interface NotificationSoundNone { _: 'notificationSoundNone' }

/**
 * NotificationSound — объединение схемы. Производим ровно те два конструктора, у
 * которых есть предмет (наш `notify_sound` принимает `'default'`/`'none'`);
 * `notificationSoundLocal`/`notificationSoundRingtone` не объявляются вовсе — ни
 * хранилища рингтонов, ни экрана их выбора у нас нет, а параметр `other_sound`
 * необязательный, поэтому пропуск бесплатен.
 */
export type NotificationSound = NotificationSoundDefault | NotificationSoundNone

/**
 * peerNotifySettings#99622c0c flags:# show_previews:flags.0?Bool
 * silent:flags.1?Bool mute_until:flags.2?int … other_sound:flags.5?NotificationSound
 * … = PeerNotifySettings;
 *
 * Пер-чатное ПЕРЕОПРЕДЕЛЕНИЕ поверх настроек типа чата (`stores/notifyStore.ts`).
 * Все параметры необязательные, и отсутствие ключа значит «переопределения
 * нет», — поэтому `false` и «не задано» здесь разные ответы.
 *
 * `show_previews`/`silent` объявлены в схеме как `flags.N?Bool`, а НЕ как
 * `flags.N?true`: это не булевы флаги, их место на верхнем уровне, а не в
 * `pFlags`, и они умеют нести явное `false`.
 *
 * Чего нет и почему: `ios_sound`/`android_sound` — звук мобильных клиентов, у
 * нас клиент один и его звук это `other_sound`; `stories_*` — подсистемы
 * историй в этом порту нет.
 */
export interface PeerNotifySettings {
  _: 'peerNotifySettings'
  /** показывать ли текст сообщения в уведомлении */
  show_previews?: boolean
  /** уведомлять без звука */
  silent?: boolean
  /** unix-секунды, ДО которых молчим: `MUTE_UNTIL_FOREVER` — навсегда */
  mute_until?: number
  /** звук уведомления — ОБЪЕДИНЕНИЕ, а не строка `'default'`/`'none'` */
  other_sound?: NotificationSound
}

/**
 * Замьючен ли пир В ЭТОТ МОМЕНТ — порт `appNotificationsManager.isMuted`
 * (`appNotificationsManager.ts:255`): `silent || mute_until * 1000 > tsNow()`.
 *
 * `now` — аргумент (unix-секунды), чтобы предикат оставался чистым и
 * проверяемым тестом, ровно как `isUserStatusOnline` у присутствия. Сам срок
 * гасит владелец диалогов (`dialogsManager.checkMuteUntil`, порт того же
 * `appNotificationsManager.ts:162-218`) — иначе иконка мьюта не погасла бы в
 * назначенный час.
 */
export function isPeerMuted(settings: PeerNotifySettings | undefined, now: number): boolean {
  if (!settings) return false
  if (settings.silent) return true
  return settings.mute_until !== undefined && settings.mute_until > now
}

/** Пустой конструктор: «переопределений у этого пира нет». Обязателен по схеме
 *  — «настроек нет» выражается пустым конструктором, а не отсутствием поля. */
export const EMPTY_NOTIFY_SETTINGS: PeerNotifySettings = { _: 'peerNotifySettings' }
