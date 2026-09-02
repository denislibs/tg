/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/iconTsx.tsx` — та же иконка, что у императивного
 * `components/icon.ts`, но как Solid-компонент: узел строит JSX, глиф берётся
 * из ОДНОЙ карты (`getIconContent`), общей с императивной версией.
 *
 * Тип имени иконки — наш `IconName` (`@core/tgico-icons`); у tweb на его месте
 * глобальный `Icon`, объявленный ambient-типом. Разницы в значениях нет,
 * разница в том, как тип попадает в область видимости.
 */
import { splitProps, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import { getIconContent } from '@components/icon'
import type { IconName } from '@core/tgico-icons'

export type IconTsxProps = {
  icon: IconName
} & JSX.HTMLAttributes<HTMLSpanElement>

export const IconTsx = (inProps: IconTsxProps) => {
  const [props, rest] = splitProps(inProps, ['icon', 'class'])
  return (
    <span class={classNames('tgico', props.class)} {...rest}>
      {getIconContent(props.icon)}
    </span>
  )
}
