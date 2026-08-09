// Кнопки экрана входа — на ГЛОБАЛЬНЫХ классах tweb, без своих модульных
// (см. dom-референс §4.5). Разметка 1:1 с живым tweb:
//
//   button.btn-primary.btn-color-primary.rp            > div.c-ripple + span.i18n
//   button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
//                                                      > div.c-ripple + span.i18n
//
// Стрелка «>» у вторичных кнопок — `span.tgico.inline-icon` ВНУТРИ `span.i18n`,
// а не отдельный узел рядом.
//
// На время отправки tweb добавляет в кнопку `svg.preloader-circular` СОСЕДОМ к
// `span.i18n` (`SignInCard`/`SignUpCard`/`PasswordCard`: `{submitting() && <svg…>}`),
// а надпись меняет на `PleaseWait`. Отсюда проп `loading` у PrimaryButton: svg
// остаётся ПРЯМЫМ ребёнком кнопки — на нём держится
// `.btn-primary > svg{height: calc(100% - 20px); inset-inline-end: 15px}`, во
// вложенном узле это правило не сработало бы. У вторичных кнопок прелоадера нет
// и в tweb (`PasskeyLoginButton` на отправке только `disabled`), пропа тоже нет.
import type { ButtonHTMLAttributes, PointerEvent, ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import TgIcon from '../TgIcon'
import { PreloaderCircular } from './Preloader'

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

function useRippleHandlers(onPointerDown: AuthButtonProps['onPointerDown']) {
  const { onPointerDown: rippleDown, ripple } = useRipple()
  const handle = (e: PointerEvent<HTMLButtonElement>) => {
    rippleDown(e)
    onPointerDown?.(e)
  }
  return { handle, ripple }
}

/** Заполненная кнопка «Next» (tweb `Button('btn-primary btn-color-primary')`). */
export function PrimaryButton({
  className = '',
  children,
  loading,
  onPointerDown,
  type = 'button',
  ...rest
}: AuthButtonProps & {
  /** идёт отправка — рядом с надписью крутится `svg.preloader-circular` (tweb) */
  loading?: boolean
}) {
  const { handle, ripple } = useRippleHandlers(onPointerDown)
  return (
    <button
      type={type}
      className={classNames('btn-primary', 'btn-color-primary', 'rp', className)}
      onPointerDown={handle}
      {...rest}
    >
      {ripple}
      <span className="i18n">{children}</span>
      {loading && <PreloaderCircular />}
    </button>
  )
}

/** Прозрачная кнопка-переключатель экрана (QR / телефон / passkey). */
export function SecondaryButton({
  className = '',
  children,
  arrow,
  onPointerDown,
  type = 'button',
  ...rest
}: AuthButtonProps & { /** стрелка `>` в конце строки */ arrow?: boolean }) {
  const { handle, ripple } = useRippleHandlers(onPointerDown)
  return (
    <button
      type={type}
      className={classNames(
        'btn-primary',
        'btn-secondary',
        'btn-primary-transparent',
        'primary',
        'rp',
        className,
      )}
      onPointerDown={handle}
      {...rest}
    >
      {ripple}
      <span className="i18n">
        {children}
        {arrow && <TgIcon name="next" className="inline-icon" size={16} />}
      </span>
    </button>
  )
}
