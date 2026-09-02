/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/rippleElement.tsx` — узел с волной нажатия для
 * Solid-разметки.
 *
 * Узел строится ИМПЕРАТИВНО (`document.createElement`) и отдаётся `Passthrough`,
 * а не описывается JSX-тегом: `ripple()` вешается на конкретный существующий
 * элемент, а тег `component` приходит пропом и меняется (`div`/`label`/`a` —
 * `rowTsx.solid.tsx` выбирает его по содержимому строки). Динамический тег
 * через `<Dynamic>` пересоздавал бы узел на смене пропа, и волна вместе с ним.
 *
 * Строка `ripple;` оригинала (`:6`, комментарий `keep`) НЕ перенесена: она
 * держала импорт от вытряхивания сборщиком, когда `ripple` использовался только
 * внутри эффекта; здесь он вызывается в теле `createRenderEffect`, то есть
 * обычным использованием, и удержания не требует.
 */
import { createRenderEffect, createSignal, onCleanup, splitProps, type Ref, type ValidComponent } from 'solid-js'
import type { DynamicProps } from 'solid-js/web'
import ripple from '@components/ripple'
import classNames from '@helpers/string/classNames'
import Passthrough from '@helpers/solid/passthrough'

export default function RippleElement<T extends ValidComponent>(props: DynamicProps<T> & {
  noRipple?: boolean
  rippleSquare?: boolean
}) {
  const [local, rest] = splitProps(props as DynamicProps<T> & {
    noRipple?: boolean
    rippleSquare?: boolean
    class?: string
    classList?: { [key: string]: boolean | undefined }
  }, ['noRipple', 'rippleSquare', 'component', 'children', 'class', 'classList'])
  const [rippleElement, setRippleElement] = createSignal<HTMLElement>()
  const el = document.createElement((local.component as string) || 'div')

  createRenderEffect(() => {
    if(!local.noRipple) {
      // `ripple(el, undefined, 'no')` — без аксессора и без prepend: волна
      // кладётся в конец узла (tweb :19).
      const ret = ripple(el, undefined, 'no')!
      setRippleElement(ret.element)
      onCleanup(() => {
        ret.dispose()
        setRippleElement()
      })
    }
  })

  ;(props.ref as Ref<HTMLElement> as ((el: HTMLElement) => void) | undefined)?.(el)

  return (
    <Passthrough
      element={el}
      {...rest}
      class={classNames(
        local.class,
        !local.noRipple && 'rp',
        !local.noRipple && local.rippleSquare && 'rp-square',
        ...Object.entries(local.classList || {}).map(([key, value]) => value ? key : undefined),
      )}
    >
      {rippleElement()}
      {local.children}
    </Passthrough>
  )
}
