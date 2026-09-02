/**
 * Порт tweb `src/helpers/solid/createComponentContext.ts` — механика
 * «составного компонента»: родитель заводит контекст, дети-подкомпоненты
 * РЕГИСТРИРУЮТ в нём свой узел под известным именем (`kind`), а рисует их всех
 * родитель — в СВОЁМ порядке, а не в порядке, в котором они написаны в JSX.
 *
 * Ради этого `register` и возвращает `undefined`: узел ребёнка не попадает в
 * дерево на месте своего объявления, он только кладётся в стор. Так `<Row>`
 * (`components/rowTsx.solid.tsx`) принимает `<Row.Title>`/`<Row.Subtitle>`/
 * `<Row.Icon>` в любом порядке, а выкладывает их в порядке разметки строки —
 * тот же DOM, что у императивного `components/row.ts`.
 *
 * `children()` вокруг элемента обязателен: без него `resolved()` вернул бы
 * функцию-компонент, а не готовый узел, и `createRenderEffect` записал бы в
 * стор не то. `onCleanup` вычищает запись — иначе снятый `<Show>`-ветвью
 * подкомпонент остался бы нарисованным родителем.
 */
import { children, createContext, createRenderEffect, onCleanup, type JSX } from 'solid-js'
import { createStore } from 'solid-js/store'

export type ComponentContextValue<Kind extends string> = {
  register: (kind: Kind, element: JSX.Element) => JSX.Element
  store: { [key in Kind]?: JSX.Element }
}

export default function createComponentContext<
  ContextValue extends ComponentContextValue<Kind>,
  Kind extends string,
>() {
  const context = createContext<ContextValue>()

  return {
    context,
    createValue: () => {
      const [store, setStore] = createStore<ContextValue['store']>({})
      const register: ContextValue['register'] = (kind, element) => {
        const resolved = children(() => element)
        createRenderEffect(() => {
          setStore(kind as never, resolved() as never)
        })
        onCleanup(() => setStore(kind as never, undefined as never))
        return undefined
      }

      const value: ComponentContextValue<Kind> = {
        register,
        store,
      }

      return value
    },
  }
}
