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
 *
 * На HEAD (ef41b29db, 803f9599d) — две вещи, без которых на этом узле не
 * живёт `Row` (`rowTsx.solid.tsx`):
 *   • `ref` вынут из остальных пропов и зовётся один раз. В `rest` он уходил
 *     в `Passthrough` и `assign` звал его на КАЖДОМ перезапуске эффекта — у
 *     строки в `ref` заводится `createContextMenu`, и меню множились бы;
 *   • классы — через `classList` (Solid переключает ключ за ключом), а не
 *     склеенной строкой в `class`: строку Solid пишет в `className` и стирает
 *     всё, что узел получил снаружи (`menu-open` от `createContextMenu`).
 */
import { createRenderEffect, createSignal, onCleanup, splitProps, type Ref, type ValidComponent } from 'solid-js'
import type { DynamicProps } from 'solid-js/web'
import ripple from '@components/ripple'
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
  }, ['noRipple', 'rippleSquare', 'component', 'children', 'class', 'classList', 'ref'])
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

  ;(local.ref as Ref<HTMLElement> as ((el: HTMLElement) => void) | undefined)?.(el)

  return (
    <Passthrough
      element={el}
      {...rest}
      classList={{
        [local.class as string]: !!local.class,
        'rp': !local.noRipple,
        'rp-square': !local.noRipple && !!local.rippleSquare,
        ...(local.classList || {}),
      }}
    >
      {rippleElement()}
      {local.children}
    </Passthrough>
  )
}
