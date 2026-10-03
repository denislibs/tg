// ВРЕМЕННО до К-5: мост «React-остров внутри класса tweb» (правило 2 плана
// `docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`). У tweb React нет —
// оригинала у файла нет. Острова, которые им монтируются:
// - панель профиля во вкладке №0 (`components/sidebarRight/reactProfileTab.ts`, до К-5);
// - глобальные оверлеи `#react-overlays` (`components/shell/GlobalOverlays.tsx`, до
//   порта своих пачек).
//
// Зеркало `shared/solid/mountSolid.solid.tsx`: монтирует компонент в ГОТОВЫЙ узел,
// отдаёт `{ update, unmount }`. Пропы хранятся снимком, `update(patch)` делает мелкий
// мёрж и перерисовывает тот же корень (состояние дерева сохраняется). `unmount`
// снимает корень; узлы в `host` React убирает сам.
//
// Рендер синхронный (`flushSync`): классу нужен DOM острова сразу после вызова —
// вкладка №0 входит в слайдер правой колонки в том же кадре, что и
// `finishPeerChange` чата (tweb `appImManager.ts:3219-3290`). Вызов из рендера или
// эффекта другого React-дерева `flushSync` не сбросит (React предупредит) — такой
// вызывающий получит DOM на следующем такте.
import { Component, StrictMode, createElement, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ManagersProvider } from '@core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'

/**
 * Граница острова — по той же причине, что `ErrorBoundary` у `mountSolid`: упавший
 * остров не должен ронять класс, который его держит, и соседние острова. Корень
 * гаснет (`null`), ошибка уходит в консоль.
 */
class IslandErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('react island error', error, info.componentStack)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export type ReactIsland<P> = {
  update: (patch: Partial<P>) => void
  unmount: () => void
}

export function mountReact<P extends object>(
  host: HTMLElement,
  Island: ComponentType<P>,
  props: P,
  managers: Managers,
): ReactIsland<P> {
  const root = createRoot(host)
  let current = props
  let mounted = true

  const render = () => {
    flushSync(() => {
      root.render(
        <StrictMode>
          <IslandErrorBoundary>
            <ManagersProvider managers={managers}>
              {createElement(Island, current)}
            </ManagersProvider>
          </IslandErrorBoundary>
        </StrictMode>,
      )
    })
  }

  render()

  return {
    update: (patch) => {
      if (!mounted) return
      current = { ...current, ...patch }
      render()
    },
    unmount: () => {
      if (!mounted) return
      mounted = false
      root.unmount()
    },
  }
}
