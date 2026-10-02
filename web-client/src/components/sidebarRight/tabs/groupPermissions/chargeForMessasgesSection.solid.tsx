/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarRight/tabs/groupPermissions/chargeForMessasgesSection.tsx:1-114
 * (812502980; опечатка `Messasges` в имени — оригинальная) — секция «Плата за
 * сообщения» вкладки прав группы: тумблер `PaidMessages.ChargeForMessages` и
 * под ним, с анимацией высоты, ползунок цены в звёздах (`StarRangeInput`).
 * Свой Solid-корень (`render`), как у оригинала: вкладка вставляет готовый
 * `element` между секциями и гасит корень на `onDestroy` своего middleware.
 *
 * Расхождения с оригиналом:
 *  1. (О-119 волна 7) Подпись секции цены `PaidMessages.SetPriceGroupDescription`
 *     (:76-81: комиссия в % и примерная выручка в $) не выводится вместе с
 *     `useStarsCommissionAndWithdrawalPrice`: её аргументы — ключи
 *     `stars_paid_message_commission_permille`/`stars_usd_withdraw_rate_x1000`
 *     конфига приложения, а `help.getAppConfig` у нас нет. Бэкенд при этом
 *     зачисляет создателю всю плату (`usecase/chat/stars.go::chargePaidMessage`),
 *     вывода звёзд в валюту нет вовсе.
 *  2. `SolidJSHotReloadGuardProvider` (:93-95) не портирован — обвязка их
 *     дев-сборки (шапка `solidJsTabs/scaffoldSolidJSTab.solid.tsx`); второй
 *     параметр фабрики снят вместе с ним.
 *  3. `Transition` — наш вендор `@vendor/solid-transition-group` (форк tweb того
 *     же пакета).
 */
import { type Component, type ComponentProps, createComputed, createEffect, createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { Transition } from '@vendor/solid-transition-group'

import { i18n } from '@lib/langPack'

import { PromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import StarRangeInput from '@components/sidebarLeft/tabs/privacy/messages/starsRangeInput.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import Section from '@components/section.solid'
import Row from '@components/rowTsx.solid'

const TRANSITION_PARAMS: KeyframeAnimationOptions = { duration: 200, easing: 'ease-out' }

const ChargeForMessasgesSection: Component<{
  initialStars: number
  onStarsChange: (amount: number) => void
}> = (props) => {
  const [checked, setChecked] = createSignal(!!props.initialStars)
  const [stars, setStars] = createSignal(props.initialStars || 0)

  createComputed(() => {
    if(checked()) {
      setStars((prev) => prev || props.initialStars || 1)
    } else {
      setStars(0)
    }
  })

  let first = true
  createEffect(() => {
    if(first) {
      first = false
      stars()
      return
    }

    props.onStarsChange(stars())
  })

  return (
    <>
      <Section caption="PaidMessages.ChargeForGroupMessagesDescription">
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx toggle checked={checked()} onChange={setChecked} />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('PaidMessages.ChargeForMessages')}</Row.Title>
        </Row>
      </Section>
      <Transition
        onEnter={async(el, done) => {
          const height = el.scrollHeight
          await el.animate({ height: ['0px', height + 'px'] }, TRANSITION_PARAMS).finished

          done()
        }}
        onExit={async(el, done) => {
          const height = el.clientHeight
          await el.animate({
            height: [height + 'px', '0px'],
            opacity: [1, 0],
          }, TRANSITION_PARAMS).finished

          done()
        }}
      >
        <Show when={checked()}>
          {/* подпись `PaidMessages.SetPriceGroupDescription` — расхождение 1 (О-119) */}
          <Section
            name="PaidMessages.SetPrice"
            class="overflow-hidden"
          >
            <StarRangeInput value={stars()} onChange={setStars} />
          </Section>
        </Show>
      </Transition>
    </>
  )
}

const createChargeForMessasgesSection = (
  props: ComponentProps<typeof ChargeForMessasgesSection>,
) => {
  const element = document.createElement('div')

  const promiseCollectorHelper = PromiseCollector.createHelper()

  const dispose = render(() => (
    <PromiseCollector onCollect={promiseCollectorHelper.onCollect}>
      <ChargeForMessasgesSection {...props} />
    </PromiseCollector>
  ), element)

  return {
    element,
    dispose,
    promise: promiseCollectorHelper.await(),
  }
}

export default createChargeForMessasgesSection
