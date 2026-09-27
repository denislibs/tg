// PrivacySecuritySettings — раздел «Конфиденциальность» (tweb
// privacyAndSecurity): секция безопасности (чёрный список, автоудаление,
// код-пароль, облачный пароль, ключи доступа, сеансы) + секция privacy-правил
// с живыми значениями и счётчиками исключений.
import type { LangPackKey } from '@/lang'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import BlockedUsers from './BlockedUsers'
import Passkeys from './Passkeys'
import PasskeyIntroPopup from './PasskeyIntroPopup'
import AutoDeleteMessages, { autoDeleteLabel } from './AutoDeleteMessages'
import ConfirmDialog from './ConfirmDialog'
import { useSettingsStore } from '../../settings'
import { useT, useTArgs } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { commandThenReload } from '../../core/accountTransition'
import { getSettingsSliderHost, openActiveSessionsTab } from '../sidebarLeft/settingsSliderHost'
import {
  AppPasscodeEnterPasswordTab,
  AppPasscodeLockTab,
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
// задача 17 плана 2D) через хост, как tweb `tab.slider.createTab(…).open()`;
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

export default function PrivacySecuritySettings({ onBack }: { onBack: () => void }) {
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
  const [passkeysCount, setPasskeysCount] = useState(0)
  const [passkeyIntro, setPasskeyIntro] = useState(false)
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
    void managers.auth.passkeysList().then((l) => {
      if (alive) setPasskeysCount(l.length)
    }).catch(() => {})
    return () => { alive = false }
  }, [sub, managers])

  const renderSub = (): ReactNode => {
    if (!sub) return null
    const back = () => setSub(null)
    switch (sub) {
      case 'BlockedUsers':
        return <BlockedUsers onBack={back} />
      case 'Privacy.Passkeys':
        return <Passkeys onBack={back} />
      case 'AutoDeleteMessages':
        return <AutoDeleteMessages onBack={back} />
    }
    return null
  }

  // Мастер 2FA — вкладки слайдера (`sidebarLeft/tabs/2fa/*`), экран под ними
  // остаётся жить. У tweb конец мастера срезает «Конфиденциальность» из истории
  // (`sliceTabsUntilTab(AppSettingsTab)`), и при следующем открытии она читает
  // состояние заново; здесь то же перечитывание — когда стек вкладок хоста
  // опустел (шов, снимается задачей 23/28).
  const offTabsEmptyRef = useRef<(() => void) | null>(null)
  useEffect(() => () => offTabsEmptyRef.current?.(), [])
  const openTwoStepVerification = () => {
    // tweb :257-271. Пока состояние не пришло, строка «заморожена» (`twoFactorFrozen`).
    if (!pwState) return
    const host = getSettingsSliderHost()
    offTabsEmptyRef.current ??= host.onTabsEmpty(() => {
      void managers.auth.passwordState().then(setPwState).catch(() => {})
    })
    // Ветки `email_unconfirmed_pattern` → `AppTwoStepVerificationEmailConfirmationTab`
    // (:261-268) нет — О-13: наш сервер ставит почту без подтверждения кодом.
    const open = pwState.enabled
      ? host.openTab(AppTwoStepVerificationEnterPasswordTab, { state: pwState })
      : host.openTab(AppTwoStepVerificationTab, { state: pwState })
    open.catch(() => toastNew({ langPackKey: 'Error.AnError' }))
  }

  const blockedValue = blockedTotal > 0 ? `${blockedTotal}` : t('BlockedEmpty')
  const passcodeEnabled = useSettingsStore((st) => st.passcodeEnabled)

  // tweb `privacyAndSecurity.tsx:193-210` (`openPasscodeLock`): при включённом
  // коде сначала вкладка ввода текущего, при верном — главная вкладка. Вкладки
  // слайдера открывает хост (шов до задачи 23, когда этот экран сам станет
  // вкладкой и откроет их своим `tab.slider`); вторую открываем слайдером
  // вкладки ввода — это тот же слайдер хоста.
  const openPasscodeLock = () => {
    const host = getSettingsSliderHost()
    if (passcodeEnabled) {
      void host.openTab(AppPasscodeEnterPasswordTab, {
        buttonText: 'PasscodeLock.Next',
        inputLabel: 'PasscodeLock.EnterYourPasscode',
        onSubmit: async (passcode, tab, { isMyPasscode }) => {
          const isCorrect = await isMyPasscode(passcode)
          if (!isCorrect) throw new Error('WRONG_PASSCODE')

          void (tab.slider as unknown as SidebarSlider).createTab(AppPasscodeLockTab).open()
        },
      })
    } else {
      void host.openTab(AppPasscodeLockTab)
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
        {/* Как в tweb: без ключей клик открывает интро-попап, с ключами — список */}
        <Row
          icon={<TgIcon name="faceid_filled" size={24} />}
          label="Privacy.Passkeys"
          onClick={() => (passkeysCount > 0 ? setSub('Privacy.Passkeys') : setPasskeyIntro(true))}
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
            onClick={() => {
              getSettingsSliderHost().openTab(r.tab).catch(() => toastNew({ langPackKey: 'Error.AnError' }))
            }}
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

      <PasskeyIntroPopup
        open={passkeyIntro}
        onClose={() => setPasskeyIntro(false)}
        onCreated={() => {
          setPasskeyIntro(false)
          setPasskeysCount(1)
          setSub('Privacy.Passkeys')
        }}
      />
    </SettingsScreen>
  )
}
