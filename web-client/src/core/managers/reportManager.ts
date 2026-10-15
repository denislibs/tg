import type { RestClient } from '../net/restClient'
import { getServerMessageId } from '../history/messageId'

// Жалобы на чат/сообщения (tweb reportMessages / reportPeer). Модерации нет —
// бэкенд просто складирует обращение. mids пуст → жалоба на чат целиком
// (messages.report{id: []}, tweb reportAd.tsx:372).

// ReportReason — причина из белого списка (совпадает с backend domain.ReportReason).
export type ReportReason = 'spam' | 'violence' | 'porn' | 'child_abuse' | 'other'

export interface ReportArgs {
  peerId: number
  /** КЛИЕНТСКИЕ mid выбранных сообщений; пусто — жалоба на чат */
  mids: number[]
  reason: ReportReason
  comment?: string
}

export function newReportManager({ rest }: { rest: Pick<RestClient, 'post'> }) {
  return {
    async report(a: ReportArgs): Promise<void> {
      await rest.post('/report', {
        peer_id: a.peerId,
        // на провод — вектор СЕРВЕРНЫХ номеров (messages.report.id,
        // tweb appMessagesManager.ts:7807-7827)
        id: a.mids.map(getServerMessageId),
        reason: a.reason,
        comment: a.comment ?? '',
      })
    },
  }
}

export type ReportManager = ReturnType<typeof newReportManager>
