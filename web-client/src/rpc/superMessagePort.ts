// Minimal typed RPC over a MessagePort-like endpoint. Works with a MessagePort,
// a SharedWorker port, or a Worker (all expose postMessage + addEventListener).

export interface Endpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
  /** Опциональны: MessagePort/SharedWorker-порт их умеют, «сырой» self воркера
   *  (фолбэк без SharedWorker, workerCore.ts::start()) — тоже (self.close() корректен там,
   *  т.к. в этом режиме воркер эксклюзивно принадлежит одной вкладке). Нужны
   *  только disconnectPort() ниже — снять слушатель тихо, если API нет. */
  removeEventListener?(type: 'message', listener: (ev: MessageEvent) => void): void
  close?(): void
  start?: () => void
}

type Task =
  | { kind: 'invoke'; id: number; type: string; payload: unknown }
  | { kind: 'result'; id: number; result?: unknown; error?: string; errorStatus?: number }
  | { kind: 'event'; event: string; payload: unknown; meta?: EventMeta }
  /** Web Locks (порт tweb superMessagePort.ts:220-236 + :505-515). Отправитель —
   *  вкладка: id взятого navigator.locks-лока сразу после подключения порта, либо
   *  '' — фолбэк без Web Locks API (кадр beforeunload, см. bootstrap.ts). Приёмник —
   *  воркер: непустой id → сам запрашивает тот же лок и ждёт, пока он не освободится
   *  (вкладка умерла); пустой id → трактует как немедленное отключение. */
  | { kind: 'lock'; id: string }

/**
 * Аварийный рубильник механики Web Locks — порт tweb `USE_LOCKS`
 * (superMessagePort.ts:91). `false` полностью выключает автоснятие портов
 * закрытых вкладок: вкладка не берёт лок и не шлёт кадр `lock` (attachLock,
 * bootstrap.ts), воркер игнорирует такие кадры (handleLockTask ниже).
 *
 * Деградация при `false` — поведение «до прополки портов»: порт мёртвой вкладки
 * остаётся в ports[] воркера до его перезапуска. Это утечка, но безопасная;
 * ошибочное же отключение ЖИВОЙ вкладки стоит дороже — у неё нет ни реконнекта,
 * ни таймаута на invoke, то есть все RPC зависают до перезагрузки страницы,
 * а в фолбэке без SharedWorker (Chrome for Android) close() эндпоинта — это
 * self.close(), смерть всего воркера.
 *
 * Держится здесь именно ради такого случая: механика завязана на то, когда
 * браузер освобождает лок (в т.ч. при уходе страницы в bfcache), и это
 * невозможно проверить тестами — фейковый navigator.locks гонок не
 * воспроизводит. Если в проде всплывут мёртвые вкладки — правится эта строка,
 * без отката веток.
 */
export const USE_LOCKS = true

/** Метаданные realtime-события. Заполняются ТОЛЬКО funnel'ом воркера —
 *  единственным местом, которое знает происхождение кадра. */
export interface EventMeta { pts?: number; catchUp?: boolean }

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
  private listeners = new Map<string, Array<(payload: unknown, meta?: EventMeta) => void>>()
  /** catch-all: срабатывает на ЛЮБОЕ входящее событие, после адресных
   *  слушателей (on). Единственный текущий потребитель — воркер, который
   *  ретранслирует кадр вкладки остальным вкладкам (см. onAny). */
  private anyListeners: Array<(event: string, payload: unknown, meta?: EventMeta) => void> = []
  /** Задача 2 (worker-rootscope): колбэк отключения порта — workerCore.ts::bind()
   *  вешает на него снятие из ports[] (indexOfAndSplice). Срабатывает РОВНО один
   *  раз — см. disconnectPort. */
  private onPortDisconnect: (() => void) | undefined
  private portDisconnected = false

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

  /** Subscribe to pushed events. meta (второй аргумент) заполнен только для
   *  событий funnel'а курсора (pts/catchUp) — остальные подписчики его не
   *  читают и продолжают работать (обратная совместимость кадра). */
  on<T = unknown>(event: string, cb: (payload: T, meta?: EventMeta) => void): void {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb as (p: unknown, meta?: EventMeta) => void)
    this.listeners.set(event, arr)
  }

  /** Подписка на любое событие (catch-all) — см. anyListeners. */
  onAny(cb: (event: string, payload: unknown, meta?: EventMeta) => void): void {
    this.anyListeners.push(cb)
  }

  /** Push an event to the other end. */
  emit(event: string, payload: unknown, meta?: EventMeta): void {
    this.post({ kind: 'event', event, payload, meta })
  }

  /** Tab side (bootstrap.ts): сообщить воркеру id взятого Web Lock — сразу после
   *  подключения порта. Пустая строка — фолбэк без Web Locks API (beforeunload):
   *  приёмник трактует её как немедленное отключение, см. handleLockTask. */
  sendLock(id: string): void {
    this.post({ kind: 'lock', id })
  }

  /** Worker side (Задача 2): подписка на отключение ЭТОГО порта (лок вкладки
   *  освободился — вкладка умерла). workerCore.ts::bind() вешает снятие из ports[]. */
  setOnPortDisconnect(cb: () => void): void {
    this.onPortDisconnect = cb
  }

  /**
   * Идемпотентное отключение порта (порт tweb detachPort, superMessagePort.ts:287-309, без
   * ping/heldLocks — их у нас нет): снять слушатель, закрыть эндпоинт (если
   * умеет), отклонить зависшие invoke (dispose) и дёрнуть onPortDisconnect
   * РОВНО один раз. Повторный вызов (двойное срабатывание лока, гонка close+lock)
   * — no-op, флаг portDisconnected гарантирует однократность колбэка.
   */
  private disconnectPort(): void {
    if (this.portDisconnected) return
    this.portDisconnected = true
    this.ep.removeEventListener?.('message', this.onMessage)
    this.ep.close?.()
    this.dispose('port disconnected (lock released)')
    this.onPortDisconnect?.()
  }

  /**
   * Worker side: обработка кадра `lock` от вкладки (порт tweb processLockTask,
   * :503-515). Две РАЗНЫЕ по смыслу ветки (Б-2 ревью — не смешивать):
   *  — пустой id: явный сигнал от САМОЙ вкладки, что она уходит (фолбэк
   *    beforeunload, нет Web Locks API на её стороне) — отключаем немедленно,
   *    ждать нечего (комментарий tweb :250 — на пинг намеренно не полагаемся);
   *  — непустой id, но У ВОРКЕРА нет navigator.locks: id доказывает, что
   *    вкладка ЖИВА и реально держит лок (см. attachLock — кадр уходит только
   *    из колбэка гранта) — воркер здесь бессилен проверить лок сам, но это
   *    НЕ повод отключать живую вкладку. Оставляем порт как есть — деградация
   *    к поведению «до Задачи 2» (порт не снимется автоматически), а не отказ.
   */
  private handleLockTask(id: string): void {
    // Рубильник выключен — механика мертва целиком, включая пустой id
    // (фолбэк-кадр beforeunload). Гейт стоит ДО ветки `!id` намеренно: иначе
    // вкладка со старым бандлом всё равно смогла бы отцепить свой порт, и
    // выключение получилось бы половинчатым. См. USE_LOCKS выше.
    if (!USE_LOCKS) return
    if (!id) {
      this.disconnectPort()
      return
    }
    // Проверяем ЗНАЧЕНИЕ, не `'locks' in navigator` — happy-dom (см. тесты)
    // объявляет navigator.locks геттером-заглушкой, который ЕСТЬ (`in` даёт
    // true), но возвращает null: `in`-проверка молча решила бы, что API есть,
    // и упала бы на .request() у null. В реальных браузерах без Web Locks
    // свойства нет вовсе — truthy-проверка значения покрывает оба случая.
    if (typeof navigator === 'undefined' || !navigator.locks) {
      return
    }
    // Осознанное расхождение с tweb: у них тут дедуп `requestedLocks`
    // (superMessagePort.ts:505-513 — `if (this.requestedLocks.has(id)) return`
    // перед `navigator.locks.request`), нужный потому, что `resendLockTask`
    // (:241-248) может переслать ТОТ ЖЕ id повторно (например, при
    // переподключении отправляющего порта) — без дедупа на один id ушло бы
    // несколько параллельных request(). Мы `resendLockTask` не портировали
    // (bootstrap.ts шлёт lock ровно один раз, из колбэка гранта, см. attachLock)
    // — id физически приходит один раз за жизнь порта, дублирующий вызов
    // request() с тем же id недостижим. Если resendLockTask когда-нибудь
    // появится — этот комментарий и есть напоминание вернуть дедуп.
    void navigator.locks.request(id, () => { this.disconnectPort() })
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
      for (const cb of this.listeners.get(task.event) ?? []) cb(task.payload, task.meta)
      // catch-all — после адресных, чтобы порядок доставки был предсказуем.
      for (const cb of this.anyListeners) cb(task.event, task.payload, task.meta)
    } else if (task.kind === 'lock') {
      this.handleLockTask(task.id)
    }
  }
}
