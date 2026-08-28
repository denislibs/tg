import type { Transport } from '../transport'
import { HttpError } from '../restClient'

const RPC_TIMEOUT_MS = 30_000

interface Pending {
  resolve: (v: { status: number; body: unknown }) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// ChannelRpc туннелит REST через DNP-канал: rpc_req → rpc_resp с корреляцией по req_id.
// Активен только при DNP-ON; RestClient зовёт его лишь когда канал готов (isReady).
export class ChannelRpc {
  private pending = new Map<string, Pending>()
  private seq = 0

  constructor(private transport: Transport) {
    transport.onFrame((t, d) => { if (t === 'rpc_resp') this.onResp(d) })
    // Обрыв канала → все in-flight запросы reject'аются (не зависать).
    transport.onClose(() => this.rejectAll('channel closed'))
  }

  isReady(): boolean { return this.transport.isOpen() }

  call(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const reqId = `r${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new HttpError(0, 'rpc timeout'))
      }, RPC_TIMEOUT_MS)
      this.pending.set(reqId, { resolve, reject, timer })
      this.transport.send('rpc_req', { req_id: reqId, method, path, body: body ?? null })
    })
  }

  private onResp(d: unknown): void {
    const r = d as { req_id?: string; status?: number; body?: unknown }
    if (!r || typeof r.req_id !== 'string') return
    const p = this.pending.get(r.req_id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(r.req_id)
    p.resolve({ status: r.status ?? 0, body: r.body })
  }

  private rejectAll(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new HttpError(0, reason))
    }
    this.pending.clear()
  }
}
