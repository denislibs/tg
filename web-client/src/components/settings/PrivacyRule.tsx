// PrivacyRule — экран одного privacy-правила (tweb PrivacySection): радио
// Everybody / My Contacts / Nobody + секция «Exceptions» (Always/Never allow с
// пикером пользователей). Для «Phone Number» — вторая секция «Кто может найти
// меня по номеру» (added_by_phone, без Nobody), видимая только при Nobody
// (точное поведение tweb privacy/phoneNumber).
import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import PrivacyUserPicker from './PrivacyUserPicker'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { usePrivacyStore, loadPrivacy } from '../../stores/privacyStore'
import type { PrivacyKey, PrivacyRule as Rule, PrivacyValue } from '../../core/managers/privacyManager'

// Экранные метаданные ключей (tweb privacy/* tabs): заголовок секции-вопроса,
// подпись и формулировки исключений (Share для видимости, Allow для действий).
export const RULE_META: Record<string, { key: PrivacyKey; title: string; caption: string; share: boolean }> = {
  'Phone Number': {
    key: 'phone_number',
    title: 'Who can see my phone number?',
    caption: 'Users who have your number saved in their contacts will also see it on Telegram.',
    share: true,
  },
  'Last Seen & Online': {
    key: 'last_seen',
    title: 'Who can see my Last Seen time?',
    caption: "You won't see Last Seen and Online statuses for people with whom you don't share yours. Approximate times will be shown instead (recently, within a week, within a month).",
    share: true,
  },
  'Profile Photo': {
    key: 'profile_photo',
    title: 'Who can see my profile photos?',
    caption: 'You can restrict who can see your profile photos and videos with granular precision.',
    share: true,
  },
  Bio: {
    key: 'about',
    title: 'Who can see my bio?',
    caption: 'You can restrict who can see the bio on your profile with granular precision.',
    share: false,
  },
  Calls: {
    key: 'calls',
    title: 'Who can call me?',
    caption: 'You can restrict who can call you with granular precision.',
    share: false,
  },
  'Forwarded Messages': {
    key: 'forwards',
    title: 'Who can add a link to my account when forwarding my messages?',
    caption: 'When forwarded to other chats, messages you send will not link back to your account.',
    share: false,
  },
  'Groups & Channels': {
    key: 'chat_invite',
    title: 'Who can add me to group chats?',
    caption: 'You can restrict who can add you to groups and channels with granular precision.',
    share: false,
  },
  'Voice Messages': {
    key: 'voice_messages',
    title: 'Who can send me voice messages?',
    caption: 'You can restrict who can send you voice messages with granular precision.',
    share: false,
  },
  Messages: {
    key: 'messages',
    title: 'Who can send me messages?',
    caption: 'You can restrict who can send you messages with granular precision.',
    share: false,
  },
  Birthday: {
    key: 'birthday',
    title: 'Who can see my birthday?',
    caption: 'Choose who can see your birthday on your profile.',
    share: false,
  },
  'Read Time': {
    key: 'read_time',
    title: 'Who can see when I read their messages?',
    caption: "You won't see when people read your messages if you don't share when you read theirs. This setting does not affect group chats.",
    share: true,
  },
}

const OPTIONS: { label: string; value: PrivacyValue }[] = [
  { label: 'Everybody', value: 'everybody' },
  { label: 'My Contacts', value: 'contacts' },
  { label: 'Nobody', value: 'nobody' },
]

function usersCountLabel(n: number, t: (s: string) => string): string {
  if (n === 0) return t('Add Users')
  return `${n} ${t(n === 1 ? 'user' : 'users')}`
}

export default function PrivacyRule({ title, onBack }: { title: string; onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const meta = RULE_META[title]
  const rule = usePrivacyStore((s) => s.rules[meta.key])
  const addedByPhone = usePrivacyStore((s) => s.rules.added_by_phone)
  const setRuleLocal = usePrivacyStore((s) => s.setRule)
  const [picker, setPicker] = useState<'allow' | 'deny' | null>(null)

  // Оптимистично: стор сразу, бэк следом; при ошибке — перечитать с сервера.
  const save = (next: Rule) => {
    setRuleLocal(next)
    managers.privacy.setRule(next).catch(() => void loadPrivacy(managers))
  }

  const setValue = (v: PrivacyValue) => save({ ...rule, value: v })

  // tweb: при Everybody прячется «Always allow», при Nobody — «Never allow».
  const showAllow = rule.value !== 'everybody'
  const showDeny = rule.value !== 'nobody'
  const allowTitle = meta.share ? 'Always Share With' : 'Always Allow'
  const denyTitle = meta.share ? 'Never Share With' : 'Never Allow'

  return (
    <SettingsScreen title={title} onBack={onBack}>
      <Section caption={meta.title} footer={meta.caption}>
        {OPTIONS.map((o) => (
          <Row key={o.value} label={o.label} selected={rule.value === o.value} onClick={() => setValue(o.value)} />
        ))}
      </Section>

      {(showAllow || showDeny) && (
        <Section
          caption="Exceptions"
          footer="You can add users or entire groups as exceptions that will override the settings above."
        >
          {showDeny && (
            <Row
              icon={<TgIcon name="deleteuser" size={24} />}
              label={denyTitle}
              value={usersCountLabel(rule.denyUserIds.length, t)}
              chevron
              onClick={() => setPicker('deny')}
            />
          )}
          {showAllow && (
            <Row
              icon={<TgIcon name="adduser" size={24} />}
              label={allowTitle}
              value={usersCountLabel(rule.allowUserIds.length, t)}
              chevron
              onClick={() => setPicker('allow')}
            />
          )}
        </Section>
      )}

      {/* Вторая секция экрана «Номер телефона» (tweb privacy/phoneNumber):
          «Кто может найти меня по номеру?», без Nobody, видна при Nobody выше. */}
      {meta.key === 'phone_number' && rule.value === 'nobody' && (
        <Section
          caption="Who can find me by my number?"
          footer="Users who have your number saved in their contacts will see it on Telegram only if you added them to your contacts."
        >
          {OPTIONS.filter((o) => o.value !== 'nobody').map((o) => (
            <Row
              key={o.value}
              label={o.label}
              selected={addedByPhone.value === o.value}
              onClick={() => save({ ...addedByPhone, value: o.value })}
            />
          ))}
        </Section>
      )}

      <AnimatePresence>
        {picker && (
          <PrivacyUserPicker
            title={picker === 'allow' ? allowTitle : denyTitle}
            placeholder="Add Users or Groups..."
            initial={picker === 'allow' ? rule.allowUserIds : rule.denyUserIds}
            onDone={(ids) => {
              // Пользователь не может быть в обоих списках: выбранный в одном
              // убирается из другого (tweb PrivacySection).
              const other = picker === 'allow' ? rule.denyUserIds : rule.allowUserIds
              const cleaned = other.filter((id) => !ids.includes(id))
              save(
                picker === 'allow'
                  ? { ...rule, allowUserIds: ids, denyUserIds: cleaned }
                  : { ...rule, denyUserIds: ids, allowUserIds: cleaned },
              )
              setPicker(null)
            }}
            onBack={() => setPicker(null)}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}
