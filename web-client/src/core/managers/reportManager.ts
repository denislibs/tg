import type { RestClient } from '../net/restClient'

// Жалобы на чат/сообщение (tweb reportMessages / reportPeer). Модерации нет —
// бэкенд просто складирует обращение. msgId не задан → жалоба на чат целиком.

// ReportReason — причина из белого списка (совпадает с backend domain.ReportReason).
export type ReportReason = 'spam' | 'violence' | 'porn' | 'child_abuse' | 'other'

export interface ReportArgs {
  chatId: number
  msgId?: number
  reason: ReportReason
  comment?: string
}

export function newReportManager({ rest }: { rest: Pick<RestClient, 'post'> }) {
  return {
    async report(a: ReportArgs): Promise<void> {
      await rest.post('/report', {
        chat_id: a.chatId,
        msg_id: a.msgId ?? null,
        reason: a.reason,
        comment: a.comment ?? '',
      })
    },
  }
}

export type ReportManager = ReturnType<typeof newReportManager>
