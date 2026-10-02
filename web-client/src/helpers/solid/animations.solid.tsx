/** @jsxImportSource solid-js */
// Порт tweb `src/helpers/solid/animations.tsx` (812502980, 1-93) — `<Animated>`:
// появление/уход ребёнка анимацией `cross-fade` / `grow-width` / `grow-height`
// (200 мс, `getTransition('standard').easing`) поверх `AnimationList`.
// Первый потребитель — плашка-подсказка над списком чатов
// (`components/sidebarLeft/pendingSuggestion.solid.tsx`, задача 2-5 волны 7).
//
// Расхождение с оригиналом одно: `GrowHeightReveal` (`:71-93`) не перенесён —
// у него нет потребителя (у tweb его зовут вкладки, которых у нас ещё нет);
// приедет вместе с первой из них.
import type { JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { AnimationList } from '@helpers/solid/animationList'
import { getTransition } from '@config/transitions'
import classNames from '@helpers/string/classNames'

type AnimationType = 'cross-fade' | 'grow-width' | 'grow-height'

export const growKeyframes = (property: 'width' | 'height', size: number): Keyframe[] => {
  return [
    { [property]: 0, opacity: 0 },
    { [property]: size + 'px', opacity: 1 },
  ]
}

const ANIMATIONS: { [key in AnimationType]: Keyframe[] | ((element: Element) => Keyframe[]) } = {
  'cross-fade': [{ opacity: 0 }, { opacity: 1 }],
  'grow-width': (element) => growKeyframes('width', element.clientWidth),
  'grow-height': (element) => growKeyframes('height', element.clientHeight),
}

// `mode` и `appear` — необязательные (`Partial`): у оригинала (без
// `strictNullChecks`) `Animated` передаёт сюда `mode?` как есть, а дефолт
// `'replacement'` ставится ниже.
export function SimpleAnimation(props: Pick<
  Parameters<typeof AnimationList>[0], 'children' | 'keyframes'
> & Partial<Pick<Parameters<typeof AnimationList>[0], 'mode' | 'appear'>> & {
  noItemClass?: boolean
  itemClass?: string
}) {
  return (
    <AnimationList
      animationOptions={{ duration: 200, easing: getTransition('standard').easing }}
      keyframes={props.keyframes}
      mode={props.mode || 'replacement'}
      itemClass={classNames(!props.noItemClass && 'animated-item', props.itemClass)}
      appear={props.appear}
    >
      {props.children}
    </AnimationList>
  )
}

export default function Animated(props: {
  children: JSX.Element
  type: AnimationType
  mode?: Parameters<typeof AnimationList>[0]['mode']
  appear?: boolean
  noItemClass?: boolean
  itemClass?: string
}) {
  return (
    <Dynamic
      component={SimpleAnimation}
      keyframes={ANIMATIONS[props.type]}
      mode={props.mode}
      appear={props.appear}
      noItemClass={props.noItemClass}
      itemClass={props.itemClass}
    >
      {props.children}
    </Dynamic>
  )
}
