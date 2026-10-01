/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/2fa/passwordSet.tsx:1-44 (812502980) —
 * финальная вкладка мастера 2FA (`AppTwoStepVerificationSetTab`): заставка 🥳,
 * подпись внутри карточки (`captionOld`), «Return to Settings» закрывает вкладку;
 * на монтировании шаги мастера срезаются из истории, чтобы «назад» не вело
 * обратно по ним.
 *
 * Расхождения с оригиналом:
 *  1. Заставка — как на главной вкладке (`index.solid.tsx`, п. 3).
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import { getMiddleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import Button from '@components/buttonTsx.solid'
import Section from '@components/section.solid'
import wrapStickerEmoji from '@components/wrappers/stickerEmoji'
import type SidebarSlider from '@components/slider'
import { AppSettingsTab, type AppTwoStepVerificationSetTab } from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'

const TwoStepVerificationSet: Component = () => {
  const [tab] = useSuperTab<typeof AppTwoStepVerificationSetTab>()
  const { messageFor } = tab.payload

  const stickerMiddleware = getMiddleware()
  onCleanup(() => stickerMiddleware.destroy())
  const stickerContainer = document.createElement('div')
  wrapStickerEmoji({
    emoji: '🥳',
    div: stickerContainer,
    width: 160,
    height: 160,
    middleware: stickerMiddleware.get(),
  }).catch(noop)

  onMount(() => {
    tab.container.classList.add('two-step-verification', 'two-step-verification-set')
    ;(tab.slider as SidebarSlider).sliceTabsUntilTab(AppSettingsTab, tab)
  })

  return (
    <Section
      caption={messageFor === 'password' ? 'TwoStepVerificationPasswordSetInfo' : 'TwoStepVerificationEmailSetInfo'}
      captionOld
      noDelimiter
    >
      {stickerContainer}
      <div class="input-wrapper">
        <Button
          primaryFilled
          text="TwoStepVerificationPasswordReturnSettings"
          onClick={() => tab.close()}
        />
      </div>
    </Section>
  )
}

export default TwoStepVerificationSet
