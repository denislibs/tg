/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/badge.tsx:1-26` — счётчик
 * `badge badge-{size} badge-{color} [is-badge-empty]` через `Dynamic`
 * (тег задаёт потребитель). Потребители в оригинале — ряд вкладок папок
 * (`foldersTabs.tsx:40-46`) и строка папки в вертикальной колонке
 * (`sidebarLeft/foldersSidebarContent/folderItem.tsx`). Стили —
 * `styles/tweb/_badge.scss` (партиал оригинала).
 *
 * Расхождений с оригиналом нет: тело дословное.
 */
import { Dynamic } from 'solid-js/web'
import type { JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'

export default function Badge(props: {
  tag: 'span' | 'div'
  size: number
  color: 'primary' | 'gray'
  children: JSX.Element
  class?: string
}) {
  return (
    <Dynamic
      component={props.tag}
      class={classNames(
        'badge',
        `badge-${props.size}`,
        `badge-${props.color}`,
        !props.children && 'is-badge-empty',
        props.class,
      )}
    >
      {props.children}
    </Dynamic>
  )
}
