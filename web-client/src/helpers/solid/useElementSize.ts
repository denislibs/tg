// Порт tweb `src/hooks/useElementSize.ts` (90 строк) — реактивный размер узла
// для Solid. Один корень наблюдения на узел, разделяемый между всеми
// читателями (`map` + счётчик), снимается с последним читателем.
//
// React-аналог того же оригинала — `shared/lib/useElementSize.ts` (callback-ref
// + `ResizeObserver`); на Solid реактивность оригинала переносится 1:1, поэтому
// здесь его форма, а не форма React-порта.
//
// `pickKeys(rect, ['width', 'height'])` оригинала (`helpers/object/pickKeys`,
// у нас его нет) заменён деструктуризацией тех же двух полей.
import { createMemo, createRenderEffect, createRoot, onCleanup, type Accessor } from 'solid-js'
import { createStore, type Store } from 'solid-js/store'
import { requestRAF } from '@helpers/solid/requestRAF'

type SizeRoot = {
  count: number
  store: Store<{ width: number, height: number }>
  dispose: () => void
}

const NULL_KEY = {}

const map = new WeakMap<Element | typeof NULL_KEY, SizeRoot>()

const createSizeRoot = (element: Accessor<Element | undefined>) => createRoot((dispose) => {
  const [store, setStore] = createStore({ width: 0, height: 0 })

  createRenderEffect(() => {
    const el = element()
    if(!el) return

    const { width, height } = el.getBoundingClientRect()
    setStore({ width, height })

    let callback: (() => void) | undefined, isQueued = false

    const resizeObserver = new ResizeObserver(([entry]) => {
      const boxSize = entry.borderBoxSize[0]
      if(!boxSize) return

      callback = () => setStore({
        width: boxSize.inlineSize,
        height: boxSize.blockSize,
      })

      if(isQueued) return
      isQueued = true

      requestRAF(() => {
        callback?.()
        callback = undefined
        isQueued = false
      })
    })

    resizeObserver.observe(el)

    onCleanup(() => {
      resizeObserver.disconnect()
    })
  })

  return {
    count: 0,
    store,
    dispose,
  }
})

export default function useElementSize(element: Accessor<Element | undefined>) {
  const root = createMemo(() => {
    const key = element() || NULL_KEY

    const root = map.get(key) || createSizeRoot(element)

    if(!map.has(key)) map.set(key, root)

    root.count++

    onCleanup(() => {
      root.count--
      if(!root.count) {
        root.dispose()
        map.delete(key)
      }
    })

    return root
  })

  return {
    get width() {
      return root().store.width
    },
    get height() {
      return root().store.height
    },
  }
}
