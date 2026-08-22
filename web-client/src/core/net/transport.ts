// Узкая граница между connectionManager и конкретным транспортом (plain WS / DNP).
// Форма выведена из фактического использования WsClient в connectionManager.
export interface Transport {
  connect(token: string): void
  close(): void
  isOpen(): boolean
  onOpen(cb: () => void): void
  onClose(cb: () => void): void
  onError(cb: () => void): void
  /** cb получает тело кадра и — если конструктор не объявляет своего `pts` —
   *  курсор из КОНВЕРТА (см. Frame.pts). */
  on(type: string, cb: (d: unknown, pts?: number) => void): void
  onBinary(cb: (data: Uint8Array) => void): void
  send(type: string, d?: unknown): void
  sendBinary(data: Uint8Array): void
}
