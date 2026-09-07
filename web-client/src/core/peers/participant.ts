// Участник чата — конструктор `ChannelParticipant` на проводе
// (`core/managers/groupsManager.ts::ChannelParticipantWire`) и вопросы к нему.
//
// Порт четырёх утилит tweb `src/lib/appManagers/utils/chats/`:
//   • `getParticipantPeerId.ts` — ключ пира участника;
//   • `getParticipantRank.ts` — ранг для правого слота строки;
//   • `isParticipantAdmin.ts` — `isParticipantCreator` / `isParticipantAdmin`;
//   • `canEditAdmin.ts` — могу ли я править права этого админа.
//
// Объём — конструкторы, которые производит наш бэкенд
// (`backend/internal/domain/mtparticipant.go`): `channelParticipant*`. Ветки
// `chatParticipant*` (legacy-чат) отброшены — базовый `chat` бэкенд не
// производит вовсе (решение №2 разбора, `core/peers/peerId.ts::getOutputPeer`).
//
// Расхождения с оригиналом, навязанные проводом:
//   • `rank` (пользовательская подпись админа, `channelParticipantAdmin.rank`)
//     на проводе нет — бэкенд собирает конструктор без него (`mtparticipant.go:
//     104-126`), поэтому `getParticipantRank` отдаёт только 1 (создатель) /
//     2 (админ) / `undefined`;
//   • `promoted_by`/`inviter_id` — тоже нет; `canEditAdmin` поэтому отвечает
//     «да» только создателю чата (разбор у самой функции).
import type { ChannelParticipantWire } from '@core/managers/groupsManager'
import { getPeerId, toPeerId } from './peerId'
import type { Chat } from './peer'

export type ChannelParticipant = ChannelParticipantWire

/** Порт `getParticipantPeerId` (:4-12): у выгнанного/ушедшего ключ лежит в
 *  ссылке на пир, у остальных — в `user_id`. */
export function getParticipantPeerId(participant: PeerId | ChannelParticipant): PeerId {
  if(typeof participant !== 'object') {
    return participant
  }

  return 'peer' in participant ?
    getPeerId(participant.peer) :
    toPeerId(participant.user_id, false)
}

/** Порт `getParticipantRank` (:3-7) без ветки `rank` (см. шапку). */
export function getParticipantRank(participant: ChannelParticipant): 1 | 2 | undefined {
  return participant._ === 'channelParticipantAdmin' ? 2 :
    (participant._ === 'channelParticipantCreator' ? 1 : undefined)
}

export const participantCreatorPredicates: Set<ChannelParticipant['_']> = new Set([
  'channelParticipantCreator',
])

export const participantAdminPredicates: Set<ChannelParticipant['_']> = new Set([
  ...Array.from(participantCreatorPredicates),
  'channelParticipantAdmin',
])

export const isParticipantCreator = (participant: ChannelParticipant | undefined) =>
  !!participant && participantCreatorPredicates.has(participant._)

export const isParticipantAdmin = (participant: ChannelParticipant | undefined) =>
  !!participant && participantAdminPredicates.has(participant._)

/**
 * Порт `canEditAdmin` (:4-11): создатель чата правит любого админа; иначе —
 * не-создателя, которого назначил я (`promoted_by === myId`).
 *
 * `promoted_by`/`inviter_id` на проводе нет (шапка), а в схеме оригинала
 * `promoted_by` у админа ОБЯЗАТЕЛЕН — то есть ветка `!promotedBy` там не
 * срабатывает никогда, и «назначил ли его я» решает сравнение с моим id.
 * Нам сравнивать нечего: неизвестное читается как «нет», остаётся первая
 * половина условия. Аргументов `participant`/`myId` поэтому нет — они читались
 * только во второй половине.
 */
export function canEditAdmin(chat: Chat | undefined) {
  return !!chat && chat._ !== 'chatEmpty' && chat._ !== 'chatForbidden' && chat._ !== 'channelForbidden' && !!chat.pFlags?.creator
}
