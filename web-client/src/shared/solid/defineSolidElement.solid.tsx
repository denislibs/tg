/** @jsxImportSource solid-js */
// Порт tweb `src/lib/solidjs/defineSolidElement.tsx:1-243` — custom element с
// Solid-рендером внутри.
//
// Зачем он, когда есть `mountSolid`: у мостового острова хозяин обязан позвать
// `dispose` сам, а у части компонентов tweb хозяина с таким сигналом нет —
// заглушку пустого поиска группа снимает голым `placeholder.remove()`
// (`searchGroup.tsx:137-140`), а `ChatTypeMenu` живёт в правом слоте заголовка
// группы до `cleanup()` поиска. У custom element'а сигнал есть у самого узла:
// `connectedCallback` монтирует корень, `disconnectedCallback` гасит его
// (lottie-утка освобождает плеер), повторная вставка монтирует заново.
//
// Второе, чего нет у `mountSolid`: `props` — ИЗМЕНЯЕМЫЙ реактивный стор
// (`createMutable`). Компонент tweb пишет в свои пропы (`ChatTypeMenu` —
// `props.selected = key`, `chatTypeMenu/index.tsx:40`), а владелец читает и
// пишет их снаружи (`chatTypeMenu.props.selected = 'all'`,
// `sidebarLeft/index.ts:1107`, `:1307`, `:1501`). Стор `mountSolid` для
// компонента только на чтение, так что на нём этот контракт не собрать.
// Пропы, скормленные до вставки, лежат в `savedProps` и переживают
// размонтирование: стор оборачивает тот же объект.
//
// Расхождения с оригиналом:
//  1. Горячая замена модуля (`swapComponentFromHMR`, список `instances`,
//     `HotReloadGuard`) не перенесена: у нас нет dev-сервера с HMR — `npm run dev`
//     это watch-сборка (web-client/CLAUDE.md). Повторный вызов с тем же `name`
//     (`:74-79`) отдаёт уже определённый класс, без подмены компонента: модуль
//     переисполняют тесты с `vi.resetModules()` (`client/realtimeBridge.test.ts`).
//  2. `observedAttributes`/`attributesStore`/`attributeChangedCallback`,
//     `shadow` и `controls` не перенесены: ни один портированный потребитель
//     ими не пользуется; приедут с первым, кому нужны.
//  3. Рендер обёрнут в `ErrorBoundary` с логом — по той же причине, что в
//     `mountSolid` (см. его докблок): у tweb Solid форкнут и ошибку без
//     границы логирует, сток её бросает и уронил бы вставку узла.
import { createRoot, ErrorBoundary, untrack, type JSX } from 'solid-js'
import { createMutable } from 'solid-js/store'
import { render } from 'solid-js/web'

export type PassedProps<Props extends object = object> = Props & {
  readonly element: HTMLElement
}

type CustomElementComponent<Props extends object> = (props: PassedProps<Props>) => JSX.Element

export default function defineSolidElement<Props extends object>({
  name,
  component,
}: {
  name: string
  component: CustomElementComponent<Props>
}) {
  // tweb `:74-79` — модуль исполнен повторно (расхождение 1)
  const previousElementClass = customElements.get(name)
  if(previousElementClass) {
    return previousElementClass as unknown as ReturnType<typeof createSolidElementClass<Props>>
  }

  return createSolidElementClass(name, component)
}

function createSolidElementClass<Props extends object>(name: string, component: CustomElementComponent<Props>) {
  const SolidElement = class extends HTMLElement {
    private propsStore?: PassedProps<Props>
    private disposeContent?: () => void
    private disposeStores?: () => void

    /**
     * tweb :100-108: пропы переживают размонтирование и задаются до вставки
     * в DOM; `element` — геттер, чтобы стор не пытался обернуть узел.
     */
    private savedProps = ((self: HTMLElement) => ({
      get element() {
        return self
      },
    } as PassedProps<Props>))(this)

    connectedCallback() {
      this.mount()
    }

    disconnectedCallback() {
      this.unmount()
    }

    public get props(): PassedProps<Props> {
      return this.disposeStores ? this.propsStore! : this.savedProps
    }

    public feedProps<Full extends boolean = true>(props: Full extends true ? Props : Partial<Props>) {
      Object.assign(this.props, props)
    }

    private mount() {
      this.unmount()

      createRoot((dispose) => {
        this.disposeStores = dispose
        this.propsStore = createMutable(this.savedProps)
      })

      const props = this.propsStore!
      this.disposeContent = render(() => (
        <ErrorBoundary
          fallback={(err) => {
            console.error('solid element error', name, err)
            return null
          }}
        >
          {untrack(() => component(props))}
        </ErrorBoundary>
      ), this)
    }

    private unmount() {
      this.disposeContent?.()
      this.disposeStores?.()

      this.disposeStores = this.disposeContent = undefined

      this.replaceChildren() // Don't leave trash in there
    }
  }

  customElements.define(name, SolidElement)

  return SolidElement
}
