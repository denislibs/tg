import { useEffect, useRef, useState } from 'react'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { useChatsStore } from '../stores/chatsStore'
import { useManagers } from '../core/hooks/useManagers'
import { gradientFor } from '../core/dialogToChat'
import { getPeerPhotoId } from '../core/peers/peer'
import { getUserTitle } from '../core/peers/getPeerTitle'
import type { PublicAccount } from '../core/auth/accounts'
import { ANIMATE_AUTH_KEY, PREV_ACCOUNT_KEY, commandThenReload, playChatlistExit, playMainScreenExit } from '../core/accountTransition'
import { useSettings } from '../settings'
import { usePwaStore } from '../core/pwa'
import { enterAppPip, pipSupported } from '../core/pip'
import rootScope from '@lib/rootScope'
import type { ToggleMode } from '../App'
import { useT } from '../i18n'
import { APP_TITLE, APP_VERSION_FULL } from '../config/app'

/** куда ведёт футер подменю (tweb — свой CHANGELOG.md на гитхабе) */
const CHANGELOG_URL = 'https://github.com/denislibs/messenger/blob/main/CHANGELOG.md'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenContacts?: () => void
  onOpenSaved?: () => void
  onOpenPremium?: () => void
  onOpenMyStories?: () => void
  onOpenCloseFriends?: () => void
  onOpenWallet?: () => void
  onOpenCalls?: () => void
  onLogout?: () => void
  onToggleMode?: ToggleMode
}

// Аватар аккаунта в списке (id медиа → objectURL воркерного конвейера).
function AccountAvatar({ account }: { account: PublicAccount }) {
  const src = useMediaUrl(account.photoId || null)
  return (
    <Avatar
      className="btn-menu-item-icon is-external btn-menu-item-avatar"
      background={gradientFor(account.id)}
      text={account.name.charAt(0).toUpperCase()}
      src={src}
      size={24}
    />
  )
}

export default function MainMenu({
  open,
  onClose,
  onOpenSettings,
  onOpenContacts,
  onOpenSaved,
  onOpenPremium,
  onOpenMyStories,
  onOpenCloseFriends,
  onOpenWallet,
  onOpenCalls,
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
  // tweb раскрывает подменю ПО НАВЕДЕНИЮ (`createSubmenuTrigger.ts:53`
  // `triggerEvent: 'mouseenter'`), клик по самому триггеру гасится
  // (`stopPropagation`, там же:36-38) и меню не закрывает. Смещение [-5,-5] —
  // оттуда же (offset в attachFloatingButtonMenu).
  const openMore = () => {
    const r = moreItemRef.current?.getBoundingClientRect()
    if (r) setMoreAnchor({ top: r.top - 5, left: r.right - 5 })
    setMoreOpen(true)
  }
  const me = useChatsStore((s) => s.me)
  const meAvatar = useMediaUrl(getPeerPhotoId(me?.user.photo) || null)
  // Имя собирает клиент (`display_name` с провода убран); фолбэки — внутри
  // getUserTitle, свой здесь только на «карточки ещё нет».
  const meName = me ? getUserTitle(me.user) : 'Аккаунт'
  // Разделитель групп — обычный <hr>, как в tweb (`buttonMenu.ts:196`
  // `options.separator = document.createElement('hr')`); стили — `_button.scss:633`.
  const divider = <hr />

  // Мультиаккаунт: реестр аккаунтов (кроме активного) + лимит 4.
  const [accounts, setAccounts] = useState<PublicAccount[]>([])
  useEffect(() => {
    if (!open) return
    void managers.auth.listAccounts().then(setAccounts)
  }, [open, managers])
  const others = accounts.filter((a) => a.id !== me?.user.id)
  // Переключение аккаунта = смена активного токена в воркере + перезагрузка.
  // Порядок 1:1 с tweb (`sidebarLeft/index.ts:828-837`): сначала список чатов
  // уезжает chatlist-exit, и только потом идёт команда смены аккаунта. Не
  // наоборот (Important 3 раунда 4): воркер объявляет rt:logging_out ДО ответа
  // RPC и той же очередью порта, кадр приходит и инициатору — при обратном
  // порядке reload из обработчика срезал бы анимацию, которая ещё даже не
  // начиналась. Успех switchAccount заранее не проверяем — как и tweb, который
  // зовёт changeAccount() без проверок: id взят из только что прочитанного
  // реестра, а если аккаунт всё же исчез, reload просто вернёт эту же вкладку
  // под текущим аккаунтом. Отказ RPC (сбой IDB) глотаем по той же причине:
  // reload выведет состояние с диска заново, что бы ни случилось.
  const switchTo = async (id: number) => {
    onClose()
    await playChatlistExit(document.getElementById('chatlist-column'))
    await commandThenReload(managers.auth.switchAccount(id))
  }
  // «Добавить аккаунт» (tweb sidebarLeft.addAccount): текущий остаётся в
  // реестре; чат уезжает main-screen-exit, флаги «prev account» и «анимировать
  // auth» переживают reload — экран входа въедет hostEnter, из него есть
  // стрелка возврата к прежнему аккаунту.
  const addAccount = async () => {
    onClose()
    if (me) localStorage.setItem(PREV_ACCOUNT_KEY, String(me.user.id))
    localStorage.setItem(ANIMATE_AUTH_KEY, '1')
    // Анимация — до команды, как в tweb (`sidebarLeft/index.ts:1643-1652`) и
    // по той же причине, что в switchTo выше: rt:logging_out прилетает и этой
    // вкладке.
    await playMainScreenExit(document.getElementById('page-chats'))
    await commandThenReload(managers.auth.addAccount())
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
          title: t('Pip.ActiveTitle'),
          hint: t('Pip.ActiveHint'),
          back: t('Pip.BackToTab'),
        }
        void enterAppPip(labels).then((ok) => { if (!ok) rootScope.dispatchEvent('ui:toast', t('Pip.Unsupported')) })
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
      corner="bottom-right"
      style={{ top: 68, left: 22 }}
    >
      {/* Строка аккаунта: в tweb аватарка САМА является иконкой пункта —
          `div.avatar.avatar-like.avatar-24.avatar-gradient.btn-menu-item-icon.is-external.btn-menu-item-avatar.active`
          (дамп 18-burger-menu-full). Обёрток и колец инлайн-стилем нет: рамку
          активного аккаунта рисует `.btn-menu-item-avatar.active`. */}
      <MenuItem
        icon={
          <Avatar
            className="btn-menu-item-icon is-external btn-menu-item-avatar active"
            background={gradientFor(me?.user.id ?? 0)}
            text={meName.charAt(0).toUpperCase()}
            src={meAvatar}
            size={24}
          />
        }
        label={meName}
        onClick={onClose}
      />
      {/* Другие аккаунты (мультиаккаунт) — клик переключает */}
      {others.map((a) => (
        <MenuItem
          key={a.id}
          icon={<AccountAvatar account={a} />}
          label={a.name}
          onClick={() => void switchTo(a.id)}
        />
      ))}
      {accounts.length < 4 && (
        <MenuItem icon={<TgIcon name="add" size={20} />} label={t('MultiAccount.AddAccount')} onClick={() => void addAccount()} />
      )}
      {divider}
      <MenuItem icon={<TgIcon name="savedmessages" size={20} />} label={t('SavedMessages')} onClick={onOpenSaved ?? onClose} />
      <MenuItem icon={<TgIcon name="radiooff" size={20} />} label={t('MyStories.Title')} onClick={onOpenMyStories ?? onClose} />
      <MenuItem icon={<TgIcon name="user" size={20} />} label={t('Contacts')} onClick={onOpenContacts ?? onClose} />
      <MenuItem icon={<TgIcon name="phone" size={20} />} label={t('PrivacySettings.VoiceCalls')} onClick={onOpenCalls ?? onClose} />
      <MenuItem icon={<TgIcon name="newprivate" size={20} />} label={t('CloseFriends.Title')} onClick={onOpenCloseFriends ?? onClose} />
      {divider}
      <MenuItem icon={<TgIcon name="card_outline" size={20} />} label={t('Stars.Wallet')} onClick={onOpenWallet ?? onClose} />
      <MenuItem
        icon={<TgIcon name="star_filled" size={20} color="var(--primary-color)" />}
        label={t('Premium.Boarding.Title')}
        onClick={onOpenPremium ?? onClose}
      />
      {divider}
      <MenuItem icon={<TgIcon name="settings" size={20} />} label={t('Settings')} onClick={onOpenSettings} />
      <div ref={moreItemRef}>
        <MenuItem
          icon={<TgIcon name="more" size={20} />}
          label={t('MultiAccount.More')}
          submenu
          onMouseEnter={openMore}
          onClick={openMore}
        />
      </div>
      {onLogout && (
        <>
          {divider}
          <MenuItem icon={<TgIcon name="logout" size={20} />} label={t('EditAccount.Logout')} danger onClick={onLogout} />
        </>
      )}
    </Menu>

    {/* Подменю «Ещё» — правее основного меню. Классы панели 1:1 с tweb:
        `btn-menu-submenu` вешает createSubmenuTrigger.ts:47, `sidebar-tools-submenu`
        — sidebarLeft/index.ts:1007. */}
    <Menu
      open={moreOpen && open}
      onClose={close}
      className="btn-menu-submenu sidebar-tools-submenu"
      corner="bottom-right"
      style={{ top: moreAnchor.top, left: moreAnchor.left }}
    >
      {moreItems
        .filter((it) => it.show !== false)
        .map((it) => (
          <MenuItem key={it.label} icon={<TgIcon name={it.icon as never} size={20} />} label={t(it.label)} onClick={it.onClick} />
        ))}
      {/* Футер меню — версия сборки ссылкой (tweb getVersionLink,
          sidebarLeft/index.ts:1660-1672): a.btn-menu-footer > span.btn-menu-footer-text. */}
      <a
        className="btn-menu-footer"
        href={CHANGELOG_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => { e.stopPropagation(); close() }}
      >
        <span className="btn-menu-footer-text">{`${APP_TITLE} ${APP_VERSION_FULL}`}</span>
      </a>
    </Menu>
    </>
  )
}
