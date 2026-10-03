/** @jsxImportSource solid-js */
// Порт tweb `src/components/skeleton/index.tsx` (812502980, 40 строк) — полоска-заглушка
// с бликом, пока значение грузится. Первый потребитель — подпись плашки эфира
// (`chat/topbarLive/topbarLive.solid.tsx`). Стили — `styles/tweb/_skeleton.scss`
// (у tweb `skeleton.scss` рядом с компонентом).
import { Show, splitProps, type JSX } from 'solid-js'
import { Transition } from '@vendor/solid-transition-group'
import classNames from '@helpers/string/classNames'

export interface SkeletonProps {
  loading: boolean | (() => boolean)
  secondary?: boolean
  class?: string
  children?: JSX.Element | (() => JSX.Element)
}

export const Skeleton = (props: SkeletonProps) => {
  const children = () => typeof(props.children) === 'function' ? (props.children as () => JSX.Element)() : props.children
  const loading = () => typeof(props.loading) === 'function' ? props.loading() : props.loading
  const inner = (
    <Show when={loading()} fallback={children() && (
      <div class="skeleton-child">{children()}</div>
    )}>
      <Skeleton.Div textLine secondary={props.secondary} class={props.class} aria-hidden="true" />
    </Show>
  )

  return (
    <Transition name="fade" mode="outin" duration={100}>
      {inner}
    </Transition>
  )
}

Skeleton.Div = (inProps: JSX.HTMLAttributes<HTMLDivElement> & {
  textLine?: boolean
  secondary?: boolean
}) => {
  const [props, restProps] = splitProps(inProps, ['textLine', 'secondary', 'class'])
  return (
    <div class={classNames('skeleton-base', props.textLine && 'skeleton', props.secondary && 'skeleton-base--secondary', props.class)} {...restProps} />
  )
}
