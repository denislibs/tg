// Узкая граница между connectionManager и конкретным транспортом (plain WS / DNP).
// Форма выведена из фактического использования WsClient в connectionManager.
export interface Transport {
  connect(token: string): void
  close(): void
  isOpen(): boolean
  onOpen(cb: () => void): void
  onClose(cb: () => void): void
  onError(cb: () => void): void
  /**
   * Приём КАЖДОГО кадра одним обработчиком: тип конверта, тело и — если
   * конструктор не объявляет своего `pts` — курсор из конверта (см. Frame.pts).
   *
   * Подписки по имени типа здесь нет намеренно. Она была реестром строк внутри
   * транспорта: кадр, чьего типа не оказалось в списке подписок, молча
   * исчезал (так тринадцать кадров однажды и пропали). Маршрутизацию делает
   * тот, кто знает КОНСТРУКТОР, — воркер; транспорт только доставляет.
   */
  onFrame(cb: (type: string, d: unknown, pts?: number) => void): void
  onBinary(cb: (data: Uint8Array) => void): void
  send(type: string, d?: unknown): void
  sendBinary(data: Uint8Array): void
}
