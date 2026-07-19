import { useEffect, useRef, useState } from 'react'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useAvatarSrc } from './useAvatarSrc'
import { useChatsStore } from '../stores/chatsStore'
import { useManagers } from '../core/hooks/useManagers'
import { gradientFor } from '../core/dialogToChat'
import type { PublicAccount } from '../core/auth/accounts'
import { ANIMATE_AUTH_KEY, PREV_ACCOUNT_KEY, playChatlistExit, playMainScreenExit } from '../core/accountTransition'
import { useSettings } from '../settings'
import { usePwaStore } from '../core/pwa'
import { enterAppPip, pipSupported } from '../core/pip'
import { uiEvents } from '../core/hooks/uiEvents'
import type { ToggleMode } from '../App'
import { useT } from '../i18n'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenContacts?: () => void
  onOpenSaved?: () => void
  onOpenPremium?: () => void
  onLogout?: () => void
  onToggleMode?: ToggleMode
}

// Аватар аккаунта в списке (резолвит avatarUrl через media-токен воркера).
function AccountAvatar({ account }: { account: PublicAccount }) {
  const src = useAvatarSrc(account.avatarUrl)
  return <Avatar background={gradientFor(account.id)} text={account.name.charAt(0).toUpperCase()} src={src} size={26} />
}

export default function MainMenu({
  open,
  onClose,
  onOpenSettings,
  onOpenContacts,
  onOpenSaved,
  onOpenPremium,
  onLogout,
  onToggleMode,
}: Props) {
  const t = useT()
  const managers = useManagers()
  const { reduceMotion, update } = useSettings()
  const canInstall = usePwaStore((st) => st.canInstall)
  const [moreOpen, setMoreOpen] = useState(false)
  // Подменю «Ещё» якорится к своему пункту (не фикс-координаты).
  const moreItemRef = useRef<HTMLDivElement>(null)
  const [moreAnchor, setMoreAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const toggleMore = () => {
    const r = moreItemRef.current?.getBoundingClientRect()
    if (r) setMoreAnchor({ top: r.top, left: r.right + 4 })
    setMoreOpen((o) => !o)
  }
  const me = useChatsStore((s) => s.me)
  const meAvatar = useAvatarSrc(me?.avatarUrl)
  const meName = me?.displayName?.trim() || [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() || me?.username || 'Аккаунт'
  const divider = (
    <div style={{ height: '1px', background: 'var(--tg-divider)', margin: '6px 0' }} />
  )

  // Мультиаккаунт: реестр аккаунтов (кроме активного) + лимит 4.
  const [accounts, setAccounts] = useState<PublicAccount[]>([])
  useEffect(() => {
    if (!open) return
    void managers.auth.listAccounts().then(setAccounts)
  }, [open, managers])
  const others = accounts.filter((a) => a.id !== me?.id)
  // Переключение аккаунта = смена активного токена в воркере + перезагрузка.
  // Перед reload список чатов уезжает (tweb меню аккаунтов: chatlist-exit).
  const switchTo = async (id: number) => {
    onClose()
    const ok = await managers.auth.switchAccount(id)
    if (!ok) return
    await playChatlistExit(document.getElementById('chatlist-column'))
    location.reload()
  }
  // «Добавить аккаунт» (tweb sidebarLeft.addAccount): текущий остаётся в
  // реестре; чат уезжает main-screen-exit, флаги «prev account» и «анимировать
  // auth» переживают reload — экран входа въедет hostEnter, из него есть
  // стрелка возврата к прежнему аккаунту.
  const addAccount = async () => {
    onClose()
    if (me?.id != null) localStorage.setItem(PREV_ACCOUNT_KEY, String(me.id))
    localStorage.setItem(ANIMATE_AUTH_KEY, '1')
    await playMainScreenExit(document.getElementById('app-shell'))
    await managers.auth.addAccount()
    location.reload()
  }

  const close = () => { setMoreOpen(false); onClose() }
  const openUrl = (url: string) => { window.open(url, '_blank', 'noopener'); close() }

  // Пункты подменю «Ещё» (tweb createMoreSubmenu). «Версию A» опускаем —
  // у нас одна версия, переключение вело бы на сторонний сайт.
  const moreItems: { icon: string; label: string; onClick: () => void; show?: boolean }[] = [
    { icon: 'darkmode', label: 'Dark Mode', onClick: () => { onToggleMode?.(); close() } },
    {
      icon: 'animations',
      label: reduceMotion ? 'Enable Animations' : 'Disable Animations',
      onClick: () => { update({ reduceMotion: !reduceMotion }); close() },
    },
    { icon: 'help', label: 'Telegram Features', onClick: () => openUrl('https://telegram.org/tour') },
    { icon: 'bug', label: 'Report Bug', onClick: () => openUrl('https://bugs.telegram.org/?tag_ids=40&sort=time') },
    { icon: 'add', label: 'Install App', onClick: () => { void usePwaStore.getState().install(); close() }, show: canInstall },
    {
      icon: 'pip',
      label: 'Picture in Picture',
      onClick: () => {
        const labels = {
          title: t('Telegram is open in Picture-in-Picture mode'),
          hint: t('To return to the tab, click the button here or the icon in the floating window.'),
          back: t('Back to Tab'),
        }
        void enterAppPip(labels).then((ok) => { if (!ok) uiEvents.emit('ui:toast', t('Picture-in-Picture is not supported in this browser.')) })
        close()
      },
      show: pipSupported(),
    },
  ]

  return (
    <>
    <Menu
      open={open}
      onClose={close}
      style={{ top: 68, left: 22, transformOrigin: 'top left' }}
    >
      {/* Account row — same height as items, small ringed avatar in the icon slot (tweb) */}
      <MenuItem
        icon={
          <span style={{ padding: 2, borderRadius: '50%', border: '2px solid var(--tg-accent)', display: 'flex' }}>
            <Avatar background={gradientFor(me?.id ?? 0)} text={meName.charAt(0).toUpperCase()} src={meAvatar} size={26} />
          </span>
        }
        label={meName}
        onClick={onClose}
      />
      {/* Другие аккаунты (мультиаккаунт) — клик переключает */}
      {others.map((a) => (
        <MenuItem
          key={a.id}
          icon={
            <span style={{ padding: 2, display: 'flex' }}>
              <AccountAvatar account={a} />
            </span>
          }
          label={a.name}
          onClick={() => void switchTo(a.id)}
        />
      ))}
      {accounts.length < 4 && (
        <MenuItem icon={<TgIcon name="add" size={20} />} label={t('Add Account')} onClick={() => void addAccount()} />
      )}
      {divider}
      <MenuItem icon={<TgIcon name="savedmessages" size={20} />} label={t('Saved Messages')} onClick={onOpenSaved ?? onClose} />
      <MenuItem icon={<TgIcon name="radiooff" size={20} />} label={t('My Stories')} onClick={onClose} />
      <MenuItem icon={<TgIcon name="user" size={20} />} label={t('Contacts')} onClick={onOpenContacts ?? onClose} />
      {divider}
      <MenuItem icon={<TgIcon name="card_outline" size={20} />} label={t('Wallet')} onClick={onClose} />
      <MenuItem
        icon={<TgIcon name="star_filled" size={20} color="var(--tg-accent)" />}
        label={t('Telegram Premium')}
        onClick={onOpenPremium ?? onClose}
      />
      {divider}
      <MenuItem icon={<TgIcon name="settings" size={20} />} label={t('Settings')} onClick={onOpenSettings} />
      <div ref={moreItemRef}>
        <MenuItem
          icon={<TgIcon name="more" size={20} />}
          label={t('More')}
          right={<TgIcon name="next" size={20} color="var(--tg-textFaint)" />}
          onClick={toggleMore}
        />
      </div>
      {onLogout && (
        <>
          {divider}
          <MenuItem icon={<TgIcon name="logout" size={20} />} label={t('Log Out')} danger onClick={onLogout} />
        </>
      )}
    </Menu>

    {/* Подменю «Ещё» (tweb createMoreSubmenu) — правее основного меню */}
    <Menu
      open={moreOpen && open}
      onClose={close}
      style={{ top: moreAnchor.top, left: moreAnchor.left, transformOrigin: 'top left' }}
    >
      {moreItems
        .filter((it) => it.show !== false)
        .map((it) => (
          <MenuItem key={it.label} icon={<TgIcon name={it.icon as never} size={20} />} label={t(it.label)} onClick={it.onClick} />
        ))}
    </Menu>
    </>
  )
}
