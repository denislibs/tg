// PrivacySecuritySettings — раздел «Конфиденциальность» (tweb
// privacyAndSecurity): секция безопасности (чёрный список, автоудаление,
// код-пароль, облачный пароль, ключи доступа, сеансы) + секция privacy-правил
// с живыми значениями и счётчиками исключений.
import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import BlockedUsers from './BlockedUsers'
import ActiveSessions from './ActiveSessions'
import TwoStepVerification from './TwoStepVerification'
import Passkeys from './Passkeys'
import PasskeyIntroPopup from './PasskeyIntroPopup'
import PrivacyRule, { RULE_META } from './PrivacyRule'
import AutoDeleteMessages, { autoDeleteLabel } from './AutoDeleteMessages'
import PasscodeLock from './PasscodeLock'
import ConfirmDialog from './ConfirmDialog'
import { useDraftsStore } from '../../stores/draftsStore'
import { useSettingsStore } from '../../settings'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { usePrivacyStore } from '../../stores/privacyStore'
import type { PrivacyRule as Rule } from '../../core/managers/privacyManager'

const VALUE_LABEL: Record<string, string> = {
  everybody: 'Everybody',
  contacts: 'My Contacts',
  nobody: 'Nobody',
}

// Подпись значения правила: «Мои контакты (+2, -1)» (tweb updatePrivacyRow).
function ruleSubtitle(rule: Rule, t: (s: string) => string): string {
  let label = t(VALUE_LABEL[rule.value] ?? rule.value)
  const parts: string[] = []
  if (rule.denyUserIds.length && rule.value !== 'nobody') parts.push(`-${rule.denyUserIds.length}`)
  if (rule.allowUserIds.length && rule.value !== 'everybody') parts.push(`+${rule.allowUserIds.length}`)
  if (parts.length) label += ` (${parts.join(', ')})`
  return label
}

// Порядок секции Privacy (tweb privacyAndSecurity.tsx, без premium/gifts).
const RULE_ROWS = [
  'Phone Number',
  'Last Seen & Online',
  'Profile Photo',
  'Bio',
  'Calls',
  'Forwarded Messages',
  'Groups & Channels',
  'Voice Messages',
  'Messages',
  'Birthday',
]

export default function PrivacySecuritySettings({ onBack }: { onBack: () => void }) {
  const t = useT()
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
    if (sub in RULE_META) return <PrivacyRule title={sub} onBack={back} />
    switch (sub) {
      case 'Blocked Users':
        return <BlockedUsers onBack={back} />
      case 'Active Sessions':
        return <ActiveSessions onBack={back} />
      case 'Two-Step Verification':
        return <TwoStepVerification onBack={back} />
      case 'Passkeys':
        return <Passkeys onBack={back} />
      case 'Auto-Delete Messages':
        return <AutoDeleteMessages onBack={back} />
      case 'Passcode Lock':
        return <PasscodeLock onBack={back} />
    }
    return null
  }

  const blockedValue = blockedTotal > 0 ? `${blockedTotal}` : t('None')
  const passcodeEnabled = useSettingsStore((st) => st.passcodeEnabled)

  return (
    <SettingsScreen title="Privacy and Security" onBack={onBack} zIndex={50}>
      <Section footer="Manage your sessions on all your devices.">
        <Row
          icon={<TgIcon name="deleteuser" size={24} />}
          label="Blocked Users"
          value={blockedValue}
          chevron
          onClick={() => setSub('Blocked Users')}
        />
        <Row
          icon={<TgIcon name="auto_delete_circle_clock" size={24} />}
          label="Auto-Delete Messages"
          value={autoDelete == null ? undefined : autoDeleteLabel(autoDelete, t)}
          chevron
          onClick={() => setSub('Auto-Delete Messages')}
        />
        <Row
          icon={<TgIcon name="key" size={24} />}
          label="Passcode Lock"
          value={t(passcodeEnabled ? 'On' : 'Off')}
          chevron
          onClick={() => setSub('Passcode Lock')}
        />
        <Row
          icon={<TgIcon name="lock" size={24} />}
          label="Two-Step Verification"
          value={pwEnabled == null ? undefined : t(pwEnabled ? 'On' : 'Off')}
          chevron
          onClick={() => setSub('Two-Step Verification')}
        />
        {/* Как в tweb: без ключей клик открывает интро-попап, с ключами — список */}
        <Row
          icon={<TgIcon name="faceid" size={24} />}
          label="Passkeys"
          chevron
          onClick={() => (passkeysCount > 0 ? setSub('Passkeys') : setPasskeyIntro(true))}
        />
        <Row
          icon={<TgIcon name="activesessions" size={24} />}
          label="Active Sessions"
          chevron
          onClick={() => setSub('Active Sessions')}
        />
      </Section>

      <Section caption="Privacy" footer="Change who can send you messages.">
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
      <Section caption="Chats">
        <Row
          icon={<TgIcon name="delete" size={24} />}
          label="Delete All Cloud Drafts"
          accent
          onClick={() => setClearDrafts(true)}
        />
      </Section>
      {clearDrafts && (
        <ConfirmDialog
          title={t('Delete cloud drafts')}
          text={t('Are you sure you want to delete all cloud drafts?')}
          action={t('Delete')}
          danger
          onConfirm={() => {
            void managers.drafts.clearAll().then(() => useDraftsStore.getState().clearAll()).catch(() => {})
          }}
          onClose={() => setClearDrafts(false)}
        />
      )}

      {/* Удаление аккаунта (tweb: красная зона внизу privacyAndSecurity) */}
      <Section footer="This will delete your account and all your data. Your messages will remain but appear as sent by a «Deleted Account».">
        <Row
          icon={<TgIcon name="delete" size={24} />}
          label="Delete My Account"
          danger
          onClick={() => setDeleteAccount(true)}
        />
      </Section>
      {deleteAccount && (
        <ConfirmDialog
          title={t('Delete Account')}
          text={t('Are you sure you want to delete your account? This action cannot be undone.')}
          action={t('Delete')}
          danger
          onConfirm={() => {
            // сервер отзывает все сессии; после перезагрузки me()→null → экран входа
            // (или переключение на оставшийся аккаунт, как при logout).
            void managers.auth.deleteAccount().finally(() => location.reload())
          }}
          onClose={() => setDeleteAccount(false)}
        />
      )}

      <AnimatePresence>{renderSub()}</AnimatePresence>
      <PasskeyIntroPopup
        open={passkeyIntro}
        onClose={() => setPasskeyIntro(false)}
        onCreated={() => {
          setPasskeyIntro(false)
          setPasskeysCount(1)
          setSub('Passkeys')
        }}
      />
    </SettingsScreen>
  )
}
