/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/passcodeLock/background.tsx` (812502980) — фон чата за
 * карточкой экрана блокировки, кроме мобильного экрана (`ScreenSize.mobile`), и
 * ручка к его градиенту: экран сдвигает градиент на каждый ввод
 * (`passcodeLockScreen.tsx:113-122`). Внутри — тот же `<ChatBackground>`, что
 * рисует фон страницы.
 *
 * Расхождения с tweb:
 *  1. `themeController`/`managers` не передаются (`:21-22`): у оригинала это
 *     подмены горячей перезагрузки (`useLockScreenHotReloadGuard`), у нас HMR-
 *     веток нет — фон берёт те же модули, что и везде.
 *  2. `useMediaSizes()` (реактивный стор tweb `helpers/mediaSizes.ts:46-52`) —
 *     сигнал на событии `changeScreen` нашего `mediaSizes`.
 */
import { type Component, createSignal, onCleanup, Show } from 'solid-js'
import mediaSizes, { ScreenSize } from '@helpers/mediaSizes'
import type ChatBackgroundGradientRenderer from '@core/chat/gradientRenderer'
import { ChatBackground } from '@components/chat/bubbles/chatBackground.solid'

const Background: Component<{
  gradientRendererRef: (value: ChatBackgroundGradientRenderer | undefined) => void
}> = (props) => {
  const [activeScreen, setActiveScreen] = createSignal(mediaSizes.activeScreen)
  const onChangeScreen = () => setActiveScreen(mediaSizes.activeScreen)
  mediaSizes.addEventListener('changeScreen', onChangeScreen)
  onCleanup(() => mediaSizes.removeEventListener('changeScreen', onChangeScreen))

  return (
    <Show when={activeScreen() !== ScreenSize.mobile}>
      <ChatBackground gradientRendererRef={props.gradientRendererRef} />
    </Show>
  )
}

export default Background
