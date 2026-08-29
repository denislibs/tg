/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/solidJsTabs/scaffoldSolidJSTab.tsx` — фабрика
 * класса-вкладки, чьё содержимое рисует Solid, а не императивный DOM. Первый
 * настоящий потребитель моста Solid волны 0 (`shared/solid/mountSolid.solid.tsx`).
 *
 * Отличие от оригинала — РОВНО одно: вместо `render(() =>
 * <SolidJSHotReloadGuardProvider>…, div)` (:47-53, :100-106) — наш
 * `mountSolid(div, Root, props)`. `SolidJSHotReloadGuardProvider` не
 * портирован намеренно: это обвязка их дев-сборки (Vite HMR guard для
 * Solid-контекстов), у нас свой Vite без их форка. `ErrorBoundary`, который
 * в оригинале эта же обвязка попутно не даёт (см. докблок `mountSolid`), у
 * нас встроен в `mountSolid` напрямую — значит остров вкладки не роняет всю
 * вкладку целиком при падении Solid-компонента, как и было в оригинале.
 *
 * Всё остальное — дословно:
 *  • `init` НЕ отдаёт управление слайдеру, пока `promiseCollectorHelper
 *    .await()` не разрешился (:58, :113) — иначе вкладка открывается пустой
 *    и доливается на глазах уже после анимации;
 *  • `dispose` вызывается в `onCloseAfterTimeout`, ДО `super
 *    .onCloseAfterTimeout()` (:64-67, :119-122) — контент Solid обязан
 *    погаснуть раньше, чем базовый класс снимет узел вкладки и слушателей;
 *  • обе формы — `scaffoldSolidJSTab` (обычная `SliderSuperTab`) и
 *    `scaffoldSolidJSTabEventable` (`SliderSuperTabEventable` — тому же
 *    контенту доступен `tab.eventListener`, нужно вкладке «Устройства»,
 *    задача 7);
 *  • `title` может быть строкой-ключом или функцией от `payload` (:14, :74).
 *
 * `Root` — обёртка `PromiseCollector → SuperTabProvider → Component`,
 * вынесенная в отдельный компонент вместо инлайна в JSX `render()`, потому
 * что `mountSolid<P>` принимает компонент и ЕГО пропы отдельно (снимок на
 * монтирование, без реактивности снаружи — см. докблок `mountSolid`), а не
 * произвольное JSX-дерево. Сам факт монтирования и порядок вложенности —
 * тот же, что в оригинале.
 *
 * ── Адаптации под наш стек ─────────────────────────────────────────────────
 *  • `LangPackKey` (:14, :74) → строка-ключ, тот же приём, что в
 *    `sliderTab.ts` (`setTitle(key: string)`);
 *  • `SliderSuperTab`/`SliderSuperTabEventable` — наш `@components/sliderTab`
 *    (задача 4 этой же волны), а не `@components/slider`: у нас класс вкладки
 *    и слайдер-владелец в РАЗНЫХ файлах (см. докблок `slider.ts`).
 */
import type { Component } from 'solid-js'
import { mountSolid } from '@shared/solid/mountSolid.solid'
import type { InstanceOf } from '@types'
import SliderSuperTab, { SliderSuperTabEventable } from '@components/sliderTab'
import type { EventListenerListeners } from '@helpers/eventListenerBase'
import { PromiseCollector } from './promiseCollector.solid'
import { SuperTabProvider } from './superTabProvider.solid'

/** Общее дерево контента для обоих вариантов — см. докблок файла. */
function Root(props: { self: SliderSuperTab; onCollect: (promise: Promise<any>) => void; Content: Component }) {
  return (
    <PromiseCollector onCollect={props.onCollect}>
      <SuperTabProvider self={props.self}>
        <props.Content />
      </SuperTabProvider>
    </PromiseCollector>
  )
}

type ScaffoldSolidJSTabArgs<Payload> = {
  title: string | ((payload: Payload) => string)
  getComponentModule: () => Promise<{ default: Component }>
  onOpenAfterTimeout?: (this: InstanceOf<ScaffoledClass<Payload>>) => void
  onClose?: (this: InstanceOf<ScaffoledClass<Payload>>) => void
  onCloseAfterTimeout?: (this: InstanceOf<ScaffoledClass<Payload>>) => void
}

type ScaffoledClass<Payload = void> = new (
  ...args: ConstructorParameters<typeof SliderSuperTab>
) => SliderSuperTab & {
  payload: Payload
  init(payload: Payload, overrideTitle?: string): Promise<void>
}

export function scaffoldSolidJSTab<Payload = void>({
  title,
  getComponentModule,
  onOpenAfterTimeout,
  onClose,
  onCloseAfterTimeout,
}: ScaffoldSolidJSTabArgs<Payload>): ScaffoledClass<Payload> {
  return class extends SliderSuperTab {
    public payload!: Payload

    private dispose?: () => void

    public async init(payload: Payload, overrideTitle?: string) {
      this.setTitle(overrideTitle || (typeof title === 'function' ? title(payload) : title))
      this.payload = payload

      const div = document.createElement('div')

      const { default: Content } = await getComponentModule()

      const promiseCollectorHelper = PromiseCollector.createHelper()

      this.dispose = mountSolid(div, Root, { self: this, onCollect: promiseCollectorHelper.onCollect, Content })

      this.scrollable.append(div)

      await promiseCollectorHelper.await()
    }

    protected onClose() {
      onClose?.call?.(this)
    }

    protected onCloseAfterTimeout() {
      onCloseAfterTimeout?.call?.(this)
      this.dispose?.()
      super.onCloseAfterTimeout()
    }

    protected onOpenAfterTimeout() {
      onOpenAfterTimeout?.call?.(this)
    }
  } as unknown as ScaffoledClass<Payload>
}

type ScaffoldSolidJSTabEventableArgs<Payload> = {
  title: string | ((payload: Payload) => string)
  getComponentModule: () => Promise<{ default: Component }>
  onOpenAfterTimeout?: (this: InstanceOf<ScaffoledEventableClass<Payload>>) => void
}

type ScaffoledEventableClass<Payload = void, Events extends EventListenerListeners = {}> = new (
  ...args: ConstructorParameters<typeof SliderSuperTab>
) => SliderSuperTabEventable<Events> & {
  payload: Payload
  init(payload: Payload, overrideTitle?: string): Promise<void>
}

/**
 * То же самое, что {@link scaffoldSolidJSTab}, но вкладка — это
 * {@link SliderSuperTabEventable}: Solid-содержимое может слать события через
 * `tab.eventListener` (и внешний код, открывший вкладку, может их слушать) —
 * нужно, например, вкладке «Устройства», которая сохраняет состояние по
 * событию `destroy` вкладки.
 */
export function scaffoldSolidJSTabEventable<Payload = void, Events extends EventListenerListeners = {}>({
  title,
  getComponentModule,
  onOpenAfterTimeout,
}: ScaffoldSolidJSTabEventableArgs<Payload>): ScaffoledEventableClass<Payload, Events> {
  return class extends SliderSuperTabEventable<Events> {
    public payload!: Payload

    private dispose?: () => void

    public async init(payload: Payload, overrideTitle?: string) {
      this.setTitle(overrideTitle || (typeof title === 'function' ? title(payload) : title))
      this.payload = payload

      const div = document.createElement('div')

      const { default: Content } = await getComponentModule()

      const promiseCollectorHelper = PromiseCollector.createHelper()

      this.dispose = mountSolid(div, Root, { self: this, onCollect: promiseCollectorHelper.onCollect, Content })

      this.scrollable.append(div)

      await promiseCollectorHelper.await()
    }

    public onCloseAfterTimeout() {
      this.dispose?.()
      return super.onCloseAfterTimeout()
    }

    protected onOpenAfterTimeout() {
      onOpenAfterTimeout?.call?.(this)
    }
  } as unknown as ScaffoledEventableClass<Payload, Events>
}
