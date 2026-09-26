/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/space.tsx` (812502980, 13 строк) — вертикальный
 * отступ между блоками вкладки настроек (`padding-top` = `amount`,
 * `withTransition` — переход `.2s`). Отличий от оригинала нет.
 */
import { splitProps, type JSX } from 'solid-js'

export default function Space(
  inProps: JSX.HTMLAttributes<HTMLDivElement> & {
    amount: string
    withTransition?: boolean
  },
) {
  const [props, divProps] = splitProps(inProps, ['amount', 'withTransition'])
  return (
    <div {...divProps} style={{ 'padding-top': props.amount, 'transition': props.withTransition ? '.2s' : undefined }} />
  )
}
