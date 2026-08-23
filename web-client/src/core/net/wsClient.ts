import { decodeFrame, encodeFrame, type Frame } from '../../protocol/frames'
import type { Transport } from './transport'

// Thin WS wrapper: JSON frames in/out, frame + lifecycle listeners.
// Аутентификация — токеном в WebSocket-subprotocol (Sec-WebSocket-Protocol:
// 'bearer', <token>), а НЕ в ?token= URL: query оседает в логах прокси и истории.
// Сервер эхает 'bearer' в ответе рукопожатия; токен hex → валидный subprotocol.
export class WsClient implements Transport {
  private ws: WebSocket | null = null
  private frameCbs: Array<(type: string, d: unknown, pts?: number) => void> = []
  private openCbs: Array<() => void> = []
  private closeCbs: Array<() => void> = []
  private errorCbs: Array<() => void> = []

  constructor(private url: string) {}

  connect(token: string): void {
    const ws = new WebSocket(this.url, ['bearer', token])
    this.ws = ws
    ws.onopen = () => { for (const cb of this.openCbs) cb() }
    ws.onclose = () => { for (const cb of this.closeCbs) cb() }
    ws.onerror = () => { for (const cb of this.errorCbs) cb() }
    ws.onmessage = (ev) => {
      const f: Frame = decodeFrame(typeof ev.data === 'string' ? ev.data : '')
      for (const cb of this.frameCbs) cb(f.t, f.d, f.pts)
    }
  }

  onFrame(cb: (type: string, d: unknown, pts?: number) => void): void { this.frameCbs.push(cb) }
  onOpen(cb: () => void): void { this.openCbs.push(cb) }
  onClose(cb: () => void): void { this.closeCbs.push(cb) }
  onError(cb: () => void): void { this.errorCbs.push(cb) }
  onBinary(_cb: (data: Uint8Array) => void): void { /* plain-WS: медиа нативным HTTP, бинарь не приходит */ }

  isOpen(): boolean { return this.ws?.readyState === 1 }

  send(t: string, d?: unknown): void { this.ws?.send(encodeFrame(t, d)) }
  sendBinary(): void { /* DNP-only: plain-WS не шлёт бинарные file_up-кадры */ }

  close(): void {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
  }
}
