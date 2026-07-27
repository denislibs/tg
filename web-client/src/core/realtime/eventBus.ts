// Шина realtime-событий воркера (main-thread). Единственный потребитель smp —
// «насос» в realtimeBridge — публикует сюда каждое событие; все прочие модули
// (Store-проектор, Notifications, Sound, будущие Analytics/Logger) подписываются
// на шину, а не на smp напрямую. Это сохраняет инвариант «один потребитель сокета»
// и делает добавление нового потребителя события одной строкой eventBus.subscribe.
type BusHandler = (payload: unknown) => void

class EventBus {
  private subs = new Map<string, BusHandler[]>()

  /** Подписаться на событие. Возвращает функцию отписки. */
  subscribe(event: string, handler: BusHandler): () => void {
    const arr = this.subs.get(event) ?? []
    arr.push(handler)
    this.subs.set(event, arr)
    return () => {
      const a = this.subs.get(event)
      if (!a) return
      const i = a.indexOf(handler)
      if (i >= 0) a.splice(i, 1)
    }
  }

  /** Опубликовать событие всем подписчикам (slice — на случай отписки во время доставки). */
  publish(event: string, payload: unknown): void {
    const arr = this.subs.get(event)
    if (!arr) return
    for (const h of arr.slice()) h(payload)
  }
}

export const eventBus = new EventBus()
