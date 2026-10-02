/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/passcodeLock/mainTab.tsx:1-315
 * (812502980) — вкладка «Код-пароль» (`AppPasscodeLockTab`, `solidJsTabs/tabs.ts`),
 * задача 18 плана волны 2D. Код не задан — заставка, описание, «Turn Passcode On»
 * (два шага ввода во вкладках `AppPasscodeEnterPasswordTab`); задан — «Turn
 * Passcode Off» (попап подтверждения), «Change passcode», автоблокировка
 * (`InlineSelect`), тумблер сочетания блокировки и `ShortcutBuilder`.
 * Открывает её строка `PasscodeLock.Item.Title` раздела конфиденциальности.
 *
 * Расхождения с оригиналом:
 *  1. Настройки — мост `useAppSettings()` над zustand (О-2): `createResource`
 *     из `appStateManager.getState()` + подписка `settings_updated` (`:47-63`,
 *     `:152-181`) здесь не нужны — `appSettings.passcode.*` реактивны сами, а
 *     запись идёт тем же `setAppSettings`, что у оригинала. Поэтому нет и
 *     `Show when={… .state === 'ready'}` (`:66`, `:278`) и `usePromiseCollector`
 *     для флага (`:47-53`): значение синхронно.
 *  2. `usePasscodeActions()` → `passcodeActions(tab.managers.persist)`
 *     (`lib/passcode/actions.ts`): не хук — канал к воркеру у нас синглтон,
 *     а включению нужен writer офлайн-стора (его под кодом не шифруют, а
 *     стирают, docs/tweb/passcode-encryption.md П-1).
 *  3. (снято задачей 23) Подсказка после выключения — в скроллере хаба
 *     `AppPrivacyAndSecurityTab` (`:244-246`), как у оригинала.
 *  4. `setQuizHint` — `components/quizHint.ts` без `canCloseOnPeerChange`
 *     (шапка того файла): закрытия по смене чата у нас нет, а здесь оно и
 *     выключено (`:41`).
 *  5. `confirmationPopup` — наш `popups/popupPeer.ts`: заголовок и описание
 *     ключами (`titleLangKey`/`descriptionLangKey`), кнопка — `langKey`, а не
 *     готовые узлы `i18n(…)` (`:222-229`).
 *  6. `keepMe(ripple)` → `void ripple`; `caption as any` (`:271`) →
 *     `Exclude<JSX.Element, string>` (тип подписи нашего `Section`).
 *  7. Несовпадение кодов — `throw new Error(…)`, а не `throw {}` (`:94`, `:214`):
 *     oxlint `no-throw-literal`; ловит вкладка ввода, исход тот же.
 */
import { type Component, createSignal, type JSX, Show } from 'solid-js'
import { IS_MOBILE } from '@environment/userAgent'
import { i18n, type LangPackKey } from '@lib/langPack'
import { passcodeActions } from '@lib/passcode/actions'
import { useAppSettings } from '@stores/appSettings.solid'
import SettingsTabLottieAnimation from '@components/settingsTabLottieAnimation.solid'
import ripple from '@components/ripple'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import { AppPasscodeEnterPasswordTab, AppPasscodeLockTab, AppPrivacyAndSecurityTab } from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import Space from '@components/space.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import { confirmationPopup } from '@components/popups/popupPeer'
import { setQuizHint } from '@components/quizHint'
import commonStyles from '@components/sidebarLeft/tabs/passcodeLock/common.module.scss'
import InlineSelect from '@components/sidebarLeft/tabs/passcodeLock/inlineSelect.solid'
import styles from '@components/sidebarLeft/tabs/passcodeLock/mainTab.module.scss'
import ShortcutBuilder, { type ShortcutKey } from '@components/sidebarLeft/tabs/passcodeLock/shortcutBuilder.solid'

void ripple

type AppPasscodeLockTabType = typeof AppPasscodeLockTab

const getHintParams = (tab: SliderSuperTab, title: LangPackKey) => ({
  appendTo: tab.scrollable.container,
  duration: 2500,
  from: 'bottom',
  textElement: i18n(title),
  icon: 'premium_lock',
  class: styles.Hint,
} as const)

const MainTab = () => {
  const [appSettings] = useAppSettings()

  const [isDisabling, setIsDisabling] = createSignal(false)

  return (
    <>
      {
        appSettings.passcode.enabled || isDisabling() ?
          <PasscodeSetContent onDisable={() => setIsDisabling(true)} /> :
          <NoPasscodeContent />
      }
    </>
  )
}

const NoPasscodeContent = () => {
  const [tab] = useSuperTab<AppPasscodeLockTabType>()
  const slider = tab.slider as unknown as SidebarSlider

  const onEnable = () => {
    void slider.createTab(AppPasscodeEnterPasswordTab)
    .open({
      onSubmit: (passcode) => {
        onSecondStep(passcode)
        passcode = ''
      },
      buttonText: 'PasscodeLock.Next',
      inputLabel: 'PasscodeLock.EnterAPasscode',
    })
  }

  const onSecondStep = (firstPasscode: string) => {
    void slider.createTab(AppPasscodeEnterPasswordTab)
    .open({
      onSubmit: async(passcode, otherTab, { enablePasscode }) => {
        if(passcode !== firstPasscode) throw new Error('PASSCODES_DONT_MATCH')
        await enablePasscode(passcode)
        passcode = ''
        const otherSlider = otherTab.slider as unknown as SidebarSlider
        otherSlider.sliceTabsUntilTab(AppPasscodeLockTab, otherTab)
        otherTab.close()

        setQuizHint(getHintParams(tab, 'PasscodeLock.PasscodeHasBeenSet'))
      },
      buttonText: 'PasscodeLock.SetPasscode',
      inputLabel: 'PasscodeLock.ReEnterPasscode',
    })
  }

  return (
    <Section caption="PasscodeLock.Notice">
      <SettingsTabLottieAnimation name="UtyanPasscode" />

      <div class={styles.MainDescription}>{i18n('PasscodeLock.Description')}</div>

      <Space amount="0.5rem" />

      <div class={commonStyles.AdditionalPadding}>
        <button
          use:ripple
          class="btn-primary btn-color-primary btn-large"
          onClick={onEnable}
        >
          {i18n('PasscodeLock.TurnOn')}
        </button>
      </div>

      <Space amount="1rem" />
    </Section>
  )
}

const PasscodeSetContent: Component<{
  onDisable: () => void
}> = (props) => {
  const [tab] = useSuperTab<AppPasscodeLockTabType>()
  const slider = tab.slider as unknown as SidebarSlider
  const { disablePasscode, changePasscode } = passcodeActions(tab.managers!.persist)
  const [appSettings, setAppSettings] = useAppSettings()

  const options = [
    { value: 0, label: () => i18n('PasscodeLock.Disabled') },
    { value: 1, label: () => i18n('MinutesShort', [1]) },
    { value: 5, label: () => i18n('MinutesShort', [5]) },
    { value: 10, label: () => i18n('MinutesShort', [10]) },
    { value: 15, label: () => i18n('MinutesShort', [15]) },
    { value: 30, label: () => i18n('MinutesShort', [30]) },
  ]

  const [autoCloseRowEl, setAutoCloseRowEl] = createSignal<HTMLElement>()
  const [isOpen, setIsOpen] = createSignal(false)

  const lockTimeout = () => appSettings.passcode.autoLockTimeoutMins || 0
  const shortcutEnabled = () => appSettings.passcode.lockShortcutEnabled || false
  const shortcutKeys = () => appSettings.passcode.lockShortcut || []

  function setShortcutKeys(value: ShortcutKey[]) {
    void setAppSettings('passcode', 'lockShortcut', value)
  }

  function setShortcutEnabled(value: boolean) {
    void setAppSettings('passcode', 'lockShortcutEnabled', value)
  }

  function setLockTimeout(value: number) {
    void setAppSettings('passcode', 'autoLockTimeoutMins', value)
  }

  const canShowShortcut = () => !IS_MOBILE

  const onPasscodeChange = () => {
    void slider.createTab(AppPasscodeEnterPasswordTab)
    .open({
      onSubmit: (passcode) => {
        onChangeSecondStep(passcode)
        passcode = '' // forget
      },
      buttonText: 'PasscodeLock.Next',
      inputLabel: 'PasscodeLock.EnterAPasscode',
    }, 'PasscodeLock.EnterANewPasscode')
  }

  const onChangeSecondStep = (firstPasscode: string) => {
    void slider.createTab(AppPasscodeEnterPasswordTab)
    .open({
      onSubmit: async(passcode, otherTab) => {
        if(passcode !== firstPasscode) throw new Error('PASSCODES_DONT_MATCH')
        await changePasscode(passcode)
        passcode = '' // forget
        const otherSlider = otherTab.slider as unknown as SidebarSlider
        otherSlider.sliceTabsUntilTab(AppPasscodeLockTab, otherTab)
        otherTab.close()

        setQuizHint(getHintParams(tab, 'PasscodeLock.PasscodeHasBeenChanged'))
      },
      buttonText: 'PasscodeLock.SetPasscode',
      inputLabel: 'PasscodeLock.ReEnterPasscode',
    }, 'PasscodeLock.ReEnterPasscode')
  }

  const onDisable = () => {
    confirmationPopup({
      titleLangKey: 'PasscodeLock.TurnOff.Title',
      descriptionLangKey: 'PasscodeLock.TurnOff.Description',
      button: {
        langKey: 'PasscodeLock.TurnOff',
        isDanger: true,
      },
    })
    .then(async() => {
      props.onDisable()
      await disablePasscode()
      tab.close()
      setQuizHint(getHintParams(
        slider.getTab(AppPrivacyAndSecurityTab)!, 'PasscodeLock.PasscodeHasBeenDisabled',
      ))
    })
    .catch(() => {})
  }

  const caption = (
    <>
      {i18n('PasscodeLock.Description')}
      <Space amount="1rem" />
      {i18n('PasscodeLock.Notice')}
    </>
  )

  return (
    <>
      <Section class={styles.FirstSection} caption={caption as Exclude<JSX.Element, string>}>
        <SettingsTabLottieAnimation name="UtyanPasscode" />

        <Space amount="1.125rem" />

        <Row clickable={onDisable}>
          <Row.Icon icon="lockoff" />
          <Row.Title>{i18n('PasscodeLock.TurnOff.Title')}</Row.Title>
        </Row>
        <Row clickable={onPasscodeChange}>
          <Row.Icon icon="key_filled" />
          <Row.Title>{i18n('PasscodeLock.ChangePasscode')}</Row.Title>
        </Row>
      </Section>

      <Section caption={canShowShortcut() ? 'PasscodeLock.LockShortcutDescription' : undefined}>
        <Row
          ref={setAutoCloseRowEl}
          class={styles.Row}
          clickable={() => {
            setIsOpen(true)
          }}
        >
          <Row.Title>{i18n('PasscodeLock.AutoLock')}</Row.Title>
          <Row.RightContent>
            <InlineSelect
              value={lockTimeout()}
              onClose={() => setIsOpen(false)}
              options={options}
              onChange={setLockTimeout}
              isOpen={isOpen()}
              parent={autoCloseRowEl()!}
            />
          </Row.RightContent>
        </Row>
        <Show when={canShowShortcut()}>
          <Row>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx toggle checked={shortcutEnabled()} onChange={setShortcutEnabled} />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('PasscodeLock.EnableLockShortcut')}</Row.Title>
          </Row>
          <div class={styles.ShortcutBuilderRow} classList={{ [styles.collapsed]: !shortcutEnabled() }}>
            <ShortcutBuilder class={styles.ShortcutBuilderRowChild} value={shortcutKeys()} onChange={setShortcutKeys} key="L" />
          </div>
        </Show>
      </Section>

    </>
  )
}

export default MainTab
