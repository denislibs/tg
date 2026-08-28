// src/core/serviceMsg.ts
//
// Пилюля служебного сообщения: `messageService.action` → локализованная фраза.
//
// ── Что здесь изменилось ────────────────────────────────────────────────────
// Разбора JSON больше НЕТ. Действие ехало строкой внутри текста, и клиент
// опознавал его по `raw.startsWith('{')` — дискриминатор был подделан дважды.
// Теперь это объединение конструкторов, и ветвление идёт по `_`, как везде
// (`core/messages/messageAction.ts`).
//
// Вместе с JSON ушли три серверные склейки:
//  • ИМЕНА (`actor`, `user`, `chat` строками рядом с идентификаторами) — их
//    собирает клиент из зеркала карточек, ровно как имя автора бабла;
//  • ПРЕВЬЮ ЗАКРЕПЛЁННОГО (`msg_name`, `msg_text`, обрезанный до 100 символов
//    НА СЕРВЕРЕ) — у `messageActionPinMessage` нет ни одного параметра, цель
//    находится по `reply_to`, а превью строит клиент;
//  • ГОТОВАЯ ФРАЗА создания темы форума («%s создал(а) тему «%s»»).
//
// tweb собирает пилюлю из УЗЛОВ, а не из строки (`messageActionTextNewUnsafe`):
// имена едут в `span.peer-title` (клик → профиль), ссылка на сообщение — в
// `i[data-saved-from]` (клик → переход). Поэтому разбор возвращает сегменты, а
// `serviceMsgText` — их же, склеенные в строку (для превью в списке чатов, где
// узлы не нужны).
import { peerTitle } from './peerCache'
import type { MessageAction } from './messages/messageAction'
import type { MessageService, MyMessage } from './models'

/** Кусок фразы сервисной пилюли: обычный текст, имя-пир или ссылка на сообщение.
 *
 *  У сегмента-пира ИМЕНИ НЕТ — только ссылка `peerId`. Имя собирает тот, кто
 *  рисует, из зеркала карточек (`core/peerCache.ts`), ровно как это делает узел
 *  `.peer-title` у автора бабла. */
export type ServiceSeg =
  | { kind: 'text'; text: string }
  | { kind: 'peer'; peerId?: PeerId; /** только для отсутствующей ссылки */ fallback: string }
  | { kind: 'msg'; text: string; msgId?: number }

const t = (text: string): ServiceSeg => ({ kind: 'text', text })

/** Пилюля для действия, которого этот клиент не знает (новее бэкенд). */
export const UNSUPPORTED_ACTION = 'Это действие не поддерживается вашей версией приложения'

/**
 * Фраза пилюли сегментами. `pinnedPreview` — превью ЗАКРЕПЛЁННОГО сообщения,
 * которое собрал вызывающий: цель лежит в `reply_to` самого служебного
 * сообщения, а разрешает ссылку тот, у кого есть окно (у оригинала это
 * `wrapMessageForReply(getMessageByPeer(...))`).
 */
export function serviceMsgSegs(m: MessageService, pinnedPreview?: string): ServiceSeg[] {
  const out = !!m.pFlags.out
  const plain = (text: string): ServiceSeg[] => [t(text)]
  // Фолбэк применяется ТОЛЬКО когда ссылки нет вовсе. Когда ссылка есть, но
  // карточка ещё не приехала, фолбэк даёт `getPeerTitle` — «Удалённый аккаунт»
  // и прочие формулировки оригинала, а не выдуманное здесь слово.
  const actor: ServiceSeg = { kind: 'peer', peerId: m.fromId, fallback: 'Пользователь' }
  const user = (id: number): ServiceSeg => ({ kind: 'peer', peerId: id, fallback: 'пользователя' })
  const a: MessageAction = m.action
  switch (a._) {
    case 'messageActionChatCreate': return [actor, t(' создал(а) группу «'), t(a.title), t('»')]
    case 'messageActionChatAddUser': return [actor, t(' добавил(а) '), ...users(a.users)]
    // Синтетические конструкторы — их производит уточнение на границе разбора
    // (`refineMessageAction`), сервер шлёт один `messageActionChatAddUser`.
    case 'messageActionChatAddUsers': return [actor, t(' добавил(а) '), ...users(a.users)]
    case 'messageActionChatJoined': return [actor, t(' присоединился(ась) к группе')]
    case 'messageActionChatJoinedYou': return plain('Вы присоединились к группе')
    case 'messageActionChatDeleteUser': return [actor, t(' удалил(а) '), user(a.user_id)]
    case 'messageActionChatLeave': return [actor, t(' покинул(а) группу')]
    // `inviter_id` — СОЗДАТЕЛЬ ссылки; вошедший это `from_id` самого сообщения.
    case 'messageActionChatJoinedByLink':
      return [actor, t(' присоединился(ась) к группе по ссылке-приглашению от '), user(a.inviter_id)]
    case 'messageActionChatEditPhoto': return [actor, t(' обновил(а) фото группы')]
    // Новое название теперь ЕДЕТ (прежде в действии был один actor_id, и пилюля
    // читалась «Имя изменил(а) название группы» без названия).
    case 'messageActionChatEditTitle': return [actor, t(' изменил(а) название группы на «'), t(a.title), t('»')]
    case 'messageActionTopicCreate': return [actor, t(' создал(а) тему «'), t(a.title), t('»')]
    // Закрепление (tweb Chat.Service.Group.UpdatedPinnedMessage `%@ pinned "%@"`,
    // без превью — ActionPinnedNoText «un1 pinned a message»).
    case 'messageActionPinMessage': {
      if (!pinnedPreview) return [actor, t(' закрепил(а) сообщение')]
      return [
        actor,
        t(' закрепил(а) "'),
        { kind: 'msg', text: pinnedPreview, msgId: m.reply_to?.reply_to_msg_id },
        t('"'),
      ]
    }
    case 'messageActionSetMessagesTTL':
      return [
        actor,
        t(a.period
          ? ` включил(а) автоудаление сообщений через ${ttlLabel(a.period)}`
          : ' отключил(а) автоудаление сообщений'),
      ]
    // Предложение фото профиля (tweb messageActionSuggestProfilePhoto).
    case 'messageActionSuggestProfilePhoto':
      return out
        ? plain('Вы предложили установить это фото профиля')
        : [actor, t(' предлагает вам установить это фото профиля')]
    // Решение по предложенному посту. Канал едет ССЫЛКОЙ — имя собирает клиент.
    case 'messageActionSuggestedPostApproval': {
      const verb = a.pFlags?.rejected ? ' отклонён' : ' одобрен'
      if (a.channel_id === undefined) return plain(`Ваш предложенный пост${verb}`)
      return [t('Ваш предложенный пост'), t(`${verb} в канале `), { kind: 'peer', peerId: a.channel_id, fallback: 'канале' }]
    }
    // Ограничение прав участника — НАШ конструктор (в схеме предмета нет).
    // Конкретные снятые права в пилюле не перечисляем: их разбор живёт в экране
    // прав, а Telegram в ленте тоже показывает сам факт.
    case 'messageActionRestrict': return [actor, t(' ограничил(а) права '), user(a.user_id)]
    // Клиентская плашка ветки комментариев — её ставит витрина треда.
    case 'messageActionDiscussionStarted': return plain('Обсуждение началось')
    // Лог звонка пилюлей не рисуется — у него свой бабл (`MessageKind` 'call').
    case 'messageActionPhoneCall': return plain('')
    // Конструктор есть, а ветки для него нет: показать сырой объект тут НЕЛЬЗЯ —
    // пользователь увидел бы служебную кишку вместо фразы.
    default: return plain(UNSUPPORTED_ACTION)
  }
}

/** Список добавленных — ссылками, а не именами. */
function users(ids: number[]): ServiceSeg[] {
  const out: ServiceSeg[] = []
  ids.forEach((id, i) => {
    if (i) out.push(t(', '))
    out.push({ kind: 'peer', peerId: id, fallback: 'пользователя' })
  })
  return out
}

/** Та же фраза одной строкой — для превью в списке чатов и для `ConvMsg.text`.
 *
 *  Имена пиров разрешаются здесь, а не в `serviceMsgSegs`: разбор остаётся
 *  чистым (его можно проверить без зеркала), а зависимость от зеркала живёт
 *  ровно у тех, кто рисует. Промах зеркала — не пустая строка: `peerTitle`
 *  отдаёт фолбэк оригинала. */
export function serviceMsgText(m: MessageService, pinnedPreview?: string): string {
  return serviceMsgSegs(m, pinnedPreview).map(segText).join('')
}

/** Текст одного сегмента: у пира — имя из зеркала карточек. */
export function segText(s: ServiceSeg): string {
  if (s.kind !== 'peer') return s.text
  return s.peerId != null ? peerTitle(s.peerId) : s.fallback
}

/** Пилюля ли это вообще — вопрос к КОНСТРУКТОРУ, а не к строковому полю. */
export function isServicePill(m: MyMessage): m is MessageService {
  return m._ === 'messageService' && m.action._ !== 'messageActionPhoneCall'
}

// «1 день / 1 неделю / 1 месяц / N дней» — для пилюли автоудаления.
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
