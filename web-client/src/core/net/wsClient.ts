import { decodeFrame, encodeFrame, type Frame } from '../../protocol/frames'

// Thin WS wrapper: connect to /ws?token=, JSON frames in/out, frame + lifecycle listeners.
export class WsClient {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Array<(d: unknown) => void>>()
  private openCbs: Array<() => void> = []
  private closeCbs: Array<() => void> = []
  private errorCbs: Array<() => void> = []

  constructor(private url: string) {}

  connect(token: string): void {
    const ws = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => { for (const cb of this.openCbs) cb() }
    ws.onclose = () => { for (const cb of this.closeCbs) cb() }
    ws.onerror = () => { for (const cb of this.errorCbs) cb() }
    ws.onmessage = (ev) => {
      const f: Frame = decodeFrame(typeof ev.data === 'string' ? ev.data : '')
      for (const cb of this.listeners.get(f.t) ?? []) cb(f.d)
    }
  }

  on(type: string, cb: (d: unknown) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb)
    this.listeners.set(type, arr)
  }
  onOpen(cb: () => void): void { this.openCbs.push(cb) }
  onClose(cb: () => void): void { this.closeCbs.push(cb) }
  onError(cb: () => void): void { this.errorCbs.push(cb) }

  isOpen(): boolean { return this.ws?.readyState === 1 }

  send(t: string, d?: unknown): void { this.ws?.send(encodeFrame(t, d)) }

  close(): void {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
  }
}
