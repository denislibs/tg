// Пины семантики rootScope: dispatchEventSingle — ТОЛЬКО локальная доставка (кадр,
// принятый из воркера, ре-эмитится им, иначе кольцо); dispatchEvent — локально И в
// порт (кадр, порождённый вкладкой, должен долететь до воркера и разлететься по
// остальным вкладкам). Спутать эти два метода — главный риск задачи.
//
// Событий-заглушек ('rt:test_*') в каталоге нет и не будет: TS не даст
// addEventListener/dispatchEvent на несуществующий ключ BroadcastEvents (это и есть
// проверка «каталог закрытый»), поэтому тесты используют реальные записи каталога.
import { describe, expect, it, vi } from 'vitest'
import rootScope from './rootScope'
import { RT } from '@core/realtime/events'

describe('rootScope', () => {
  it('dispatchEventSingle доставляет локально и НЕ уходит в порт', () => {
    const sent: unknown[] = []
    rootScope.setPort({ emit: (e, p, m) => sent.push([e, p, m]) })
    const cb = vi.fn()
    rootScope.addEventListener('ui:toast', cb)
    rootScope.dispatchEventSingle('ui:toast', 'привет')
    expect(cb).toHaveBeenCalledWith('привет')
    expect(sent).toEqual([])
    rootScope.removeEventListener('ui:toast', cb)
  })

  it('dispatchEvent доставляет локально И отправляет в порт (ретрансляция другим вкладкам)', () => {
    const sent: unknown[][] = []
    rootScope.setPort({ emit: (e, p, m) => sent.push([e, p, m]) })
    const cb = vi.fn()
    rootScope.addEventListener('rt:resync', cb)
    rootScope.dispatchEvent('rt:resync', null)
    expect(cb).toHaveBeenCalledWith(null)
    expect(sent).toEqual([['rt:resync', null, undefined]])
    rootScope.removeEventListener('rt:resync', cb)
  })

  it('без setPort dispatchEvent не падает (порт не поднят — ранний UI-код)', () => {
    rootScope.setPort(null)
    const cb = vi.fn()
    rootScope.addEventListener('rt:resync', cb)
    expect(() => rootScope.dispatchEvent('rt:resync', null)).not.toThrow()
    expect(cb).toHaveBeenCalledWith(null)
    rootScope.removeEventListener('rt:resync', cb)
  })

  it('второй аргумент (meta) доезжает до подписчика логируемого события', () => {
    const cb = vi.fn()
    rootScope.addEventListener(RT.dialogPin, cb)
    const pinned = { _: 'updateDialogPinned' as const, peer: { _: 'dialogPeer' as const, peer: { _: 'peerUser' as const, user_id: 1 } }, pFlags: { pinned: true as const } }
    rootScope.dispatchEventSingle(RT.dialogPin, pinned, { pts: 9, catchUp: true })
    expect(cb).toHaveBeenCalledWith(pinned, { pts: 9, catchUp: true })
    rootScope.removeEventListener(RT.dialogPin, cb)
  })

  it('dispatchEvent прокидывает meta в порт вторым payload-соседом', () => {
    const sent: unknown[][] = []
    rootScope.setPort({ emit: (e, p, m) => sent.push([e, p, m]) })
    const unpinned = { _: 'updateDialogPinned' as const, peer: { _: 'dialogPeer' as const, peer: { _: 'peerUser' as const, user_id: 2 } } }
    rootScope.dispatchEvent(RT.dialogPin, unpinned, { pts: 11 })
    expect(sent).toEqual([[RT.dialogPin, unpinned, { pts: 11 }]])
  })
})
