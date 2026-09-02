import type { LangPackKey } from '@/lang'
import type { Authorization } from '@layer'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import SettingsSubScreen, { hasSubScreen } from './SettingsSubScreen'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'
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
import { useT } from '../i18n'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import rootScope from '@lib/rootScope'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { getPeerPhotoId, getPeerPhotoStrippedThumb } from '../core/peers/peer'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { useSettings } from '../settings'
import { useManagers } from '../core/hooks/useManagers'
import { createSettingsSliderHost, getSettingsSliderHost, openActiveSessionsTab } from './sidebarLeft/settingsSliderHost'
import { AppLanguageTab } from './solidJsTabs/tabs'
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

// Экспорт — ради пина на подпись строки «Язык» (`SettingsView.langRow.test.tsx`):
// сам корень настроек тянет за собой слайдер вкладок, карточку и попапы, и
// рендерить всё это ради одной подписи незачем.
export const settingsItems: { icon: ReactNode; label: LangPackKey; value?: LangPackKey }[] = [
  { icon: <TgIcon name="unmute" size={24} />, label: 'AccountSettings.Notifications' },
  { icon: <TgIcon name="data" size={24} />, label: 'DataSettings' },
  { icon: <TgIcon name="lock" size={24} />, label: 'PrivacySettings' },
  { icon: <TgIcon name="settings" size={24} />, label: 'Telegram.GeneralSettingsViewController' },
  { icon: <TgIcon name="folder" size={24} />, label: 'ChatList.Filter.List.Title' },
  { icon: <TgIcon name="smile" size={24} />, label: 'StickersName' },
  { icon: <TgIcon name="videocamera" size={24} />, label: 'AccountSettings.SpeakersAndCamera' },
  { icon: <TgIcon name="devices" size={24} />, label: 'Devices' },
  // Подпись строки — имя ТЕКУЩЕГО языка на нём самом, обычным ключом:
  // `LanguageName` переводится каждым словарём в своё самоназвание (tweb
  // `sidebarLeft/tabs/settings.tsx:254`). Списка языков для этого не нужно, и
  // особой ветки на рендере — тоже.
  //
  // Ключ ЗАГОЛОВКА строки — `AccountSettings.Language` (:255), а не
  // `Telegram.LanguageViewController`: последний у оригинала подписывает саму
  // ВКЛАДКУ (`solidJsTabs/tabs.ts:157`), и теперь ею же подписана наша
  // (`AppLanguageTab`). По-английски обе строки читаются одинаково — тем
  // легче было спутать, и тем незаметнее разъехались бы переводы.
  { icon: <TgIcon name="language" size={24} />, label: 'AccountSettings.Language', value: 'LanguageName' },
  { icon: <TgIcon name="keyboard" size={24} />, label: 'KeyboardShortcuts.Title' },
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
  initialSub?: LangPackKey
}) {
  const t = useT()
  const managers = useManagers()
  const themeChoice = useSettings((s) => s.themeChoice)
  const isDark = PRESET_MODE[resolvePreset(themeChoice)] === 'dark'
  const [active, setActive] = useState(initialSub ?? 'AccountSettings.Notifications')
  const [sub, setSub] = useState<LangPackKey | null>(initialSub ?? null)
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
  // Слои навигации ЗАВЕДЕНЫ — тем же способом, что у соседей по колонке
  // (`ContactsView`, `CallsView`). До этого экран не заводил ни одного, и Esc
  // над настройками проваливался в `escFallback` (`core/hooks/useAppHotkeys.ts:63`),
  // то есть ЗАКРЫВАЛ ЧАТ ПОД НИМИ вместо самих настроек.
  //
  // Слоёв ДВА, и порядок между ними — обычный LIFO стека: экран заводит свой на
  // монтировании, под-экран кладёт второй поверх, пока открыт. Поэтому Esc
  // закрывает сначала под-экран, потом настройки, и только потом доходит до
  // чата — как в Telegram.
  //
  // Это ВРЕМЕННАЯ мера, а не порт: в оригинале настройки — вкладка того же
  // слайдера (`AppSettingsTab`), и слой ей заводит слайдер, как любой другой
  // вкладке. Уйдёт вместе со швом, когда корень настроек станет вкладкой №0
  // (ЗАДАЧА #112, пункт 2).
  useNavLayer(true, onBack, 'left')
  useNavLayer(sub !== null, () => setSub(null), 'left')

  // Счётчик устройств в строке «Devices» — порт `authCount`
  // (tweb `sidebarLeft/tabs/settings.tsx:151`, :172-176, показ — :248).
  //
  // Запрос идёт FIRE-AND-FORGET, как у оригинала (:175-177: «Letting the device
  // count fill in via the `authCount` signal after the tab is shown matches the
  // legacy behaviour»): открытие настроек его не ждёт, число доезжает следом, а
  // до ответа строка стоит без подписи — пустая строка у `createSignal('')`.
  //
  // Отказ ГАСИТСЯ молча и тоже как у оригинала: у него на этот промис нет ни
  // `catch`, ни ветки ошибки — не показать число не повод показывать ошибку в
  // строке, по которой пользователь ещё не кликал. Кликнет — отказ покажет уже
  // сам переход во вкладку (`openActiveSessionsTab().catch(toastNew)` ниже).
  const [authCount, setAuthCount] = useState('')
  const middlewareHelper = useMiddlewareHelper()
  // Сам список — ЗДЕСЬ, как у оригинала (`settings.tsx:149`): вкладка получает
  // его готовым, и клик по строке не дёргает ту же ручку второй раз (:179-181).
  const authorizationsRef = useRef<Authorization.authorization[] | undefined>(undefined)
  // Летящий запрос — порт `getAuthorizationsPromise` (`settings.tsx:150`,
  // :153-165). Без него клик по строке РАНЬШЕ ответа стартового запроса дёргал
  // бы ту же ручку второй раз: у оригинала оба входа ждут ОДИН промис.
  const inFlightRef = useRef<Promise<Authorization.authorization[]> | undefined>(undefined)
  const getAuthorizations = useCallback((overwrite?: boolean) => {
    if(inFlightRef.current && !overwrite) return inFlightRef.current
    const promise = inFlightRef.current = managers.sessions.list()
      .finally(() => { if(inFlightRef.current === promise) inFlightRef.current = undefined })
    return promise
  }, [managers])

  const updateActiveSessions = useCallback((overwrite?: boolean) => {
    const middleware = middlewareHelper.get()
    return getAuthorizations(overwrite)
      .then((list) => {
        authorizationsRef.current = list
        if(middleware()) setAuthCount('' + list.length)
      })
      .catch(() => {})
  }, [getAuthorizations, middlewareHelper])

  useEffect(() => { void updateActiveSessions() }, [updateActiveSessions])

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
          <Text size={14} color="var(--secondary-text-color)">{t('Online')}</Text>
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
              rootScope.dispatchEvent('ui:toast', t('PhoneCopied'))
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
            <Text size={16} color="var(--primary-text-color)" className={s.rowBody}>{t('General.NightMode')}</Text>
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
                  // Порт `onDevicesClick` (tweb `settings.tsx:178-189`)
                  // целиком: списка ещё нет — дожидаемся ТОГО ЖЕ запроса, что
                  // стартовал на монтировании (:179-181); вкладке он уходит
                  // готовым; на её закрытии список протухает и счётчик
                  // перечитывается (:184-187) — во вкладке сессию могли
                  // завершить.
                  void (async () => {
                    if(!authorizationsRef.current) await updateActiveSessions()
                    await openActiveSessionsTab(managers, {
                      authorizations: authorizationsRef.current,
                      onDestroy: () => {
                        authorizationsRef.current = undefined
                        void updateActiveSessions(true)
                      },
                    })
                  })().catch(() => toastNew({ langPackKey: 'Error.AnError' }))
                  return
                }
                // «Язык» — тоже портированная вкладка слайдера. У оригинала это
                // одна строка (`settings.tsx:252` —
                // `tab.slider.createTab(AppLanguageTab).open()`), и здесь она
                // ровно такая же: ни списка языков, ни данных вперёд вкладке не
                // передаётся — она берёт их сама в свой `promiseCollector`.
                if (it.label === 'AccountSettings.Language') {
                  void getSettingsSliderHost().openTab(AppLanguageTab)
                    .catch(() => toastNew({ langPackKey: 'Error.AnError' }))
                  return
                }
                if (hasSubScreen(it.label)) setSub(it.label)
              }}
            >
              <div className={s.rowIcon}>{it.icon}</div>
              <Text size={16} color="var(--primary-text-color)" className={s.rowBody}>{t(it.label)}</Text>
              {it.value && (
                <Text size={15} color="var(--secondary-text-color)">{t(it.value)}</Text>
              )}
              {it.label === 'Devices' && authCount && (
                <Text size={15} color="var(--secondary-text-color)">{authCount}</Text>
              )}
            </div>
          ))}
        </Section>

        {/* Premium / Gift */}
        <Section>
          <Row
            icon={<TgIcon name="star_filled" size={24} color="var(--primary-color)" />}
            label="Premium.Boarding.Title"
            sublabel={user?.pFlags?.premium ? t('Premium.Row.Active') : t('Premium.Row.Subtitle')}
            onClick={() => (user?.pFlags?.premium ? setPremiumManageOpen(true) : setPremiumOpen(true))}
          />
          <Row
            icon={
              user?.emoji_status_emoticon
                ? <span style={{ fontSize: 22, lineHeight: 1 }}>{user.emoji_status_emoticon}</span>
                : <TgIcon name="smile" size={24} color="var(--secondary-text-color)" />
            }
            label="EmojiStatus.Set"
            onClick={() => setEmojiStatusOpen(true)}
          />
          <Row
            icon={<TgIcon name="gift" size={24} color="var(--secondary-text-color)" />}
            label="Chat.Menu.SendGift"
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
