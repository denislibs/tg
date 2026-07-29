// Minimal typed RPC over a MessagePort-like endpoint. Works with a MessagePort,
// a SharedWorker port, or a Worker (all expose postMessage + addEventListener).

export interface Endpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
  start?: () => void
}

type Task =
  | { kind: 'invoke'; id: number; type: string; payload: unknown }
  | { kind: 'result'; id: number; result?: unknown; error?: string; errorStatus?: number }
  | { kind: 'event'; event: string; payload: unknown }

interface Awaiting {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  type: string
  timer?: ReturnType<typeof setTimeout>
}

export class SuperMessagePort {
  private nextId = 1
  private awaiting = new Map<number, Awaiting>()
  private handlers = new Map<string, (payload: unknown) => unknown>()
  private listeners = new Map<string, Array<(payload: unknown) => void>>()

  constructor(private ep: Endpoint) {
    ep.addEventListener('message', this.onMessage)
    ep.start?.()
  }

  /**
   * UI side: call a handler registered on the other end.
   * timeoutMs (opt-in, как в tweb) — если ответ не пришёл за дедлайн, промис
   * реджектится и запись убирается из awaiting; иначе зависший invoke (упавший
   * воркер / потерянный ответ) копился бы там навсегда → вечный спиннер в UI.
   * Дефолтного таймаута нет намеренно: длинные операции (upload) не должны падать.
   */
  invoke<R = unknown>(type: string, payload: unknown, transfer?: Transferable[], timeoutMs?: number): Promise<R> {
    const id = this.nextId++
    const p = new Promise<R>((resolve, reject) => {
      const entry: Awaiting = { resolve: resolve as (v: unknown) => void, reject, type }
      if (timeoutMs && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          // Дедлайн истёк: снимаем ожидание (поздний result уже никого не найдёт —
          // onMessage тихо его проигнорирует) и реджектим вызывающего.
          if (this.awaiting.delete(id)) reject(new Error(`invoke timeout: ${type} (${timeoutMs}ms)`))
        }, timeoutMs)
      }
      this.awaiting.set(id, entry)
    })
    this.post({ kind: 'invoke', id, type, payload }, transfer)
    return p
  }

  /**
   * Teardown / потеря соединения: реджектим все ожидающие invoke, чтобы вызывающие
   * не висели вечно (disconnect-reject в терминах tweb detachPort), и чистим таймеры.
   */
  dispose(reason = 'port disconnected'): void {
    for (const d of this.awaiting.values()) {
      if (d.timer) clearTimeout(d.timer)
      d.reject(new Error(reason))
    }
    this.awaiting.clear()
  }

  /** Worker side: register a handler for an invoke type. */
  handle(type: string, fn: (payload: unknown) => unknown): void {
    this.handlers.set(type, fn)
  }

  /** Subscribe to pushed events. */
  on<T = unknown>(event: string, cb: (payload: T) => void): void {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb as (p: unknown) => void)
    this.listeners.set(event, arr)
  }

  /** Push an event to the other end. */
  emit(event: string, payload: unknown): void {
    this.post({ kind: 'event', event, payload })
  }

  private post(task: Task, transfer?: Transferable[]) {
    this.ep.postMessage(task, transfer)
  }

  private onMessage = async (ev: MessageEvent) => {
    const task = ev.data as Task
    if (!task || typeof task !== 'object') return
    if (task.kind === 'invoke') {
      const fn = this.handlers.get(task.type)
      if (!fn) { this.post({ kind: 'result', id: task.id, error: `no handler: ${task.type}` }); return }
      try {
        const result = await fn(task.payload)
        this.post({ kind: 'result', id: task.id, result })
      } catch (e) {
        // HTTP-статус (HttpError.status) переживает границу worker→main, чтобы
        // вызывающий мог различать 404/403/… (иначе instanceof/.status терялись).
        const status = (e as { status?: number } | null)?.status
        this.post({ kind: 'result', id: task.id, error: e instanceof Error ? e.message : String(e), errorStatus: typeof status === 'number' ? status : undefined })
      }
    } else if (task.kind === 'result') {
      const d = this.awaiting.get(task.id)
      if (!d) return
      this.awaiting.delete(task.id)
      if (d.timer) clearTimeout(d.timer) // ответ пришёл вовремя — снять дедлайн
      if (task.error) {
        const err = new Error(task.error) as Error & { status?: number }
        if (typeof task.errorStatus === 'number') err.status = task.errorStatus
        d.reject(err)
      } else d.resolve(task.result)
    } else if (task.kind === 'event') {
      for (const cb of this.listeners.get(task.event) ?? []) cb(task.payload)
    }
  }
}
