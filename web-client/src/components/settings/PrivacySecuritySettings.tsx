// PrivacySecuritySettings — раздел «Конфиденциальность» (tweb
// privacyAndSecurity): секция безопасности (чёрный список, автоудаление,
// код-пароль, облачный пароль, ключи доступа, сеансы) + секция privacy-правил
// с живыми значениями и счётчиками исключений.
import type { LangPackKey } from '@/lang'
import { useEffect, useState, type ReactNode } from 'react'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import BlockedUsers from './BlockedUsers'
import TwoStepVerification from './TwoStepVerification'
import Passkeys from './Passkeys'
import PasskeyIntroPopup from './PasskeyIntroPopup'
import PrivacyRule, { RULE_META } from './PrivacyRule'
import AutoDeleteMessages, { autoDeleteLabel } from './AutoDeleteMessages'
import PasscodeLock from './PasscodeLock'
import ConfirmDialog from './ConfirmDialog'
import { useSettingsStore } from '../../settings'
import { useT, useTArgs } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { openActiveSessionsTab } from '../sidebarLeft/settingsSliderHost'
import { toastNew } from '../toast'
import { usePrivacyStore } from '../../stores/privacyStore'
import type { PrivacyRule as Rule } from '../../core/managers/privacyManager'

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

// Порядок секции Privacy (tweb privacyAndSecurity.tsx, без premium/gifts).
const RULE_ROWS: LangPackKey[] = [
  'PrivacyPhone',
  'PrivacyLastSeen',
  'PrivacyProfilePhoto',
  'UserBio',
  'PrivacySettings.VoiceCalls',
  'PrivacySettings.Forwards',
  'PrivacySettings.Groups',
  'PrivacyVoiceMessages',
  'SearchMessages',
  'Birthday',
  'PrivacyReadTime',
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
  const [pwEnabled, setPwEnabled] = useState<boolean | null>(null)
  const [autoDelete, setAutoDelete] = useState<number | null>(null)
  const [passkeysCount, setPasskeysCount] = useState(0)
  const [passkeyIntro, setPasskeyIntro] = useState(false)
  const [clearDrafts, setClearDrafts] = useState(false)
  const [deleteAccount, setDeleteAccount] = useState(false)
  useEffect(() => {
    if (sub !== null) return
    let alive = true
    void managers.auth.passwordState().then((st) => {
      if (alive) setPwEnabled(st.enabled)
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
    if (sub in RULE_META) return <PrivacyRule title={sub as LangPackKey} onBack={back} />
    switch (sub) {
      case 'BlockedUsers':
        return <BlockedUsers onBack={back} />
      case 'TwoStepVerification':
        return <TwoStepVerification onBack={back} />
      case 'Privacy.Passkeys':
        return <Passkeys onBack={back} />
      case 'AutoDeleteMessages':
        return <AutoDeleteMessages onBack={back} />
      case 'PasscodeLock.Item.Title':
        return <PasscodeLock onBack={back} />
    }
    return null
  }

  const blockedValue = blockedTotal > 0 ? `${blockedTotal}` : t('BlockedEmpty')
  const passcodeEnabled = useSettingsStore((st) => st.passcodeEnabled)

  return (
    <SettingsScreen title="PrivacySettings" onBack={onBack} zIndex={50} sub={renderSub()}>
      <Section footer="SessionsInfo">
        <Row
          icon={<TgIcon name="deleteuser" size={24} />}
          label="BlockedUsers"
          value={blockedValue}
          onClick={() => setSub('BlockedUsers')}
        />
        <Row
          icon={<TgIcon name="auto_delete_circle_clock" size={24} />}
          label="AutoDeleteMessages"
          value={autoDelete == null ? undefined : autoDeleteLabel(autoDelete, t, tArgs)}
          onClick={() => setSub('AutoDeleteMessages')}
        />
        <Row
          icon={<TgIcon name="key" size={24} />}
          label="PasscodeLock.Item.Title"
          value={t(passcodeEnabled ? 'PrivacyAndSecurity.Item.On' : 'Off')}
          onClick={() => setSub('PasscodeLock.Item.Title')}
        />
        <Row
          icon={<TgIcon name="lock" size={24} />}
          label="TwoStepVerification"
          value={pwEnabled == null ? undefined : t(pwEnabled ? 'PrivacyAndSecurity.Item.On' : 'Off')}
          onClick={() => setSub('TwoStepVerification')}
        />
        {/* Как в tweb: без ключей клик открывает интро-попап, с ключами — список */}
        <Row
          icon={<TgIcon name="faceid" size={24} />}
          label="Privacy.Passkeys"
          onClick={() => (passkeysCount > 0 ? setSub('Privacy.Passkeys') : setPasskeyIntro(true))}
        />
        {/* «Активные сессии» — та же портированная вкладка слайдера, что и
            «Устройства» в корне настроек (`sidebarLeft/tabs/activeSessions.solid.tsx`),
            и открывается тем же способом. `setSub` здесь не при чём: вкладка
            не React-подэкран, состояние этого экрана она не трогает. Второй
            вход в те же сессии есть и в оригинале — `newAuthorization.tsx:116`. */}
        <Row
          icon={<TgIcon name="activesessions" size={24} />}
          label="SessionsTitle"
          onClick={() => {
            openActiveSessionsTab(managers).catch(() => toastNew({ langPackKey: 'Error.AnError' }))
          }}
        />
      </Section>

      <Section caption="PrivacyTitle" footer="Privacy.MessagesCaption">
        {RULE_ROWS.map((label) => (
          <Row
            key={label}
            label={RULE_META[label].title}
            sublabel={ruleSubtitle(rules[RULE_META[label].key], t)}
            onClick={() => setSub(label)}
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
            void managers.auth.deleteAccount().finally(() => location.reload())
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
