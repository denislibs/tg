// Minimal typed RPC over a MessagePort-like endpoint. Works with a MessagePort,
// a SharedWorker port, or a Worker (all expose postMessage + addEventListener).

export interface Endpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
  start?: () => void
}

type Task =
  | { kind: 'invoke'; id: number; type: string; payload: unknown }
  | { kind: 'result'; id: number; result?: unknown; error?: string }
  | { kind: 'event'; event: string; payload: unknown }

export class SuperMessagePort {
  private nextId = 1
  private awaiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  private listeners = new Map<string, Array<(payload: unknown) => void>>()

  constructor(private ep: Endpoint) {
    ep.addEventListener('message', this.onMessage)
    ep.start?.()
  }

  /** UI side: call a handler registered on the other end. */
  invoke<R = unknown>(type: string, payload: unknown, transfer?: Transferable[]): Promise<R> {
    const id = this.nextId++
    const p = new Promise<R>((resolve, reject) => {
      this.awaiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
    })
    this.post({ kind: 'invoke', id, type, payload }, transfer)
    return p
  }

  /** Worker side: register a handler for an invoke type. */
  handle(type: string, fn: (payload: unknown) => unknown | Promise<unknown>): void {
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
        this.post({ kind: 'result', id: task.id, error: e instanceof Error ? e.message : String(e) })
      }
    } else if (task.kind === 'result') {
      const d = this.awaiting.get(task.id)
      if (!d) return
      this.awaiting.delete(task.id)
      if (task.error) d.reject(new Error(task.error))
      else d.resolve(task.result)
    } else if (task.kind === 'event') {
      for (const cb of this.listeners.get(task.event) ?? []) cb(task.payload)
    }
  }
}
