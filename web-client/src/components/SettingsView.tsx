import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import SettingsSubScreen, { hasSubScreen } from './SettingsSubScreen'
import EditProfile from './settings/EditProfile'
import PremiumModal from './PremiumModal'
import PremiumManage from './PremiumManage'
import PremiumBadge from './PremiumBadge'
import EmojiStatusPicker from './EmojiStatusPicker'
import QrModal from './QrModal'
import TgIcon from './TgIcon'
import TgSwitch from './TgSwitch'
import Avatar from '../shared/ui/Avatar'
import { Section, Row } from './settings/kit'
import classNames from '../shared/lib/classNames'
import { useT, useLang, LANGS } from '../i18n'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import rootScope from '@lib/rootScope'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { getPeerPhotoId, getPeerPhotoStrippedThumb } from '../core/peers/peer'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { useSettings } from '../settings'
import { useManagers } from '../core/hooks/useManagers'
import { createSettingsSliderHost, openActiveSessionsTab } from './sidebarLeft/settingsSliderHost'
import { toastNew } from './toast'
import { resolvePreset, PRESET_MODE } from '../theme'
import s from './SettingsView.module.scss'

// Pretty-print a Russian +7XXXXXXXXXX number as "+7 925 481 7290"; any other
// shape is shown as-is.
function formatPhone(phone?: string): string {
  if (!phone) return ''
  const m = phone.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/)
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone
}

const settingsItems: { icon: ReactNode; label: string; value?: string }[] = [
  { icon: <TgIcon name="unmute" size={24} />, label: 'Notifications and Sounds' },
  { icon: <TgIcon name="data" size={24} />, label: 'Data and Storage' },
  { icon: <TgIcon name="lock" size={24} />, label: 'Privacy and Security' },
  { icon: <TgIcon name="settings" size={24} />, label: 'General Settings' },
  { icon: <TgIcon name="folder" size={24} />, label: 'Chat Folders' },
  { icon: <TgIcon name="smile" size={24} />, label: 'Stickers and Emoji' },
  { icon: <TgIcon name="videocamera" size={24} />, label: 'Speakers and Camera' },
  { icon: <TgIcon name="devices" size={24} />, label: 'Devices' },
  { icon: <TgIcon name="language" size={24} />, label: 'Language', value: 'English' },
  { icon: <TgIcon name="keyboard" size={24} />, label: 'Keyboard Shortcuts' },
]

export default function SettingsView({
  onBack,
  onToggleMode,
  chats,
  initialSub,
}: {
  onBack: () => void
  onToggleMode: (coords?: { x: number; y: number }) => void
  /** список чатов — нужен экранам папок (счётчики, выбор чатов) */
  chats?: import('../data').Chat[]
  /** сразу открыть под-экран (deep-open из контекстного меню папок) */
  initialSub?: string
}) {
  const t = useT()
  const managers = useManagers()
  const [lang] = useLang()
  const currentLangName = LANGS.find((l) => l.code === lang)?.name ?? 'English'
  const themeChoice = useSettings((s) => s.themeChoice)
  const isDark = PRESET_MODE[resolvePreset(themeChoice)] === 'dark'
  const [active, setActive] = useState(initialSub ?? 'Notifications and Sounds')
  const [sub, setSub] = useState<string | null>(initialSub ?? null)
  const [editProfile, setEditProfile] = useState(false)
  const [premiumOpen, setPremiumOpen] = useState(false)
  const [premiumManageOpen, setPremiumManageOpen] = useState(false)
  const [emojiStatusOpen, setEmojiStatusOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const me = useChatsStore((s) => s.me)
  // Своя карточка — пара конструкторов: краткая `user` (имя, телефон, premium,
  // фото) и полная `fullUser` (bio, день рождения). Имя собирает клиент.
  const user = me?.user
  const name = user ? getUserTitle(user) : ''
  const avatarText = (name || '?').trim().charAt(0).toUpperCase()
  const avatarBg = user ? gradientFor(user.id) : 'linear-gradient(135deg,#ff8a5b,#ff6a3d)'
  const avatarSrc = useMediaUrl(getPeerPhotoId(user?.photo) || null)
  const avatarPreview = getPeerPhotoStrippedThumb(user?.photo) || undefined

  // ШОВ С ПОРТОМ (#112). Этот экран — наш временный корень настроек; в tweb
  // его роль играет вкладка того же слайдера (`AppSettingsTab`), поэтому там
  // открывать вкладки просто некому, кроме неё самой. Пока корень React'овый,
  // слайдером владеет он: заводит на монтировании и УНОСИТ С СОБОЙ на
  // размонтировании — иначе вкладка пережила бы свой экран (тот же класс
  // дефекта, что попап, переживший чат, в ревью волны 1). Пин —
  // `settingsSliderHost.test.ts`.
  //
  // Из того же шва — ещё одно живое расхождение (#112): САМ этот экран слоя
  // навигации не заводит. Он открывается обычным React-состоянием
  // (`Sidebar.tsx::screen`), тогда как в оригинале вкладка настроек — запись
  // `appNavigationController` наравне с любой другой. Следствие: Esc и Back
  // закрывают ОТКРЫТУЮ ПОВЕРХ вкладку (её слой заводит слайдер), но сам экран
  // настроек не закрывают — только стрелка в шапке. Расхождение уходит вместе
  // со швом: корень настроек станет вкладкой №0 того же слайдера.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Эффект бежит после монтирования: и узел, и его родитель (#column-left,
    // `Sidebar.tsx:213`) существуют — ветки «а вдруг нет» здесь не бывает.
    const host = createSettingsSliderHost(rootRef.current!.parentElement!, managers)
    return () => host.destroy()
  }, [managers])

  return (
    <div className={s.screen} ref={rootRef}>
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)" className={s.headerTitle}>
          {t('Settings')}
        </Text>
        <IconButton onClick={() => setQrOpen(true)} color="var(--secondary-text-color)">
          <TgIcon name="qr" />
        </IconButton>
        <IconButton onClick={() => setEditProfile(true)} color="var(--secondary-text-color)">
          <TgIcon name="edit" />
        </IconButton>
        <IconButton color="var(--secondary-text-color)">
          <TgIcon name="more" />
        </IconButton>
      </div>

      {/* Scrollable body */}
      <div className={s.body}>
        {/* Avatar + name */}
        <div className={s.profile}>
          <Avatar background={avatarBg} src={avatarSrc} preview={avatarPreview} text={avatarText} size={130} />
          <div className={s.profileName} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Text size={21} weight={600} color="var(--primary-text-color)">
              {name}
            </Text>
            {user?.pFlags?.premium && <PremiumBadge size={20} />}
          </div>
          <Text size={14} color="var(--secondary-text-color)">{t('online')}</Text>
        </div>

        {/* Contact card */}
        <Section>
          {/* Клик копирует номер и показывает тост — 1:1 tweb peerProfile.tsx:655-668
              (`copyPhoneNumber` + `toast(I18n.format('PhoneCopied'))`). Экрана смены
              номера в tweb нет вовсе: `account.changePhone` описан в схеме MTProto,
              но UI его не вызывает нигде, и вкладки под него в настройках нет —
              поэтому шеврона тут тоже нет, строка никуда не ведёт. */}
          <Row
            icon={<TgIcon name="phone" size={24} />}
            label={formatPhone(user?.phone) || '—'}
            sublabel={t('Phone')}
            translate={false}
            onClick={user?.phone ? () => {
              void navigator.clipboard?.writeText(formatPhone(user.phone).replace(/\s/g, '')).catch(() => {})
              rootScope.dispatchEvent('ui:toast', t('Phone copied to clipboard'))
            } : undefined}
          />
          {user?.username && (
            <Row
              icon={<TgIcon name="mention" size={24} />}
              label={user.username}
              sublabel={t('Username')}
              translate={false}
              onClick={() => setEditProfile(true)}
            />
          )}
        </Section>

        {/* Settings list — своя строка ради подсветки активного пункта.
            Ночной режим — первой строкой этой же секции (Appearance-toggle). */}
        <Section>
          <div className={s.rowClickable} onClick={(e) => onToggleMode({ x: e.clientX, y: e.clientY })}>
            <div className={s.rowIcon}>
              <TgIcon name="darkmode" size={24} color="var(--secondary-text-color)" />
            </div>
            <Text size={16} color="var(--primary-text-color)" className={s.rowBody}>{t('Night Mode')}</Text>
            <TgSwitch checked={isDark} />
          </div>
          {settingsItems.map((it) => (
            <div
              key={it.label}
              className={classNames(s.rowClickable, it.label === active ? s.rowActive : '')}
              onClick={() => {
                setActive(it.label)
                // «Устройства» — уже ПОРТИРОВАННАЯ вкладка слайдера, а не
                // React-подэкран: tweb `sidebarLeft/tabs/settings.tsx:179-187`
                // (`onDevicesClick` → `createTab(AppActiveSessionsTab)` →
                // `open({authorizations})`). Отказ показываем всплывашкой —
                // 1:1 `newAuthorization.tsx:126`.
                if (it.label === 'Devices') {
                  openActiveSessionsTab(managers).catch(() => toastNew({ langPackKey: 'Error.AnError' }))
                  return
                }
                if (hasSubScreen(it.label)) setSub(it.label)
              }}
            >
              <div className={s.rowIcon}>{it.icon}</div>
              <Text size={16} color="var(--primary-text-color)" className={s.rowBody}>{t(it.label)}</Text>
              {it.value && (
                <Text size={15} color="var(--secondary-text-color)">
                  {it.label === 'Language' ? currentLangName : t(it.value)}
                </Text>
              )}
            </div>
          ))}
        </Section>

        {/* Premium / Gift */}
        <Section>
          <Row
            icon={<TgIcon name="star_filled" size={24} color="var(--primary-color)" />}
            label="Telegram Premium"
            sublabel={user?.pFlags?.premium ? t('Active — manage subscription') : t('Unlock exclusive features')}
            onClick={() => (user?.pFlags?.premium ? setPremiumManageOpen(true) : setPremiumOpen(true))}
          />
          <Row
            icon={
              user?.emoji_status_emoticon
                ? <span style={{ fontSize: 22, lineHeight: 1 }}>{user.emoji_status_emoticon}</span>
                : <TgIcon name="smile" size={24} color="var(--secondary-text-color)" />
            }
            label="Set Emoji Status"
            onClick={() => setEmojiStatusOpen(true)}
          />
          <Row
            icon={<TgIcon name="gift" size={24} color="var(--secondary-text-color)" />}
            label="Send a Gift"
            onClick={() => {}}
          />
        </Section>
      </div>

      {/* Оверлеи-подэкраны: въезд справа играет CSS самого экрана (кейфрейм на
          вставке узла), обёртки-презенсы не нужны. */}
      {sub && <SettingsSubScreen title={sub} onBack={() => setSub(null)} chats={chats} />}

      {editProfile && <EditProfile onBack={() => setEditProfile(false)} />}

      {/* Telegram Premium modal (features → checkout) */}
      <PremiumModal open={premiumOpen} onClose={() => setPremiumOpen(false)} />

      {/* Manage active subscription (plan, expiry, cancel auto-renew) */}
      {premiumManageOpen && <PremiumManage onBack={() => setPremiumManageOpen(false)} />}

      {/* Emoji-status picker (own status) */}
      <EmojiStatusPicker open={emojiStatusOpen} onClose={() => setEmojiStatusOpen(false)} />

      {/* «QR-код» профиля (tweb myQrCode) — кодирует нашу публичную страницу
          /@username (аналог t.me/username) */}
      <QrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        url={user?.username ? `${location.origin}/@${user.username}` : location.origin}
        label={user?.username ? `@${user.username}` : name}
        avatar={{ src: avatarSrc, background: avatarBg, text: avatarText }}
      />
    </div>
  )
}
