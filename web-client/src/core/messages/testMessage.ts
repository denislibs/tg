// Фабрика СООБЩЕНИЯ для тестов и фикстур.
//
// Заведена по той же причине, что `core/dialogs/testDialog.ts`: после перевода
// на конструкторы у `message` появились обязательные параметры (`id`, `peer_id`,
// `date`, `message`, `pFlags`) плюс два клиентских (`peerId`, `fromId`).
// Расписывать их в каждом из полусотни тестов значит переписывать все полсотни
// на следующем шаге программы TL — и, что хуже, позволять им разойтись с формой
// провода поодиночке.
//
// Форму задаёт ОДНО место, и она же механически сверяется со схемой
// (`core/messages/message.schema.test.ts`).
import type { MessageMedia } from '../media/messageMedia'
import type { ReplyMarkup } from '../markup/replyMarkup'
import type { MessageAction } from './messageAction'
import type { MessageEntity, MessageReal, MessageReplyHeader, MessageService, MyMessage, RawMessageReal, RawMessageService } from '../models'
import { getOutputPeer } from '../peers/peerId'

export interface MessageFixture {
  /** НОМЕР в чате. Клиентское пространство: фикстуры пишут его как есть, чтобы
   *  тест читался, — приводить к серверному нужно только на отправке. */
  id: number
  peerId: PeerId
  /** автор; `undefined` — пост канала («от самого пира») */
  fromId?: PeerId
  text?: string
  /** секунды эпохи (в схеме `date:int`) */
  date?: number
  /** то же время строкой ISO — читаемее в тестах, где важна КАЛЕНДАРНАЯ дата
   *  (порядок диалогов, разделители дней). Живёт только в фикстуре: на проводе
   *  и в модели дата это `date:int`. */
  createdAt?: string
  out?: boolean
  entities?: MessageEntity[]
  media?: MessageMedia
  replyToMsgId?: number
  threadRootId?: number
  groupedId?: number
  randomId?: string
  failed?: boolean
  editDate?: number
  mediaUnread?: boolean
  /** Клавиатура сообщения. Нужна кадру правки: он несёт сообщение ЦЕЛИКОМ, а
   *  значит и разметку — прежде она ехала отдельным ключом конверта. */
  replyMarkup?: ReplyMarkup
}

/** Обычное сообщение — минимальный валидный `message`. */
export function makeMessage(f: MessageFixture): MessageReal {
  const reply: MessageReplyHeader | undefined =
    f.replyToMsgId != null || f.threadRootId != null
      ? {
          _: 'messageReplyHeader',
          ...(f.replyToMsgId != null ? { reply_to_msg_id: f.replyToMsgId } : {}),
          ...(f.threadRootId != null ? { reply_to_top_id: f.threadRootId } : {}),
        }
      : undefined
  return {
    _: 'message',
    // «Выключено» у булева флага схемы — ОТСУТСТВИЕ ключа, а не `false`.
    pFlags: {
      ...(f.out ? { out: true as const } : {}),
      ...(f.mediaUnread ? { media_unread: true as const } : {}),
    },
    id: f.id,
    peer_id: getOutputPeer(f.peerId),
    peerId: f.peerId,
    ...(f.fromId !== undefined ? { from_id: getOutputPeer(f.fromId), fromId: f.fromId } : {}),
    date: f.date ?? (f.createdAt ? Math.floor(Date.parse(f.createdAt) / 1000) : 0),
    message: f.text ?? '',
    ...(reply ? { reply_to: reply } : {}),
    ...(f.entities ? { entities: f.entities } : {}),
    ...(f.media ? { media: f.media } : {}),
    ...(f.groupedId != null ? { grouped_id: f.groupedId } : {}),
    ...(f.randomId ? { random_id: f.randomId } : {}),
    ...(f.failed ? { failed: true } : {}),
    ...(f.editDate != null ? { edit_date: f.editDate } : {}),
    ...(f.replyMarkup ? { reply_markup: f.replyMarkup } : {}),
  }
}

/** Служебное сообщение — пилюля. Текста у неё нет вовсе, есть `action`. */
export function makeServiceMessage(f: MessageFixture & { action: MessageAction }): MessageService {
  const base = makeMessage(f)
  return {
    _: 'messageService',
    pFlags: base.pFlags,
    id: base.id,
    peer_id: base.peer_id,
    peerId: base.peerId,
    ...(base.from_id ? { from_id: base.from_id, fromId: base.fromId } : {}),
    ...(base.reply_to ? { reply_to: base.reply_to } : {}),
    date: base.date,
    action: f.action,
  }
}

/** Тот же объект под общим типом окна — для списков смешанного состава. */
export const makeMyMessage = (f: MessageFixture): MyMessage => makeMessage(f)

/**
 * То же сообщение в форме ПРОВОДА — для тестов, которые кормят менеджер ответом
 * REST или кадром. Отличие ровно одно и то же, что у настоящего провода: номера
 * СЕРВЕРНЫЕ и клиентских параметров (`peerId`/`fromId`) нет.
 */
export function makeRawMessage(f: MessageFixture): RawMessageReal {
  const { peerId: _p, fromId: _f, ...wire } = makeMessage(f)
  // Приведение — из-за РЕАКЦИЙ, единственной не пройденной программой TL
  // подсистемы: у модели они плоская проекция (`ReactionCount[]`), на проводе —
  // объединение `MessageReactions`. Фикстура их не ставит, поэтому расхождение
  // здесь чисто типовое. Вложение приводить больше не надо ВОВСЕ: гео, визитка,
  // опрос, чек-лист, розыгрыш, карточка ссылки и платное медиа стали
  // конструкторами того же `media`, и форма модели совпала с формой провода.
  return wire as unknown as RawMessageReal
}

/** Служебное сообщение в форме провода — те же отличия. */
export function makeRawServiceMessage(f: MessageFixture & { action: MessageAction }): RawMessageService {
  const { peerId: _p, fromId: _f, ...wire } = makeServiceMessage(f)
  return wire as unknown as RawMessageService
}
