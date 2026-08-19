// Пины воркерной проводки RootScope (Stage 1C.1, задача 1): newWorkerScope —
// единственный держатель воркерного инстанса RootScope + порта-веера по всем
// подключённым вкладкам, вынесенный из bind() (сейчас — workerCore.ts, исторически —
// тело worker.ts), той же формы, что globalFunnel.ts/channelFunnel.ts — см.
// комментарий в начале workerScope.ts. Здесь тестируется НАСТОЯЩИЙ прод-код
// (workerCore.ts делегирует в этот же newWorkerScope; worker.ts — тонкая точка
// входа поверх createWorkerCore(), см. CLAUDE.md «Тесты»), а не его копия.
//
// broadcast/receiveFrom не деструктурируются из возвращённого объекта: оба
// объявлены в newWorkerScope как method-shorthand (по спецификации задачи) —
// деструктуризация оторвала бы их от объекта (ровно паттерн, на который ловит
// oxlint(unbound-method)), поэтому вызываем их через `ws.broadcast(...)`/
// `ws.receiveFrom(...)`.
import { describe, expect, it, vi } from 'vitest'
import { newWorkerScope } from './workerScope'
import { RT } from './events'
import type { EventMeta } from '../../rpc/superMessagePort'

// Локальный тип с property-сигнатурой (не method-shorthand, как у WorkerScopePort) —
// структурно совместим с WorkerScopePort (принимается всюду, где он ожидается), но
// не ловит oxlint(unbound-method) на обращениях `portX.emit` в assert'ах ниже.
interface FakePort { emit: (event: string, payload: unknown, meta?: EventMeta) => void }

function makeFakePort(): FakePort {
  return { emit: vi.fn() }
}

describe('newWorkerScope', () => {
  it('broadcast (событие, порождённое воркером) доставляет ВСЕМ портам и локальному подписчику воркера', () => {
    const ports: FakePort[] = []
    const ws = newWorkerScope({ ports })
    const portA = makeFakePort()
    const portB = makeFakePort()
    ports.push(portA, portB)
    const local = vi.fn()
    ws.scope.addEventListener('rt:resync', local)

    ws.broadcast('rt:resync', null)

    expect(local).toHaveBeenCalledTimes(1)
    // broadcast() всегда форвардит все три формальных параметра в scope.dispatchEvent
    // (даже когда meta не передан вызывающим) — локальный подписчик получает явный
    // undefined третьим позиционным, а не отсутствующий аргумент.
    expect(local).toHaveBeenCalledWith(null, undefined)
    expect(portA.emit).toHaveBeenCalledTimes(1)
    expect(portA.emit).toHaveBeenCalledWith('rt:resync', null, undefined)
    expect(portB.emit).toHaveBeenCalledTimes(1)
    expect(portB.emit).toHaveBeenCalledWith('rt:resync', null, undefined)
  })

  it('кадр от вкладки A (receiveFrom): сначала локальный подписчик воркера, потом ретрансляция; локальный вызван РОВНО один раз, порт B получил, порт A — нет', () => {
    const ports: FakePort[] = []
    const ws = newWorkerScope({ ports })
    const portA = makeFakePort()
    ports.push(portA)

    // Общий журнал последовательности — пин ПОРЯДКА (не только факта вызова), как
    // требует бриф: локальный слушатель воркера должен поправить SSOT ДО того, как
    // соседние вкладки увидят кадр (receiveFrom — сначала dispatchEventSingle, потом
    // ретрансляция). Одного toHaveBeenCalledTimes недостаточно: переставленные
    // местами строки в receiveFrom дают тот же набор вызовов, только в другом
    // порядке, — без журнала тест этого не ловит.
    const log: string[] = []
    const local = vi.fn(() => log.push('local'))
    ws.scope.addEventListener('rt:resync', local)
    const portB: FakePort = { emit: vi.fn(() => log.push('relay')) }
    ports.push(portB)

    ws.receiveFrom(portA, 'rt:resync', null)

    expect(log).toEqual(['local', 'relay'])
    expect(local).toHaveBeenCalledTimes(1)
    expect(portB.emit).toHaveBeenCalledTimes(1)
    expect(portB.emit).toHaveBeenCalledWith('rt:resync', null, undefined)
    expect(portA.emit).not.toHaveBeenCalled()
  })

  it('meta доезжает и в веере (broadcast), и в ретрансляции кадра от вкладки (receiveFrom)', () => {
    const ports: FakePort[] = []
    const ws = newWorkerScope({ ports })
    const portA = makeFakePort()
    const portB = makeFakePort()
    ports.push(portA, portB)

    ws.broadcast(RT.dialogPin, { peer_id: 1, pinned: true }, { pts: 9, catchUp: true })
    expect(portA.emit).toHaveBeenCalledWith(RT.dialogPin, { peer_id: 1, pinned: true }, { pts: 9, catchUp: true })
    expect(portB.emit).toHaveBeenCalledWith(RT.dialogPin, { peer_id: 1, pinned: true }, { pts: 9, catchUp: true })

    ws.receiveFrom(portA, RT.dialogPin, { peer_id: 2, pinned: false }, { pts: 11 } as EventMeta)
    expect(portB.emit).toHaveBeenCalledWith(RT.dialogPin, { peer_id: 2, pinned: false }, { pts: 11 })
  })

  it('локальный воркерный подписчик, который сам зовёт scope.dispatchEvent, не порождает бесконечного кольца', () => {
    const ports: FakePort[] = []
    const ws = newWorkerScope({ ports })
    const portA = makeFakePort()
    ports.push(portA)

    // Подписчик реагирует на входящий кадр от вкладки собственной рассылкой другого
    // события — самоограничен счётчиком, чтобы тест не подвесил раннер, если гарантия
    // (receiveFrom не уходит в порт напрямую) вдруг нарушится и вернёт кольцо.
    let calls = 0
    ws.scope.addEventListener('ui:toast', () => {
      calls += 1
      if (calls < 3) ws.scope.dispatchEvent('ui:toast', `echo-${calls}`)
    })

    ws.receiveFrom(portA, 'ui:toast', 'исходный кадр от вкладки')

    // 1 (исходный кадр, applied через dispatchEventSingle внутри receiveFrom) + 2 самозапущенных echo — конечно.
    expect(calls).toBe(3)
    // Порт получает только собственные echo-рассылки подписчика (2), НЕ исходный
    // кадр (тот применён локально через dispatchEventSingle, в порт не уходит).
    expect(portA.emit).toHaveBeenCalledTimes(2)
  })

  it('порт, добавленный в ports ПОСЛЕ создания фабрики, получает последующие события (веер читает живой массив)', () => {
    const ports: FakePort[] = []
    const ws = newWorkerScope({ ports })
    const portA = makeFakePort()
    ports.push(portA)

    // Вкладка подключилась уже после старта воркера (обычный случай bind()) — порт
    // появляется в массиве ПОСЛЕ newWorkerScope({ ports }).
    const portB = makeFakePort()
    ports.push(portB)

    ws.broadcast('rt:resync', null)
    expect(portA.emit).toHaveBeenCalledWith('rt:resync', null, undefined)
    expect(portB.emit).toHaveBeenCalledWith('rt:resync', null, undefined)

    ws.receiveFrom(portA, 'rt:resync', null)
    expect(portB.emit).toHaveBeenCalledTimes(2)
  })
})
