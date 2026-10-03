// Порт tweb `appManagers/utils/messages/isMentionUnread.ts` (tweb 812502980) — 1:1.
//
// «Непрочитанное упоминание» — пара флагов СХЕМЫ: сервер ставит упомянутому
// `pFlags.mentioned`, а пока упоминание не прочитано — ещё и
// `pFlags.media_unread`. У голосового/кружка тот же `media_unread` значит
// «не прослушано», поэтому они упоминанием по этому признаку не считаются.
import type { MyMessage } from '../models'

export default function isMentionUnread(message: MyMessage | undefined): boolean {
  if (!message) {
    return false
  }

  const media = message._ === 'message' ? message.media : undefined
  const doc = media?._ === 'messageMediaDocument' ? media.document : undefined
  return !!(
    message.pFlags.media_unread &&
    message.pFlags.mentioned &&
    (
      !doc ||
      !(['voice', 'round'] as const).includes(doc.type as 'voice' | 'round')
    )
  )
}
