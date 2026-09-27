/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/passcodeLock/passwordMonkeyTsx.tsx` (812502980) —
 * обезьянка поля пароля (`components/monkeys/password.ts`) Solid-компонентом:
 * «подглядывает», когда глазок поля показывает код; до загрузки лотти — картинка
 * закрытой обезьянки, чтобы не мигала на перезагрузке.
 *
 * Отличие одно: класс обезьянки берётся импортом, а не из
 * `useLockScreenHotReloadGuard()` (провайдер tweb — расхождение 3 шапки
 * `passcodeLockScreenController.solid.tsx`) — поведение то же.
 */
import { type Component, createRenderEffect, createSignal, mergeProps, onCleanup, type Ref, Show } from 'solid-js'
import PasswordMonkey from '@components/monkeys/password'
import type PasswordInputField from '@components/passwordInputField'
import styles from './passwordMonkeyTsx.module.scss'

const PasswordMonkeyTsx: Component<{
  ref?: Ref<HTMLDivElement>
  passwordInputField: PasswordInputField
  hidden?: boolean
  size?: number
}> = (inProps) => {
  const props = mergeProps({ size: 100 }, inProps)

  const [monkey, setMonkey] = createSignal<PasswordMonkey>()
  const [monkeyLoaded, setMonkeyLoaded] = createSignal(false)

  createRenderEffect(() => {
    const monkey = new PasswordMonkey(props.passwordInputField, props.size)
    void monkey.load().then(() => setMonkeyLoaded(true))
    setMonkey(monkey)

    onCleanup(() => {
      monkey.remove()
    })
  })

  return (
    <div
      ref={props.ref}
      class={styles.PasswordMonkey}
      classList={{
        [styles.hidden]: props.hidden,
      }}
      style={{ '--size': props.size + 'px' }}
    >
      {monkey()!.container}

      {/* Prevent the monkey blinking when reloading the page */}
      <Show when={!monkeyLoaded()}>
        <img class={styles.MonkeyImage} src="assets/img/password-monkey-closed.png" alt="" aria-hidden="true" />
      </Show>
    </div>
  )
}

export default PasswordMonkeyTsx
