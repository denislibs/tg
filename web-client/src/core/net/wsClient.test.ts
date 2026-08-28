// src/core/net/wsClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WsClient } from './wsClient'

class FakeWS {
  static instances: FakeWS[] = []
  onmessage: ((ev: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  readyState = 0
  binaryType = 'blob'
  constructor(public url: string, public protocols?: string | string[]) { FakeWS.instances.push(this) }
  send(s: string) { this.sent.push(s) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  message(s: string) { this.onmessage?.({ data: s }) }
  binary(bytes: Uint8Array) { this.onmessage?.({ data: bytes.buffer as unknown as string }) }
}

beforeEach(() => { FakeWS.instances = []; vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket) })

describe('WsClient', () => {
  it('fires onOpen, delivers every frame with its type, exposes isOpen', () => {
    const c = new WsClient('/ws')
    const opened = vi.fn(); const got = vi.fn()
    c.onOpen(opened); c.onFrame(got)
    c.connect('tok')
    const ws = FakeWS.instances[0]
    expect(ws.url).toBe('/ws')
    expect(ws.protocols).toEqual(['bearer', 'tok'])
    ws.open()
    expect(opened).toHaveBeenCalled()
    expect(c.isOpen()).toBe(true)
    ws.message(JSON.stringify({ t: 'new_message', d: { msg_id: 5 } }))
    expect(got).toHaveBeenCalledWith('new_message', { msg_id: 5 }, undefined)
    // Курсор ИЗ КОНВЕРТА доезжает до подписчика: у кадров, чей конструктор
    // схемы своего `pts` не объявляет, он едет только здесь.
    ws.message(JSON.stringify({ t: 'new_message', d: { msg_id: 6 }, pts: 42 }))
    expect(got).toHaveBeenCalledWith('new_message', { msg_id: 6 }, 42)
  })

  // Кадр НЕЗНАКОМОГО типа тоже доезжает — раньше он исчезал молча, потому что
  // слушателя именно этого имени никто не завёл.
  it('доставляет кадр, тип которого никому не известен', () => {
    const c = new WsClient('/ws')
    const got = vi.fn(); c.onFrame(got)
    c.connect('tok')
    const ws = FakeWS.instances[0]; ws.open()
    ws.message(JSON.stringify({ t: 'какой_то_новый_кадр', d: { x: 1 } }))
    expect(got).toHaveBeenCalledWith('какой_то_новый_кадр', { x: 1 }, undefined)
  })

  // Провод TL: формат просит КЛИЕНТ подпротоколом, и просит его ПЕРВЫМ — сервер
  // выбирает первый совпавший из своего списка, где `tl.1` стоит раньше
  // 'bearer'. Порядок здесь не косметика: перепутай его — и провод молча
  // останется JSON.
  it('флаг TL добавляет подпротокол tl.1 перед bearer', () => {
    new WsClient('/ws', true).connect('tok')
    expect(FakeWS.instances[0].protocols).toEqual(['tl.1', 'bearer', 'tok'])

    new WsClient('/ws').connect('tok')
    expect(FakeWS.instances[1].protocols).toEqual(['bearer', 'tok'])
  })

  // Бинарное сообщение — контейнер Updates: тип кадра это его КОНСТРУКТОР,
  // поэтому наружу он и уезжает дискриминатором. Курсор приезжает из `seq`
  // контейнера — у кадров без своего `pts` другого места у него нет.
  //
  // Кадры здесь приходят ДО того, как догрузился чанк кодека (он подтягивается
  // динамическим import'ом — выключенный флаг не должен платить за таблицу
  // конструкторов). Проверяется поэтому не только разбор, но и очередь: ни
  // один кадр не потерян и порядок не переставлен — иначе курсор поехал бы.
  it('кадры, пришедшие до загрузки кодека, разбираются по порядку', async () => {
    const c = new WsClient('/ws', true)
    const got = vi.fn(); c.onFrame(got)
    c.connect('tok')
    const ws = FakeWS.instances[0]
    ws.open()
    expect(ws.binaryType).toBe('arraybuffer')

    // Транспортный кадр (текстом) и апдейт (бинарём) — вперемешку.
    ws.message(JSON.stringify({ t: 'hello', d: { pts: 7 } }))
    // Тот же эталонный вектор, что читает неизменённый десериализатор tweb.
    const hex = '4042ae7415c4b51c010000001ce56f6e0100000005bf6de522175159070000000000000015c4b51c0000000015c4b51c00000000048e886a2a000000'
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; ++i) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    ws.binary(bytes)

    // До загрузки чанка наружу не ушло ничего.
    expect(got).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(2))

    expect(got.mock.calls[0][0]).toBe('hello')
    expect(got.mock.calls[1][0]).toBe('updateDialogPinned')
    expect((got.mock.calls[1][1] as { _: string })._).toBe('updateDialogPinned')
    expect(got.mock.calls[1][2]).toBe(42)
  })

  // Выключенный флаг очередь не заводит: кадр уходит наружу в том же тике.
  it('без флага TL кадр доезжает синхронно', () => {
    const c = new WsClient('/ws')
    const got = vi.fn(); c.onFrame(got)
    c.connect('tok')
    const ws = FakeWS.instances[0]; ws.open()
    ws.message(JSON.stringify({ t: 'hello', d: { pts: 7 } }))
    expect(got).toHaveBeenCalledTimes(1)
  })

  it('fires onClose and reports not open', () => {
    const c = new WsClient('/ws'); const closed = vi.fn(); c.onClose(closed)
    c.connect('tok'); const ws = FakeWS.instances[0]; ws.open(); ws.close()
    expect(closed).toHaveBeenCalled(); expect(c.isOpen()).toBe(false)
  })
})
