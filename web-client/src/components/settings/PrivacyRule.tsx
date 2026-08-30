// PrivacyRule — экран одного privacy-правила (tweb PrivacySection): радио
// Everybody / My Contacts / Nobody + секция «Exceptions» (Always/Never allow с
// пикером пользователей). Для «Phone Number» — вторая секция «Кто может найти
// меня по номеру» (added_by_phone, без Nobody), видимая только при Nobody
// (точное поведение tweb privacy/phoneNumber).
import type { LangPackKey } from '@/lang'
import { useState } from 'react'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import PrivacyUserPicker from './PrivacyUserPicker'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { usePrivacyStore, loadPrivacy } from '../../stores/privacyStore'
import type { PrivacyKey, PrivacyRule as Rule, PrivacyValue } from '../../core/managers/privacyManager'

// Экранные метаданные ключей (tweb privacy/* tabs): заголовок секции-вопроса,
// подпись и формулировки исключений (Share для видимости, Allow для действий).
export const RULE_META: Record<string, { key: PrivacyKey; title: LangPackKey; caption: LangPackKey; share: boolean }> = {
  'PrivacyPhone': {
    key: 'phone_number',
    title: 'PrivacyPhoneTitle',
    caption: 'PrivacyPhoneInfo',
    share: true,
  },
  'PrivacyLastSeen': {
    key: 'last_seen',
    title: 'LastSeenTitle',
    caption: "Privacy.LastSeenCaption",
    share: true,
  },
  'PrivacyProfilePhoto': {
    key: 'profile_photo',
    title: 'PrivacyProfilePhotoTitle',
    caption: 'Privacy.ProfilePhotoCaption',
    share: true,
  },
  UserBio: {
    key: 'about',
    title: 'Privacy.BioRow',
    caption: 'Privacy.BioCaption',
    share: false,
  },
  'PrivacySettings.VoiceCalls': {
    key: 'calls',
    title: 'WhoCanCallMe',
    caption: 'PrivacySettingsController.PhoneCallDescription',
    share: false,
  },
  'PrivacySettings.Forwards': {
    key: 'forwards',
    title: 'PrivacyForwardsTitle',
    caption: 'PrivacyForwardsInfo',
    share: false,
  },
  'PrivacySettings.Groups': {
    key: 'chat_invite',
    title: 'PrivacyGroupsTitle',
    caption: 'PrivacySettingsController.GroupDescription',
    share: false,
  },
  PrivacyVoiceMessages: {
    key: 'voice_messages',
    title: 'PrivacyVoiceMessagesTitle',
    caption: 'Privacy.VoiceCustomHelp',
    share: false,
  },
  SearchMessages: {
    key: 'messages',
    title: 'PrivacyMessagesTitle',
    caption: 'Privacy.MessagesCustomHelp',
    share: false,
  },
  Birthday: {
    key: 'birthday',
    title: 'Privacy.BirthdayRow',
    caption: 'Privacy.BirthdayChoose',
    share: false,
  },
  'PrivacyReadTime': {
    key: 'read_time',
    title: 'PrivacyReadTimeTitle',
    caption: "Privacy.ReadTimeCaption",
    share: true,
  },
}

const OPTIONS: { label: LangPackKey; value: PrivacyValue }[] = [
  { label: 'PrivacySettingsController.Everbody', value: 'everybody' },
  { label: 'PrivacySettingsController.MyContacts', value: 'contacts' },
  { label: 'PrivacySettingsController.Nobody', value: 'nobody' },
]

function usersCountLabel(n: number, t: (key: LangPackKey) => string): string {
  if (n === 0) return t('PrivacySettingsController.AddUsers')
  return `${n} ${t(n === 1 ? 'Peer.Type.User' : 'Privacy.UsersSuffix')}`
}

export default function PrivacyRule({ title, onBack }: { title: LangPackKey; onBack: () => void }) {
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
  const allowTitle = meta.share ? 'PrivacySettingsController.AlwaysShare' : 'PrivacySettingsController.AlwaysAllow'
  const denyTitle = meta.share ? 'PrivacySettingsController.NeverShare' : 'PrivacySettingsController.NeverAllow'

  return (
    <SettingsScreen
      title={title}
      onBack={onBack}
      sub={picker ? (
        <PrivacyUserPicker
          title={picker === 'allow' ? allowTitle : denyTitle}
          placeholder="PrivacyModal.Search.Placeholder"
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
      ) : null}
    >
      <Section caption={meta.title} footer={meta.caption}>
        {OPTIONS.map((o) => (
          <Row key={o.value} label={o.label} selected={rule.value === o.value} onClick={() => setValue(o.value)} />
        ))}
      </Section>

      {(showAllow || showDeny) && (
        <Section
          caption="Exceptions"
          footer="PrivacySettingsController.PeerInfo"
        >
          {showDeny && (
            <Row
              icon={<TgIcon name="deleteuser" size={24} />}
              label={denyTitle}
              value={usersCountLabel(rule.denyUserIds.length, t)}
              onClick={() => setPicker('deny')}
            />
          )}
          {showAllow && (
            <Row
              icon={<TgIcon name="adduser" size={24} />}
              label={allowTitle}
              value={usersCountLabel(rule.allowUserIds.length, t)}
              onClick={() => setPicker('allow')}
            />
          )}
        </Section>
      )}

      {/* Вторая секция экрана «Номер телефона» (tweb privacy/phoneNumber):
          «Кто может найти меня по номеру?», без Nobody, видна при Nobody выше. */}
      {meta.key === 'phone_number' && rule.value === 'nobody' && (
        <Section
          caption="PrivacyPhoneTitle2"
          footer="PrivacyPhoneInfo3"
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

    </SettingsScreen>
  )
}
