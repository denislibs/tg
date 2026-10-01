/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacyAndSecurity.tsx:1-700 (812502980) —
 * хаб «Конфиденциальность и безопасность», вкладка `AppPrivacyAndSecurityTab`
 * (`solidJsTabs/tabs.ts`, tweb `tabs.ts:651-667`). Задача 23 плана волны 2D.
 *
 * Дословно: класс `dont-u-dare-block-me` (:123); первая секция без имени,
 * `noDelimiter`, подпись `SessionsInfo` (:656-660) — «Заблокированные»,
 * «Автоудаление», «Код-пароль», «Двухэтапная проверка», «Passkeys», у всех
 * значение — `Row.Subtitle`, до ответа `Loading`, строка «заморожена» до ответа
 * (:125-310); перечитывание чёрного списка на `peer_block` (:320-337);
 * «Код-пароль» при включённом коде — сначала ввод текущего (:193-210); 2FA —
 * ввод пароля или мастер (:257-271); Passkeys — Solid-стор ключей, читаемый на
 * открытии хаба, подпись и видимость следят за ним, без ключей — интро-попап
 * (:156-191, :289-307); секция `PrivacyTitle` с контентом
 * `privacy-navigation-container` (:661-665) — строки правил в порядке :416-472,
 * подпись «Тип (-d, +a)» (:517-535), звезда премиума у голосовых и сообщений
 * (:438-462); `FilterChats` — `Button` удаления облачных черновиков с попапом
 * `popup-delete-drafts`, кнопка выключена до ответа (:105-120, :687-695).
 *
 * Наших строк, которых у оригинала здесь нет, больше нет (решение пользователя
 * «оставь как в tweb»): «Активные сессии» — у tweb это «Устройства» корня
 * настроек (`settings.tsx:391-397`, у нас тоже есть); «Удалить мой аккаунт» — в
 * приложении у tweb нет вовсе, удаление аккаунта у него только сброс со входа
 * («Забыли пароль» → `deleteAccount`, у нас `auth/cards/PasswordCard.solid.tsx`);
 * «Время прочтения» — у tweb тумблер «Hide Read Time» вкладки «Был в сети»
 * (`privacy/lastSeen.tsx:64-74`), туда и перенесён (`privacy/lastSeen.solid.tsx`).
 *
 * Расхождения с оригиналом:
 *  1. (О-18) Не рисуются: строка web sessions (:139-142, :163-170, :223-237,
 *     :366), строка Login email (:149-151, :277-288, :344-348), секции
 *     `NewChatsFromNonContacts` (:547-595, :666-671), `Privacy.SensitiveContent`
 *     (:597-646, :672-677) и `PrivacyPayments` (:73-103, :678-686) — нет
 *     `webAuthorizations`, login email, `globalPrivacySettings`, `contentSettings`
 *     и очистки платёжных данных. Отсюда же нет полезной нагрузки вкладки
 *     (`p.appConfig`/`p.globalPrivacy`/`p.webAuthorizations`) и `promiseCollector`
 *     (:57, :648-651): ждать сборке нечего, все её промисы — эти предметы.
 *  2. Менеджеры: `appUsersManager.getBlocked` → `managers.privacy.getBlocked`;
 *     `passwordManager.getState` → `managers.auth.passwordState` (признак пароля —
 *     `enabled`, а не `pFlags.has_password`); ветки `email_unconfirmed_pattern`
 *     (:261-268) нет — О-13; `appAccountManager.getPasskeys` →
 *     `managers.auth.passkeysList`; `appPrivacyManager.getDefaultAutoDeletePeriod`
 *     → `managers.privacy.autoDelete`; `appDraftsManager.clearAllDrafts` →
 *     `managers.drafts.clearAll`, после него — `managers.dialogs.refresh()`:
 *     черновик — поле диалога, а наш менеджер черновиков об очистке не объявляет.
 *  3. Видимость Passkeys: `appConfig.settings_display_passkeys` (:186) нет —
 *     `help.getAppConfig` у нас нет (как у О-51), считается истиной; среда
 *     `IS_WEB_AUTHN_SUPPORTED` → `isWebAuthnSupported()` (шапка `passkeys.solid.tsx`).
 *  4. «Код-пароль»: `appStateManager.getState` + `settings_updated` (:353-364) →
 *     `useAppSettings().passcode.enabled` (мост над zustand, О-2): значение
 *     синхронно, строка не «замораживается».
 *  5. Правила: кэш — стор `stores/privacyStore.ts` (роль кэша
 *     `appPrivacyManager`, расхождение 2 шапки `privacySection.solid.tsx`) вместо
 *     `getPrivacy` + `privacy_update` (:517, :542-544); не загружен — загрузка
 *     стора. Правило уже разобрано (`PrivacyRule`), `getPrivacyRulesDetails` не
 *     нужен; мини-приложений (О-33) и чатов в исключениях (О-17) нет. Строк
 *     Gifts/SavedMusic (:467-472) нет — ключей нет (О-16). «Сообщения» — наше
 *     обычное правило `messages` (О-15): подпись — из правила, а не из
 *     `globalPrivacy` (:499-515), вкладка без `onSaved` (:455-460).
 *  6. `isPremiumFeaturesHidden` (:386-387, :450) — источника нет, всегда ложь
 *     (как `premiumBlocked` корня, О-41): подпись `Privacy.MessagesCaption`,
 *     строки голосовых и сообщений видны всегда. Премиум — зеркало `me` из
 *     `chatsStore` (мост чтения) вместо `rootScope.premium` + `premium_toggle`.
 *  7. `renderComponent` в узлы-рефы секций (:212, :474) → строки — дети `Section`
 *     прямо в JSX: порта `helpers/solid/renderComponent` нет, разметка та же.
 *  8. `showPeerPopup('popup-delete-drafts')` (:106) →
 *     `PopupElement.createPopup(PopupPeer, …)` (как `2fa/index.solid.tsx`);
 *     `showPasskeyPopup` — мост к React-попапу до 2C-10 (`settingsPopups.tsx`).
 */
import { createEffect, createMemo, createRoot, createSignal, For, onMount, type JSX } from 'solid-js'
import { createStore, type SetStoreFunction } from 'solid-js/store'
import type { Passkey } from '@layer'
import type { PasswordState } from '@core/managers/authManager'
import type { PrivacyKey, PrivacyRule, PrivacyValue } from '@core/managers/privacyManager'
import { isWebAuthnSupported } from '@core/webauthnBrowser'
import { i18n, type LangPackKey } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import toggleDisability from '@helpers/dom/toggleDisability'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { useAppSettings } from '@stores/appSettings.solid'
import { useChatsStore } from '@stores/chatsStore'
import { loadPrivacy, usePrivacyStore } from '@stores/privacyStore'
import Icon from '@components/icon'
import Button from '@components/buttonTsx.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import { showPasskeyPopup } from '@components/sidebarLeft/settingsPopups'
import { findExistingOrCreateCustomOption } from '@components/sidebarLeft/tabs/autoDeleteMessages/options'
import type SidebarSlider from '@components/slider'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import {
  AppBlockedUsersTab,
  AppMessagesAutoDeleteTab,
  AppPasscodeEnterPasswordTab,
  AppPasscodeLockTab,
  AppPasskeysTab,
  AppPrivacyAboutTab,
  AppPrivacyAddToGroupsTab,
  AppPrivacyBirthdayTab,
  AppPrivacyCallsTab,
  AppPrivacyForwardMessagesTab,
  AppPrivacyLastSeenTab,
  AppPrivacyMessagesTab,
  AppPrivacyPhoneNumberTab,
  AppPrivacyProfilePhotoTab,
  AppPrivacyVoicesTab,
  AppTwoStepVerificationEnterPasswordTab,
  AppTwoStepVerificationTab,
  type AppPrivacyAndSecurityTab,
} from '@components/solidJsTabs/tabs'

/** tweb :493-497 — подпись типа правила. */
const TYPE_LANG_KEYS: Record<PrivacyValue, LangPackKey> = {
  everybody: 'PrivacySettingsController.Everbody',
  contacts: 'PrivacySettingsController.MyContacts',
  nobody: 'PrivacySettingsController.Nobody',
}

const PrivacyAndSecurity = () => {
  const [tab] = useSuperTab<typeof AppPrivacyAndSecurityTab>()
  const managers = tab.managers!
  const slider = tab.slider as SidebarSlider
  const [appSettings] = useAppSettings()

  let deleteButton!: HTMLElement

  const SUBTITLE: LangPackKey = 'Loading'

  // ── первая секция (tweb :129-383) ──────────────────────────────────────────
  let blockedPeerIds: PeerId[]
  let passwordState: PasswordState
  let passkeys: Passkey[]
  let setPasskeys: SetStoreFunction<Passkey[]>
  let autoDeletePeriod: number

  const [blockedSubtitle, setBlockedSubtitle] = createSignal<JSX.Element>(i18n(SUBTITLE))
  const [blockedFrozen, setBlockedFrozen] = createSignal(true)
  const [autoDeleteSubtitle, setAutoDeleteSubtitle] = createSignal<JSX.Element>(i18n(SUBTITLE))
  const [autoDeleteFrozen, setAutoDeleteFrozen] = createSignal(true)
  const [twoFactorSubtitle, setTwoFactorSubtitle] = createSignal<JSX.Element>(i18n(SUBTITLE))
  const [twoFactorFrozen, setTwoFactorFrozen] = createSignal(true)
  const [passkeysSubtitle, setPasskeysSubtitle] = createSignal<JSX.Element>(i18n(SUBTITLE))
  const [passkeysFrozen, setPasskeysFrozen] = createSignal(true)
  const [passkeysHidden, setPasskeysHidden] = createSignal(false)

  // расхождение 4
  const passcodeEnabled = () => appSettings.passcode.enabled
  const passcodeSubtitle = createMemo(() => i18n(passcodeEnabled() ? 'PrivacyAndSecurity.Item.On' : 'PrivacyAndSecurity.Item.Off'))

  const openPasskeysTab = () => {
    void slider.createTab(AppPasskeysTab).open({
      passkeys,
      setPasskeys,
    })
  }

  const updatePasskeys = () => {
    setPasskeysFrozen(true)
    return managers.auth.passkeysList().then((passkeysResult) => {
      setPasskeysFrozen(false)
      ;[passkeys, setPasskeys] = createStore(passkeysResult)

      createRoot((dispose) => {
        tab.middlewareHelper.onDestroy(dispose)
        createEffect(() => {
          setPasskeysSubtitle(i18n('Passkeys', [passkeys.length]))
          // расхождение 3: `settings_display_passkeys` считается истиной
          setPasskeysHidden(!passkeys.length && !isWebAuthnSupported())
        })
      })
    })
  }

  const openPasscodeLock = () => {
    if(passcodeEnabled()) {
      void slider.createTab(AppPasscodeEnterPasswordTab).open({
        buttonText: 'PasscodeLock.Next',
        inputLabel: 'PasscodeLock.EnterYourPasscode',
        onSubmit: async(passcode, _, { isMyPasscode }) => {
          const isCorrect = await isMyPasscode(passcode)
          passcode = ''
          if(!isCorrect) throw {}

          void slider.createTab(AppPasscodeLockTab).open()
        },
      })
    } else {
      void slider.createTab(AppPasscodeLockTab).open()
    }
  }

  const setBlockedCount = (count: number) => {
    setBlockedSubtitle(i18n(
      count ? 'PrivacySettingsController.UserCount' : 'BlockedEmpty',
      [count],
    ))
  }

  const updateBlocked = () => {
    void managers.privacy.getBlocked().then((res) => {
      setBlockedCount(res.count)
      blockedPeerIds = res.peerIds
      setBlockedFrozen(false)
    })
  }

  function updateAutoDeleteRow() {
    setAutoDeleteSubtitle(
      !autoDeletePeriod ?
        i18n('Off') :
        findExistingOrCreateCustomOption(autoDeletePeriod).label(),
    )
  }

  // ── секция правил (tweb :385-545) ──────────────────────────────────────────
  // расхождение 5: значения — стор правил, его смена = `privacy_update`
  const privacy = subscribeExternal(usePrivacyStore.subscribe, () => usePrivacyStore.getState())
  // расхождение 6
  const isPremium = subscribeExternal(useChatsStore.subscribe, () => !!useChatsStore.getState().me?.user.pFlags?.premium)

  type PrivacyRow = {
    key: PrivacyKey
    title: JSX.Element
    clickable: () => void
  }

  const rows: PrivacyRow[] = []
  const addRow = (key: PrivacyKey, title: JSX.Element, clickable: () => void) => {
    rows.push({ key, title, clickable })
  }

  const createPremiumTitle = (langKey: LangPackKey) => {
    const fragment = document.createDocumentFragment()
    const icon = Icon('star', 'privacy-premium-icon')
    fragment.append(i18n(langKey), icon)
    createEffect(() => {
      icon.classList.toggle('hide', !isPremium())
    })
    return fragment
  }

  addRow('phone_number', i18n('PrivacyPhoneTitle'), () => {
    void slider.createTab(AppPrivacyPhoneNumberTab).open()
  })
  addRow('last_seen', i18n('LastSeenTitle'), () => {
    void slider.createTab(AppPrivacyLastSeenTab).open()
  })
  addRow('profile_photo', i18n('PrivacyProfilePhotoTitle'), () => {
    void slider.createTab(AppPrivacyProfilePhotoTab).open()
  })
  addRow('about', i18n('Privacy.BioRow'), () => {
    void slider.createTab(AppPrivacyAboutTab).open()
  })
  addRow('calls', i18n('WhoCanCallMe'), () => {
    void slider.createTab(AppPrivacyCallsTab).open()
  })
  addRow('forwards', i18n('PrivacyForwardsTitle'), () => {
    void slider.createTab(AppPrivacyForwardMessagesTab).open()
  })
  addRow('chat_invite', i18n('WhoCanAddMe'), () => {
    void slider.createTab(AppPrivacyAddToGroupsTab).open()
  })
  addRow('voice_messages', createPremiumTitle('PrivacyVoiceMessagesTitle'), () => {
    void slider.createTab(AppPrivacyVoicesTab).open()
  })
  addRow('messages', createPremiumTitle('PrivacyMessagesTitle'), () => {
    void slider.createTab(AppPrivacyMessagesTab).open()
  })
  addRow('birthday', i18n('Privacy.BirthdayRow'), () => {
    void slider.createTab(AppPrivacyBirthdayTab).open()
  })

  // tweb :517-535
  const privacyRowSubtitle = (rule: PrivacyRule): JSX.Element => {
    const disallowLength = rule.denyUserIds.length
    const allowLength = rule.allowUserIds.length

    const subtitle: JSX.Element[] = [i18n(TYPE_LANG_KEYS[rule.value])]
    if(disallowLength || allowLength) {
      subtitle.push(` (${[-disallowLength, allowLength ? '+' + allowLength : 0].filter(Boolean).join(', ')})`)
    }
    return subtitle
  }

  // ── облачные черновики (tweb :105-120) ─────────────────────────────────────
  const onDeleteClick = () => {
    PopupElement.createPopup(PopupPeer, 'popup-delete-drafts', {
      buttons: [{
        langKey: 'Delete',
        callback: () => {
          const toggle = toggleDisability([deleteButton], true)
          void managers.drafts.clearAll().then(() => {
            toggle()
            // расхождение 2
            void managers.dialogs.refresh().catch(() => {})
          })
        },
        isDanger: true,
      }],
      titleLangKey: 'AreYouSureClearDraftsTitle',
      descriptionLangKey: 'AreYouSureClearDrafts',
    }).show()
  }

  onMount(() => {
    tab.container.classList.add('dont-u-dare-block-me')

    tab.listenerSetter.add(rootScope)('peer_block', () => {
      updateBlocked()
    })

    updateBlocked()

    void managers.auth.passwordState().then((state) => {
      passwordState = state
      setTwoFactorSubtitle(i18n(state.enabled ? 'PrivacyAndSecurity.Item.On' : 'PrivacyAndSecurity.Item.Off'))
      setTwoFactorFrozen(false)
    })

    void updatePasskeys()

    void (async() => {
      autoDeletePeriod = await managers.privacy.autoDelete()
      updateAutoDeleteRow()
      setAutoDeleteFrozen(false)
    })()

    // расхождение 5: стор ещё не загружен — тот же путь, что на старте
    if(!usePrivacyStore.getState().loaded) {
      void loadPrivacy(managers)
    }
  })

  return (
    <>
      <Section caption="SessionsInfo" noDelimiter>
        <Row clickable={() => {
          if(!blockedFrozen()) void slider.createTab(AppBlockedUsersTab).open({ peerIds: blockedPeerIds })
        }}>
          <Row.Icon icon="person_crossed_filled" />
          <Row.Title>{i18n('BlockedUsers')}</Row.Title>
          <Row.Subtitle>{blockedSubtitle()}</Row.Subtitle>
        </Row>
        <Row clickable={() => {
          if(autoDeleteFrozen() || isNaN(autoDeletePeriod)) return
          void slider.createTab(AppMessagesAutoDeleteTab).open({
            period: autoDeletePeriod,
            onSaved: (period) => {
              autoDeletePeriod = period
              updateAutoDeleteRow()
            },
          })
        }}>
          <Row.Icon icon="auto_delete_filled" />
          <Row.Title>{i18n('AutoDeleteMessages')}</Row.Title>
          <Row.Subtitle>{autoDeleteSubtitle()}</Row.Subtitle>
        </Row>
        <Row clickable={() => openPasscodeLock()}>
          <Row.Icon icon="key_filled" />
          <Row.Title>{i18n('PasscodeLock.Item.Title')}</Row.Title>
          <Row.Subtitle>{passcodeSubtitle()}</Row.Subtitle>
        </Row>
        <Row clickable={() => {
          if(twoFactorFrozen()) return
          // расхождение 2: ветки `email_unconfirmed_pattern` нет (О-13)
          if(passwordState.enabled) {
            void slider.createTab(AppTwoStepVerificationEnterPasswordTab).open({ state: passwordState })
          } else {
            void slider.createTab(AppTwoStepVerificationTab).open({ state: passwordState })
          }
        }}>
          <Row.Icon icon="two_factor_auth_filled" />
          <Row.Title>{i18n('TwoStepVerification')}</Row.Title>
          <Row.Subtitle>{twoFactorSubtitle()}</Row.Subtitle>
        </Row>
        <Row
          classList={{ hide: passkeysHidden() }}
          clickable={() => {
            if(passkeysFrozen()) return
            if(passkeys.length) {
              openPasskeysTab()
              return
            }

            showPasskeyPopup((passkey) => {
              setPasskeys([passkey])
              openPasskeysTab()
            })
          }}
        >
          <Row.Icon icon="faceid_filled" />
          <Row.Title>{i18n('Privacy.Passkeys')}</Row.Title>
          <Row.Subtitle>{passkeysSubtitle()}</Row.Subtitle>
        </Row>
      </Section>
      <Section
        name="PrivacyTitle"
        caption="Privacy.MessagesCaption"
        contentProps={{ class: 'privacy-navigation-container' }}
      >
        <For each={rows}>{(row) => (
          <Row clickable={row.clickable}>
            <Row.Title>{row.title}</Row.Title>
            <Row.Subtitle>{privacy().loaded ? privacyRowSubtitle(privacy().rules[row.key]) : i18n(SUBTITLE)}</Row.Subtitle>
          </Row>
        )}</For>
      </Section>
      <Section name="FilterChats">
        <Button
          ref={(el) => deleteButton = el}
          class="btn-primary btn-transparent"
          icon="delete"
          text="PrivacyDeleteCloudDrafts"
          onClick={onDeleteClick}
        />
      </Section>
    </>
  )
}

export default PrivacyAndSecurity
