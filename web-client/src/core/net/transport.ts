// Узкая граница между connectionManager и конкретным транспортом (plain WS / DNP).
// Форма выведена из фактического использования WsClient в connectionManager.
export interface Transport {
  connect(token: string): void
  close(): void
  isOpen(): boolean
  onOpen(cb: () => void): void
  onClose(cb: () => void): void
  onError(cb: () => void): void
  on(type: string, cb: (d: unknown) => void): void
  send(type: string, d?: unknown): void
}
