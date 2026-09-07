// Порт tweb `src/components/wrappers/participantRank.ts` — подпись ранга
// участника для правого слота заголовка строки (`SortedUserList`, tweb :63, :90).
//
// Числовой ранг — ключ словаря (`owner`/`admin`; `0` — `channel`), строковый —
// пользовательская подпись через `wrapEmojiText`. На нашем проводе строкового
// ранга не бывает (`core/peers/participant.ts`, шапка), но форма сохранена:
// это тот же контракт, что у оригинала.
import { i18n } from '@lib/langPack'
import { wrapEmojiText } from '@lib/richtext'
import { getParticipantRank, type ChannelParticipant } from '@core/peers/participant'

export default function wrapParticipantRank(rank: ChannelParticipant | ReturnType<typeof getParticipantRank> | string | 0) {
  if(typeof rank === 'object') {
    rank = getParticipantRank(rank)
  }

  return typeof rank === 'number' ?
    i18n(!rank ? 'Chat.ChannelBadge' : (rank === 1 ? 'Chat.OwnerBadge' : 'ChatAdmin')) :
    wrapEmojiText(rank ?? '')
}
