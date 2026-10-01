// PrivacySecuritySettings — раздел «Конфиденциальность» (tweb
// privacyAndSecurity): секция безопасности (чёрный список, автоудаление,
// код-пароль, облачный пароль, ключи доступа, сеансы) + секция privacy-правил
// с живыми значениями и счётчиками исключений.
import type { LangPackKey } from '@/lang'
import { useEffect, useState, type ReactNode } from 'react'
import { createStore } from 'solid-js/store'
import type { Passkey } from '@layer'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import BlockedUsers from './BlockedUsers'
import AutoDeleteMessages, { autoDeleteLabel } from './AutoDeleteMessages'
import ConfirmDialog from './ConfirmDialog'
import { useSettingsStore } from '../../settings'
import { useT, useTArgs } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { commandThenReload } from '../../core/accountTransition'
import { openActiveSessionsTab } from '../sidebarLeft/columnSlider'
import type { ReactScreenTabProps } from '../sidebarLeft/reactScreenTab'
import {
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
  AppPrivacyReadTimeTab,
  AppPrivacyVoicesTab,
  AppTwoStepVerificationEnterPasswordTab,
  AppTwoStepVerificationTab,
} from '../solidJsTabs/tabs'
import type SidebarSlider from '../slider'
import type { PasswordState } from '../../core/managers/authManager'
import { toastNew } from '../toast'
import { showPasskeyPopup } from '../sidebarLeft/settingsPopups'
import { usePrivacyStore } from '../../stores/privacyStore'
import type { PrivacyKey, PrivacyRule as Rule } from '../../core/managers/privacyManager'

const VALUE_LABEL: Record<string, LangPackKey> = {
  everybody: 'PrivacySettingsController.Everbody',
  contacts: 'PrivacySettingsController.MyContacts',
  nobody: 'PrivacySettingsController.Nobody',
}

// Подпись значения правила: «Мои контакты (+2, -1)» (tweb updatePrivacyRow).
function ruleSubtitle(rule: Rule, t: (key: LangPackKey) => string): string {
  let label = t(VALUE_LABEL[rule.value] ?? (rule.value as LangPackKey))
  const parts: string[] = []
  if (rule.denyUserIds.length && rule.value !== 'nobody') parts.push(`-${rule.denyUserIds.length}`)
  if (rule.allowUserIds.length && rule.value !== 'everybody') parts.push(`+${rule.allowUserIds.length}`)
  if (parts.length) label += ` (${parts.join(', ')})`
  return label
}

// Порядок секции Privacy (tweb privacyAndSecurity.tsx:416-466, без gifts/saved
// music — О-16). Строка открывает вкладку правила (`sidebarLeft/tabs/privacy/*`,
// задача 17 плана 2D) слайдером своей вкладки, как tweb `tab.slider.createTab(…).open()`;
// заголовки строк и значения — предмет задачи 23 (хаб станет вкладкой).
const RULE_ROWS: { key: PrivacyKey; title: LangPackKey; tab: typeof AppPrivacyAboutTab }[] = [
  { key: 'phone_number', title: 'PrivacyPhoneTitle', tab: AppPrivacyPhoneNumberTab },
  { key: 'last_seen', title: 'LastSeenTitle', tab: AppPrivacyLastSeenTab },
  { key: 'profile_photo', title: 'PrivacyProfilePhotoTitle', tab: AppPrivacyProfilePhotoTab },
  { key: 'about', title: 'Privacy.BioRow', tab: AppPrivacyAboutTab },
  { key: 'calls', title: 'WhoCanCallMe', tab: AppPrivacyCallsTab },
  { key: 'forwards', title: 'PrivacyForwardsTitle', tab: AppPrivacyForwardMessagesTab },
  { key: 'chat_invite', title: 'PrivacyGroupsTitle', tab: AppPrivacyAddToGroupsTab },
  { key: 'voice_messages', title: 'PrivacyVoiceMessagesTitle', tab: AppPrivacyVoicesTab },
  { key: 'messages', title: 'PrivacyMessagesTitle', tab: AppPrivacyMessagesTab },
  { key: 'birthday', title: 'Privacy.BirthdayRow', tab: AppPrivacyBirthdayTab },
  { key: 'read_time', title: 'PrivacyReadTimeTitle', tab: AppPrivacyReadTimeTab },
]

// ВРЕМЕННО до 2D-23: экран — содержимое вкладки `AppPrivacyAndSecurityTab` на
// мосту `scaffoldReactScreenTab` (`sidebarLeft/reactScreenTab.tsx`); следующие
// вкладки он открывает слайдером этой вкладки, как оригинал.
export default function PrivacySecuritySettings({ tab, onBack }: ReactScreenTabProps) {
  const slider = tab.slider as SidebarSlider
  const t = useT()
  const tArgs = useTArgs()
  const managers = useManagers()
  const rules = usePrivacyStore((s) => s.rules)
  const blockedTotal = usePrivacyStore((s) => s.blockedTotal)
  const [sub, setSub] = useState<string | null>(null)

  // Сабтайтлы On/Off и период автоудаления (перечитываются при возврате
  // из под-экранов).
  // Состояние облачного пароля целиком, а не только признак: мастер 2FA
  // открывается с ним (tweb `privacyAndSecurity.tsx:131`, `:339-341`).
  const [pwState, setPwState] = useState<PasswordState | null>(null)
  const [autoDelete, setAutoDelete] = useState<number | null>(null)
  const [clearDrafts, setClearDrafts] = useState(false)
  const [deleteAccount, setDeleteAccount] = useState(false)
  useEffect(() => {
    if (sub !== null) return
    let alive = true
    void managers.auth.passwordState().then((st) => {
      if (alive) setPwState(st)
    }).catch(() => {})
    void managers.privacy.autoDelete().then((p) => {
      if (alive) setAutoDelete(p)
    }).catch(() => {})
    return () => { alive = false }
  }, [sub, managers])

  const renderSub = (): ReactNode => {
    if (!sub) return null
    const back = () => setSub(null)
    switch (sub) {
      case 'BlockedUsers':
        return <BlockedUsers onBack={back} />
      case 'AutoDeleteMessages':
        return <AutoDeleteMessages onBack={back} />
    }
    return null
  }

  // Ключи доступа — вкладка `AppPasskeysTab` (`sidebarLeft/tabs/passkeys.solid.tsx`,
  // задача 21 плана 2D). tweb :156-160, :290-302: список — Solid-стор открывающего,
  // вкладка правит его сама; без ключей — сначала интро-попап, созданный ключ —
  // первый элемент стора. ВРЕМЕННО до 2D-23: список читается на клике, а не на
  // открытии хаба (`updatePasskeys`, :172-190), — у React-экрана нет подписки на
  // стор, и счётчик после удаления во вкладке устарел бы.
  const openPasskeysTab = (list: Passkey[]) => {
    const [passkeys, setPasskeys] = createStore(list)
    void slider.createTab(AppPasskeysTab).open({ passkeys, setPasskeys })
  }
  const openPasskeys = () => {
    void managers.auth.passkeysList().then((list) => {
      if (list.length) {
        openPasskeysTab(list)
        return
      }

      showPasskeyPopup((passkey) => openPasskeysTab([passkey]))
    }).catch(() => toastNew({ langPackKey: 'Error.AnError' }))
  }

  // Мастер 2FA — вкладки слайдера (`sidebarLeft/tabs/2fa/*`). Конец мастера
  // срезает этот экран из истории (`sliceTabsUntilTab(AppSettingsTab)`, tweb
  // `2fa/index.tsx:34`, `2fa/passwordSet.tsx:23`), и следующее открытие читает
  // состояние заново — своего перечитывания экрану не нужно.
  const openTwoStepVerification = () => {
    // tweb :257-271. Пока состояние не пришло, строка «заморожена» (`twoFactorFrozen`).
    if (!pwState) return
    // Ветки `email_unconfirmed_pattern` → `AppTwoStepVerificationEmailConfirmationTab`
    // (:261-268) нет — О-13: наш сервер ставит почту без подтверждения кодом.
    if (pwState.enabled) {
      void slider.createTab(AppTwoStepVerificationEnterPasswordTab).open({ state: pwState })
    } else {
      void slider.createTab(AppTwoStepVerificationTab).open({ state: pwState })
    }
  }

  const blockedValue = blockedTotal > 0 ? `${blockedTotal}` : t('BlockedEmpty')
  const passcodeEnabled = useSettingsStore((st) => st.passcodeEnabled)

  // tweb `privacyAndSecurity.tsx:193-210` (`openPasscodeLock`): при включённом
  // коде сначала вкладка ввода текущего, при верном — главная вкладка.
  const openPasscodeLock = () => {
    if (passcodeEnabled) {
      void slider.createTab(AppPasscodeEnterPasswordTab).open({
        buttonText: 'PasscodeLock.Next',
        inputLabel: 'PasscodeLock.EnterYourPasscode',
        onSubmit: async (passcode, tab, { isMyPasscode }) => {
          const isCorrect = await isMyPasscode(passcode)
          if (!isCorrect) throw new Error('WRONG_PASSCODE')

          void (tab.slider as unknown as SidebarSlider).createTab(AppPasscodeLockTab).open()
        },
      })
    } else {
      void slider.createTab(AppPasscodeLockTab).open()
    }
  }

  return (
    <SettingsScreen title="PrivacySettings" onBack={onBack} zIndex={50} sub={renderSub()}>
      <Section footer="SessionsInfo">
        <Row
          icon={<TgIcon name="person_crossed_filled" size={24} />}
          label="BlockedUsers"
          value={blockedValue}
          onClick={() => setSub('BlockedUsers')}
        />
        <Row
          icon={<TgIcon name="auto_delete_filled" size={24} />}
          label="AutoDeleteMessages"
          value={autoDelete == null ? undefined : autoDeleteLabel(autoDelete, t, tArgs)}
          onClick={() => setSub('AutoDeleteMessages')}
        />
        <Row
          icon={<TgIcon name="key_filled" size={24} />}
          label="PasscodeLock.Item.Title"
          value={t(passcodeEnabled ? 'PrivacyAndSecurity.Item.On' : 'Off')}
          onClick={openPasscodeLock}
        />
        <Row
          icon={<TgIcon name="two_factor_auth_filled" size={24} />}
          label="TwoStepVerification"
          value={pwState == null ? undefined : t(pwState.enabled ? 'PrivacyAndSecurity.Item.On' : 'Off')}
          onClick={openTwoStepVerification}
        />
        <Row
          icon={<TgIcon name="faceid_filled" size={24} />}
          label="Privacy.Passkeys"
          onClick={openPasskeys}
        />
        {/* «Активные сессии» — та же портированная вкладка слайдера, что и
            «Устройства» в корне настроек (`sidebarLeft/tabs/activeSessions.solid.tsx`),
            и открывается тем же способом. `setSub` здесь не при чём: вкладка
            не React-подэкран, состояние этого экрана она не трогает. Второй
            вход в те же сессии есть и в оригинале — `newAuthorization.tsx:116`. */}
        <Row
          icon={<TgIcon name="devices_filled" size={24} />}
          label="SessionsTitle"
          onClick={() => {
            openActiveSessionsTab(managers).catch(() => toastNew({ langPackKey: 'Error.AnError' }))
          }}
        />
      </Section>

      <Section caption="PrivacyTitle" footer="Privacy.MessagesCaption">
        {RULE_ROWS.map((r) => (
          <Row
            key={r.key}
            label={r.title}
            sublabel={ruleSubtitle(rules[r.key], t)}
            onClick={() => void slider.createTab(r.tab).open()}
          />
        ))}
      </Section>

      {/* Облачные черновики (tweb PrivacyDeleteCloudDrafts + confirm-попап) */}
      <Section caption="FilterChats">
        <Row
          icon={<TgIcon name="delete" size={24} />}
          label="PrivacyDeleteCloudDrafts"
          accent
          onClick={() => setClearDrafts(true)}
        />
      </Section>
      {clearDrafts && (
        <ConfirmDialog
          title="AreYouSureClearDraftsTitle"
          text="AreYouSureClearDrafts"
          action="Delete"
          danger
          onConfirm={() => {
            // Черновики — поля диалогов, поэтому после очистки список
            // перечитывает их владелец: своего стора у черновиков нет.
            void managers.drafts.clearAll().then(() => managers.dialogs.refresh()).catch(() => {})
          }}
          onClose={() => setClearDrafts(false)}
        />
      )}

      {/* Удаление аккаунта (tweb: красная зона внизу privacyAndSecurity) */}
      <Section footer="DeleteAccount.Caption">
        <Row
          icon={<TgIcon name="delete" size={24} />}
          label="DeleteAccount.Action"
          danger
          onClick={() => setDeleteAccount(true)}
        />
      </Section>
      {deleteAccount && (
        <ConfirmDialog
          title="DeleteAccount.Title"
          text="DeleteAccount.Text"
          action="Delete"
          danger
          onConfirm={() => {
            // сервер отзывает все сессии; после перезагрузки me()→null → экран входа
            // (или переключение на оставшийся аккаунт, как при logout).
            void commandThenReload(managers.auth.deleteAccount())
          }}
          onClose={() => setDeleteAccount(false)}
        />
      )}
    </SettingsScreen>
  )
}
