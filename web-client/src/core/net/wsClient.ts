import { decodeFrame, encodeFrame, type Frame } from '../../protocol/frames'
import type { Transport } from './transport'
import { decodeTLFrame } from './tlFrames'

// Thin WS wrapper: frame + lifecycle listeners.
// Аутентификация — токеном в WebSocket-subprotocol (Sec-WebSocket-Protocol:
// 'bearer', <token>), а НЕ в ?token= URL: query оседает в логах прокси и истории.
// Сервер эхает 'bearer' в ответе рукопожатия; токен hex → валидный subprotocol.
//
// Форматов провода два, и просит формат КЛИЕНТ — подпротоколом `tl.1` перед
// 'bearer' (см. AppConfig.tlWire). Сервер умеет обе формы и собирает их из
// одной модели, поэтому переключение обратимо и посоединенчески.
//
// Разделение простое и другого признака не требует: ТЕКСТОВОЕ сообщение — это
// конверт `{t, d, pts}` кадра, у которого конструктора нет (транспорт по
// решению Р6 и непортированные предметы #51/#52), БИНАРНОЕ — контейнер
// `Updates` с апдейтами внутри.
export class WsClient implements Transport {
  private ws: WebSocket | null = null
  private frameCbs: Array<(type: string, d: unknown, pts?: number) => void> = []
  private openCbs: Array<() => void> = []
  private closeCbs: Array<() => void> = []
  private errorCbs: Array<() => void> = []

  constructor(private url: string, private tlWire = false) {}

  connect(token: string): void {
    const ws = new WebSocket(this.url, this.tlWire ? ['tl.1', 'bearer', token] : ['bearer', token])
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => { for (const cb of this.openCbs) cb() }
    ws.onclose = () => { for (const cb of this.closeCbs) cb() }
    ws.onerror = () => { for (const cb of this.errorCbs) cb() }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') { this.receiveTL(ev.data as ArrayBuffer); return }
      const f: Frame = decodeFrame(ev.data)
      for (const cb of this.frameCbs) cb(f.t, f.d, f.pts)
    }
  }

  // Тип кадра на проводе TL — это его КОНСТРУКТОР, поэтому наружу он и уезжает
  // дискриминатором: маршрутизация у воркера с шага C идёт по нему же.
  private receiveTL(buffer: ArrayBuffer): void {
    for (const { update, seq } of decodeTLFrame(new Uint8Array(buffer))) {
      for (const cb of this.frameCbs) cb(update._, update, seq)
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
