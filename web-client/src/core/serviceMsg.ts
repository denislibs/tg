// src/core/serviceMsg.ts
// Сервисные сообщения: бэкенд хранит в text JSON-действие (зеркало
// tweb messageAction — данные, а не готовая фраза), клиент собирает локализованный
// текст пилюли. Тот же приём, что у лога звонков (parseCallLog).
//
// tweb собирает пилюлю из УЗЛОВ, а не из строки (messageActionTextNewUnsafe):
// имена едут в `span.peer-title` (клик → профиль), ссылка на сообщение — в
// `i[data-saved-from="peerId_mid"]` (клик → переход к сообщению). Поэтому
// разбор возвращает сегменты, а `serviceMsgText` — их же, склеенные в строку
// (для превью в списке чатов, где узлы не нужны).
import { replyMediaLabel } from './messageToConvMsg'
import { peerTitle } from './peerCache'

interface ServiceAction {
  action: string
  actor_id?: number
  user_id?: number
  ttl?: number
  /** название канала (предложка постов: suggest_post_approved/rejected) */
  chat?: string
  /** закрепление (pin_message): цель + разобранное превью (tweb messageForReply) */
  msg_id?: number
  msg_seq?: number
  msg_type?: string
  /** «имя» медиа: теги аудио «название - исполнитель» либо имя файла */
  msg_name?: string
  /** текст/подпись закреплённого (обрезан бэкендом до 100 символов) */
  msg_text?: string
}

/** Кусок фразы сервисной пилюли: обычный текст, имя-пир или ссылка на сообщение.
 *
 *  У сегмента-пира ИМЕНИ НЕТ — только ссылка `peerId`. Имя собирает тот, кто
 *  рисует, из зеркала карточек (`core/peerCache.ts`), ровно как это делает узел
 *  `.peer-title` у автора бабла. Раньше здесь лежало готовое имя из JSON, и это
 *  было то же самое `display_name`, которое сняли с провода у пиров: бэкенд
 *  перестал его слать (`serviceText`, порт `messageActionChatAddUser` с
 *  `users:Vector<long>`), а фолбэк «Пользователь» остался — и каждая пилюля в
 *  группе читалась «Пользователь добавил(а) пользователя». */
export type ServiceSeg =
  | { kind: 'text'; text: string }
  | { kind: 'peer'; peerId?: number; /** только для отсутствующей ссылки */ fallback: string }
  | { kind: 'msg'; text: string; msgId?: number; seq?: number }

// Тексты — как в официальном ru-паке Telegram (ActionCreateGroup/ActionAddUser/…).
// out — сообщение отправлено текущим пользователем (для формулировок «Вы …»).
export function serviceMsgSegs(raw: string, out?: boolean): ServiceSeg[] {
  const plain = (text: string): ServiceSeg[] => [{ kind: 'text', text }]
  if (!raw.startsWith('{')) return plain(raw) // локальные сервисные строки (уже готовый текст)
  let a: ServiceAction
  try {
    a = JSON.parse(raw) as ServiceAction
  } catch {
    return plain(raw)
  }
  const t = (text: string): ServiceSeg => ({ kind: 'text', text })
  // Фолбэк применяется ТОЛЬКО когда ссылки нет вовсе (старое сообщение из
  // истории, записанное до перехода на ссылки). Когда ссылка есть, но карточка
  // ещё не приехала, фолбэк даёт `getPeerTitle` — «Удалённый аккаунт» и прочие
  // формулировки оригинала, а не выдуманное здесь слово.
  const actor: ServiceSeg = { kind: 'peer', peerId: a.actor_id, fallback: 'Пользователь' }
  const user: ServiceSeg = { kind: 'peer', peerId: a.user_id, fallback: 'пользователя' }
  switch (a.action) {
    // Предложение фото профиля (tweb messageActionSuggestProfilePhoto).
    case 'suggest_photo':
      return out
        ? plain('Вы предложили установить это фото профиля')
        : [actor, t(' предлагает вам установить это фото профиля')]
    // Решение по предложенному посту (Telegram suggested posts).
    case 'suggest_post_approved':
      return plain(
        a.chat ? `Ваш предложенный пост одобрен в канале «${a.chat}»` : 'Ваш предложенный пост одобрен',
      )
    case 'suggest_post_rejected':
      return plain(
        a.chat ? `Ваш предложенный пост отклонён в канале «${a.chat}»` : 'Ваш предложенный пост отклонён',
      )
    case 'group_create': return [actor, t(' создал(а) группу')]
    case 'add_user': return [actor, t(' добавил(а) '), user]
    case 'kick_user': return [actor, t(' удалил(а) '), user]
    case 'leave': return [actor, t(' покинул(а) группу')]
    case 'joined_by_link': return [actor, t(' присоединился(ась) к группе по ссылке-приглашению')]
    case 'edit_photo': return [actor, t(' обновил(а) фото группы')]
    case 'edit_title': return [actor, t(' изменил(а) название группы')]
    // Закрепление (tweb Chat.Service.Group.UpdatedPinnedMessage `%@ pinned "%@"`,
    // без превью — ActionPinnedNoText «un1 pinned a message»).
    case 'pin_message': {
      const preview = pinPreview(a)
      if (!preview) return [actor, t(' закрепил(а) сообщение')]
      return [
        actor,
        t(' закрепил(а) "'),
        { kind: 'msg', text: preview, msgId: a.msg_id, seq: a.msg_seq },
        t('"'),
      ]
    }
    case 'set_ttl':
      return [
        actor,
        t(a.ttl
          ? ` включил(а) автоудаление сообщений через ${ttlLabel(a.ttl)}`
          : ' отключил(а) автоудаление сообщений'),
      ]
    // Ограничение прав участника (бэкенд group_settings.go RestrictMember).
    // Конкретные снятые права в пилюле не перечисляем — их разбор живёт в
    // экране прав, а не здесь; Telegram в ленте тоже показывает сам факт.
    case 'restrict': return [actor, t(' ограничил(а) права '), user]
    // Действие есть, а ветки для него нет. Показать `raw` тут НЕЛЬЗЯ: raw —
    // это JSON, и пользователь увидел бы служебную кишку вместо фразы. Так уже
    // случалось с `restrict`, который бэкенд слал, а разбор не знал.
    default: return plain(UNSUPPORTED_ACTION)
  }
}

/** Пилюля для действия, которого этот клиент не знает (новее бэкенд). */
export const UNSUPPORTED_ACTION = 'Это действие не поддерживается вашей версией приложения'

/** Та же фраза одной строкой — для превью в списке чатов и для `ConvMsg.text`.
 *
 *  Имена пиров разрешаются здесь, а не в `serviceMsgSegs`: разбор остаётся
 *  чистым (его можно проверить без зеркала), а зависимость от зеркала живёт
 *  ровно у тех, кто рисует. Промах зеркала — не пустая строка: `peerTitle`
 *  отдаёт фолбэк оригинала. */
export function serviceMsgText(raw: string, out?: boolean): string {
  return serviceMsgSegs(raw, out).map(segText).join('')
}

/** Текст одного сегмента: у пира — имя из зеркала карточек. */
export function segText(s: ServiceSeg): string {
  if (s.kind !== 'peer') return s.text
  return s.peerId != null ? peerTitle(s.peerId) : s.fallback
}

// Превью закреплённого — как tweb messageForReply: сначала «медийная» часть
// (у аудио 🎵 + теги/имя файла, у документа имя файла, у прочего медиа — лейбл
// типа), затем текст/подпись через запятую.
function pinPreview(a: ServiceAction): string {
  const media =
    a.msg_type === 'audio' ? `🎵 ${a.msg_name || replyMediaLabel('audio')}`
    : a.msg_name || replyMediaLabel(a.msg_type)
  return [media, a.msg_text].filter(Boolean).join(', ')
}

// «1 день / 1 неделю / 1 месяц / N дней» — для пилюли set_ttl.
export function ttlLabel(seconds: number): string {
  const d = Math.round(seconds / 86400)
  if (d >= 28 && d <= 31) return '1 месяц'
  if (d === 7) return '1 неделю'
  if (d === 1) return '1 день'
  if (d >= 1) {
    const m10 = d % 10, m100 = d % 100
    const word = m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней'
    return `${d} ${word}`
  }
  return `${seconds} сек`
}
