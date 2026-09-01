/**
 * Порт tweb `src/helpers/solid/passthrough.ts` — Solid-компонент поверх УЖЕ
 * СУЩЕСТВУЮЩЕГО узла: пропы применяются к нему, дети вставляются внутрь, а сам
 * узел возвращается наружу как результат компонента.
 *
 * Нужен там, где узел обязан быть построен императивно (`RippleElement` строит
 * его `document.createElement`, потому что `ripple()` вешается на конкретный
 * элемент), но пропы приходят реактивно.
 *
 * Комментарий оригинала про `insert` перенесён по смыслу, потому что он
 * описывает ПОЧИНЕННЫЙ у tweb дефект, а не просто выбор API: дети отдаются
 * `insert` ОДИН раз — тот заводит своё отслеживание и удаляет прежние узлы
 * перед вставкой новых. Прежняя редакция tweb передавала `children` в `assign`
 * внутри `createEffect`, который перезапускался на любой смене пропов; каждый
 * перезапуск шёл по ветке детей заново, ничего не зная о вставленном ранее, и
 * новый узел (например, свежий i18n-span при смене подписи) добавлялся РЯДОМ
 * со старым — на экране получалось «JUMP TO DATE JUMP TO DATE».
 */
import { children, createEffect, splitProps, untrack, type JSX, type ParentProps } from 'solid-js'
import { assign, insert } from 'solid-js/web'

export type PassthroughProps<E extends Element> = { element: E } & ParentProps & JSX.HTMLAttributes<E>

export default function Passthrough<E extends Element>(props: PassthroughProps<E>): E {
  const element = untrack(() => props.element)
  const resolved = children(() => props.children)

  insert(element, resolved)

  createEffect(() => {
    const [, others] = splitProps(props, ['element', 'children'])
    assign(element, others, element instanceof SVGElement, true)
  })

  return element
}
