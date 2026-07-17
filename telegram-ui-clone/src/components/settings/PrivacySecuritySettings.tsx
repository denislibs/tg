// PrivacySecuritySettings — раздел «Конфиденциальность» (tweb
// privacyAndSecurity): секция безопасности (чёрный список, автоудаление,
// код-пароль, облачный пароль, ключи доступа, сеансы) + секция privacy-правил
// с живыми значениями и счётчиками исключений.
import { useState, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import BlockedUsers from './BlockedUsers'
import ActiveSessions from './ActiveSessions'
import TwoStepVerification from './TwoStepVerification'
import Passkeys from './Passkeys'
import PrivacyRule, { RULE_META } from './PrivacyRule'
import { useT } from '../../i18n'
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
  const rules = usePrivacyStore((s) => s.rules)
  const blockedTotal = usePrivacyStore((s) => s.blockedTotal)
  const [sub, setSub] = useState<string | null>(null)

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
    }
    return null
  }

  const blockedValue = blockedTotal > 0 ? `${blockedTotal}` : t('None')

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
          icon={<TgIcon name="lock" size={24} />}
          label="Two-Step Verification"
          value={t('Off')}
          chevron
          onClick={() => setSub('Two-Step Verification')}
        />
        <Row
          icon={<TgIcon name="faceid" size={24} />}
          label="Passkeys"
          chevron
          onClick={() => setSub('Passkeys')}
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

      <AnimatePresence>{renderSub()}</AnimatePresence>
    </SettingsScreen>
  )
}
