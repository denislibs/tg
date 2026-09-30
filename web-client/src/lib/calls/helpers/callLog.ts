/**
 * Порт tweb `src/lib/calls/helpers/callLog.ts` (812502980) — модель журнала
 * звонков уровня сообщений, из которой собирается вкладка «Звонки»
 * (`components/sidebarLeft/tabs/calls.solid.tsx`).
 *
 * Список у любого клиента строится из одного и того же: служебных сообщений
 * звонков, свёрнутых в строки. Правила свёртки — tdesktop
 * `Calls::BoxController::Row::canAddItem` (calls_box_controller.cpp:279): то же
 * направление, тот же пир, тот же календарный день — применённые к потоку от
 * новых к старым.
 *
 * Расхождения с оригиналом:
 *  1. Конференц-звонков нет (`messageActionConferenceCall`, поле
 *     `conferenceMsgId`) — О-1 волны 7: на бэкенде нет конференций, провод их
 *     не производит (`backend/internal/domain/mtmessage.go:894`). Вариант
 *     объединения и его ветки в `getCallLogDirection`/`groupCallLogMessages`
 *     не переносятся — их нечем наполнить.
 *  2. `reason` у нашего `messageActionPhoneCall` необязателен
 *     (`core/messages/messageAction.ts:145`), у tweb обязателен: читается
 *     `reason?._`. Без причины и без длительности звонок — не «пропущенный»,
 *     как и у оригинала (там проверка идёт по значению причины).
 *  3. `mids` — наши клиентские `id` сообщений (`core/history/messageId.ts`),
 *     та же роль, что `mid` tweb.
 */
import type { MessageActionPhoneCall } from '@core/messages/messageAction'
import type { MessageService, MyMessage } from '@core/models'

/** Служебное действие сообщения звонка (tweb — ещё и конференции, расхождение 1). */
export type CallLogAction = MessageActionPhoneCall

export type CallLogMessage = MessageService & { action: CallLogAction }

/** tdesktop `Row::Type` (calls_box_controller.cpp:461) — что показывает стрелка. */
export type CallLogDirection = 'in' | 'out' | 'missed'

export type CallLogGroup = {
  /**
   * Имя НОВЕЙШЕГО звонка строки: подгрузка старшей страницы его не меняет,
   * поэтому строки на экране сохраняют идентичность при reconcile.
   */
  id: string
  peerId: PeerId
  direction: CallLogDirection
  video: boolean
  /** Клиентские id свёрнутых звонков, от новых к старым. */
  mids: number[]
  /** Дата (сек) новейшего звонка группы. */
  date: number
}

export function isCallLogMessage(message: MyMessage | undefined): message is CallLogMessage {
  return message?._ === 'messageService' && message.action._ === 'messageActionPhoneCall'
}

export function getCallLogDirection(message: CallLogMessage): CallLogDirection {
  // Исходящий — `out`, чем бы он ни кончился: tdesktop проверяет `out()`
  // раньше, чем смотрит на причину сброса.
  if(message.pFlags.out) {
    return 'out'
  }

  const action = message.action
  // Длительность — значит, соединились; без неё «занято» тоже пропущенный.
  return action.duration === undefined && (
    action.reason?._ === 'phoneCallDiscardReasonMissed' ||
    action.reason?._ === 'phoneCallDiscardReasonBusy'
  ) ? 'missed' : 'in'
}

/** Локальный календарный день — гранулярность, по которой группируются звонки. */
function getDayKey(dateSec: number) {
  const date = new Date(dateSec * 1000)
  return `${date.getFullYear()}_${date.getMonth()}_${date.getDate()}`
}

/**
 * Сворачивает поток звонков (от новых к старым) в строки. Несмежные звонки не
 * сливаются никогда: A → B → A остаётся тремя строками, ровно как у tdesktop
 * и Android.
 */
export function groupCallLogMessages(messages: CallLogMessage[]): CallLogGroup[] {
  const groups: CallLogGroup[] = []
  let group: CallLogGroup | undefined
  let groupDayKey: string | undefined

  for(const message of messages) {
    const direction = getCallLogDirection(message)
    const dayKey = getDayKey(message.date)

    if(
      !group ||
      group.peerId !== message.peerId ||
      group.direction !== direction ||
      groupDayKey !== dayKey
    ) {
      group = {
        id: `${message.peerId}_${message.id}`,
        peerId: message.peerId,
        direction,
        // Вид медиа строка берёт у звонка, который её открыл, то есть у
        // новейшего, — как `_st` у tdesktop.
        video: !!message.action.pFlags?.video,
        mids: [],
        date: message.date,
      }
      groupDayKey = dayKey
      groups.push(group)
    }

    group.mids.push(message.id)
  }

  return groups
}
