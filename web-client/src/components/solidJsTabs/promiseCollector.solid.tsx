/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/solidJsTabs/promiseCollector.tsx` — 1:1, без
 * отличий. Смысл: содержимое Solid-вкладки может захотеть подгрузить что-то
 * асинхронное ДО того, как вкладка отдаст управление слайдеру (`init`
 * resolve'ится) — иначе вкладка въезжает пустой и доливается на глазах уже
 * после анимации открытия. `usePromiseCollector().collect(promise)` кладёт
 * промис в общий пул, `createHelper().await()` — точка, в которой
 * `scaffoldSolidJSTab.init` дожидается всего накопленного (см.
 * `scaffoldSolidJSTab.solid.tsx`).
 *
 * `collectPromise` в `createHelper` — намеренно `let`, а не `const`: после
 * первого `await()` ссылка на массив `promises` заменяется на no-op
 * (`() => {}`), чтобы поздние вызовы `collect` (уже после того, как вкладка
 * открылась) не росли в массиве, на который больше никто не смотрит —
 * комментарий оригинала `// lose reference to the promises array` (:29).
 */
import { createContext, useContext, type ParentProps } from 'solid-js'

type PromiseCollectorContextValue = {
  collect: (promise: Promise<any>) => void
}

const PromiseCollectorContext = createContext<PromiseCollectorContextValue>({
  collect: () => {},
})

type PromiseCollectorProps = {
  onCollect: (promise: Promise<any>) => void
}

export const PromiseCollector = (props: ParentProps<PromiseCollectorProps>) => {
  return (
    <PromiseCollectorContext.Provider value={{ collect: props.onCollect }}>
      {props.children}
    </PromiseCollectorContext.Provider>
  )
}

PromiseCollector.createHelper = () => {
  const promises: Promise<any>[] = []

  let collectPromise = (promise: Promise<any>) => {
    promises.push(promise)
  }

  return {
    onCollect: (promise: Promise<any>) => collectPromise(promise),
    await: () => {
      collectPromise = () => {} // lose reference to the promises array
      return Promise.all(promises)
    },
  }
}

export const usePromiseCollector = () => useContext(PromiseCollectorContext)
