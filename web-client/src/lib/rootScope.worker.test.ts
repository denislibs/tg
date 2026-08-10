// Пины воркерного использования RootScope (Stage 1C.1, задача 1): вместо голой
// функции broadcast воркер держит СВОЙ инстанс RootScope (createRootScope) с
// портом-веером по всем подключённым вкладкам. Харнес здесь воспроизводит ровно
// ту же схему, что в src/core/worker.ts:
//   - workerScope.setPort({ emit }) — веер: рассылает во ВСЕ ports (без исключений,
//     это делает сам RootScope.dispatchEvent — worker.ts:130-138);
//   - receiveFrame(...) — эмуляция bind()'а smp.onAny (worker.ts:349-356): сначала
//     workerScope.dispatchEventSingle (локально, БЕЗ похода в порт — иначе кольцо),
//     затем ручная ретрансляция ОСТАЛЬНЫМ портам (источник исключён явно).
// worker.ts целиком не импортируется — модуль поднимает транспорт/WS/менеджеров
// как side-effect при импорте, что вне зоны ответственности этого теста (RootScope
// как переиспользуемый строительный блок).
import { describe, expect, it, vi } from 'vitest'
import { createRootScope, type BroadcastEventsListeners } from './rootScope'
import { RT } from '@core/realtime/events'
import type { EventMeta } from '@rpc/superMessagePort'

interface FakePort { emit: (event: string, payload: unknown, meta?: EventMeta) => void }

function makeFakePort(): FakePort {
  return { emit: vi.fn() }
}

// Собирает свежий стенд (workerScope + список портов + функция приёма кадра от
// вкладки) — по образцу worker.ts, но изолированно на тест: воркерный RootScope в
// проде — синглтон на весь процесс, но для тестов каждому кейсу нужен чистый инстанс,
// иначе подписчики/порты одного теста утекут в другой.
function setup() {
  const ports: FakePort[] = []
  const workerScope = createRootScope()
  workerScope.setPort({ emit: (event, payload, meta) => { for (const p of ports) p.emit(event, payload, meta) } })
  // Копия bind()'овского smp.onAny из worker.ts:349-356.
  const receiveFrame = (source: FakePort, event: string, payload: unknown, meta?: EventMeta) => {
    workerScope.dispatchEventSingle(event as keyof BroadcastEventsListeners, payload as never, meta as never)
    for (const p of ports) if (p !== source) p.emit(event, payload, meta)
  }
  return { ports, workerScope, receiveFrame }
}

describe('rootScope в воркере (createRootScope + порт-веер)', () => {
  it('workerScope.dispatchEvent доставляет ВСЕМ портам и локальному подписчику воркера', () => {
    const { ports, workerScope } = setup()
    const portA = makeFakePort()
    const portB = makeFakePort()
    ports.push(portA, portB)
    const local = vi.fn()
    workerScope.addEventListener('rt:resync', local)

    workerScope.dispatchEvent('rt:resync', null)

    expect(local).toHaveBeenCalledTimes(1)
    expect(local).toHaveBeenCalledWith(null)
    expect(portA.emit).toHaveBeenCalledTimes(1)
    expect(portA.emit).toHaveBeenCalledWith('rt:resync', null, undefined)
    expect(portB.emit).toHaveBeenCalledTimes(1)
    expect(portB.emit).toHaveBeenCalledWith('rt:resync', null, undefined)
  })

  it('кадр от вкладки A: локальный подписчик воркера вызван РОВНО один раз; порт B получил; порт A — нет', () => {
    const { ports, workerScope, receiveFrame } = setup()
    const portA = makeFakePort()
    const portB = makeFakePort()
    ports.push(portA, portB)
    const local = vi.fn()
    workerScope.addEventListener('rt:resync', local)

    receiveFrame(portA, 'rt:resync', null)

    expect(local).toHaveBeenCalledTimes(1)
    expect(portB.emit).toHaveBeenCalledTimes(1)
    expect(portB.emit).toHaveBeenCalledWith('rt:resync', null, undefined)
    expect(portA.emit).not.toHaveBeenCalled()
  })

  it('meta доезжает и в веере (dispatchEvent), и в ретрансляции кадра от вкладки', () => {
    const { ports, workerScope, receiveFrame } = setup()
    const portA = makeFakePort()
    const portB = makeFakePort()
    ports.push(portA, portB)

    // Веер (dispatchEvent) — событие, порождённое самим воркером (funnel).
    workerScope.dispatchEvent(RT.dialogPin, { chat_id: 1, pinned: true }, { pts: 9, catchUp: true })
    expect(portA.emit).toHaveBeenCalledWith(RT.dialogPin, { chat_id: 1, pinned: true }, { pts: 9, catchUp: true })
    expect(portB.emit).toHaveBeenCalledWith(RT.dialogPin, { chat_id: 1, pinned: true }, { pts: 9, catchUp: true })

    // Ретрансляция кадра от вкладки A — meta должна долететь до порта B без потерь.
    receiveFrame(portA, RT.dialogPin, { chat_id: 2, pinned: false }, { pts: 11 })
    expect(portB.emit).toHaveBeenCalledWith(RT.dialogPin, { chat_id: 2, pinned: false }, { pts: 11 })
  })

  it('локальный воркерный подписчик, который сам зовёт dispatchEvent, не порождает бесконечного кольца', () => {
    const { ports, workerScope, receiveFrame } = setup()
    const portA = makeFakePort()
    ports.push(portA)

    // Подписчик реагирует на входящий кадр от вкладки собственной рассылкой другого
    // события — самоограничен счётчиком, чтобы тест не подвесил раннер, если гарантия
    // (dispatchEventSingle не уходит в порт) вдруг нарушится и вернёт кольцо.
    let calls = 0
    workerScope.addEventListener('ui:toast', () => {
      calls += 1
      if (calls < 3) workerScope.dispatchEvent('ui:toast', `echo-${calls}`)
    })

    receiveFrame(portA, 'ui:toast', 'исходный кадр от вкладки')

    // 1 (исходный кадр, applied через dispatchEventSingle) + 2 самозапущенных echo — конечно.
    expect(calls).toBe(3)
    // Порт получает только собственные dispatchEvent-рассылки подписчика (2 echo),
    // НЕ исходный кадр (тот применён локально через dispatchEventSingle, в порт не уходит).
    expect(portA.emit).toHaveBeenCalledTimes(2)
  })
})
