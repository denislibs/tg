/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/settings.tsx` (812502980, 451
 * строка) — корень настроек, вкладка `AppSettingsTab` колоночного слайдера
 * (`solidJsTabs/tabs.ts`, tweb :188-192). Задача 28 плана 2D.
 *
 * Дословно: ⋮ шапки (`edit` → `AppEditProfileTab`, `qr`, `logout` danger,
 * :97-117), класс `settings-container` на вкладке (:228), свой профиль
 * `PeerProfile` с `isDialog: false` и сворачиванием по вкладке (:364-370),
 * секция `div.profile-buttons` — семь строк `makeSubTabConfig` (:251-259) +
 * «Устройства» со счётчиком `titleRight` (:391-397) + «Язык» с `LanguageName`
 * (:398-403) + «Горячие клавиши» (:404-407), Premium-секция (:410-446).
 * Счётчик устройств — fire-and-forget (:350-352), список уходит вкладке
 * готовым и перечитывается на её `destroy` (:354-374).
 *
 * Расхождения (нумерованы, номер — у строки):
 *  1. Поиска по настройкам нет (34f417d12, волна 4 дельты — О-26 плана 2D):
 *     нет кнопки `search` в шапке, второго слоя `settings-search-layer`,
 *     `InputSearch`, `TransitionSlider` слоёв и записи навигации
 *     `settings-search` (:62-222). Без второго слоя незачем и `mainLayer`:
 *     шапка и `.sidebar-content` остаются прямыми детьми вкладки, как в старой
 *     базе (e52b5d931 `settings.tsx:99-101`), — и сворачивание профиля
 *     вешается на саму вкладку (`setCollapsedOn: tab.container`, старая база
 *     :213).
 *  2. Шапка профиля — наш класс `PeerProfileAvatars` СНАРУЖИ `PeerProfile`
 *     (`avatarsContainer`/`avatarsInfo`, тот же контракт узлов-пропов, что у
 *     правой панели `UserInfoPanel.tsx`), а не `PeerProfile.AutoAvatar`
 *     внутри него (tweb `peerProfile.tsx:223-277`). Сворачивание —
 *     Solid-порт `useCollapsable` (`helpers/solid/useCollapsable.ts`) с тем же
 *     эффектом, что tweb `peerProfileAvatars.ts:350-373`. Ожидание аватара
 *     (`onAvatarReady` → `promiseCollector`, :367) — тот же промис
 *     `avatars.setPeer`. Перерисовки по `avatar_update` (`AutoAvatar`) нет:
 *     класс перечитывает фото сам (докблок `setPeer`).
 *  3. Попапы `showMyQrCodePopup`/`showLogOutPopup`/`showPremiumPopup`/
 *     `showStarsPopup`/`showSendGiftPicker` — мосты к React-попапам до 2C-13,
 *     2C-17…2C-20 (`sidebarLeft/settingsPopups.tsx`, ВРЕМЕННО у каждой).
 *  4. `AppPrivacyAndSecurityTab`, `AppEditProfileTab` — классы tweb, но
 *     содержимое до порта — React-экраны
 *     (`scaffoldReactScreenTab`, ВРЕМЕННО до 2D-23, 2D-27). `getEditProfileInitArgs(true)` (:106) не
 *     передаётся — React-экран грузит профиль сам.
 *  5. `premiumBlocked` (:315-318) — ВСЕГДА ложь: источника
 *     `apiManagerProxy.isPremiumPurchaseBlocked()` у нас нет, секция видна
 *     всегда. Строки TON (`useStars(true)`, `hasTonTransactions`, :329-331,
 *     :430-437) нет: ни баланса TON, ни его транзакций у бэкенда нет.
 *  6. Бизнес-бота (`getConnectedBot`, `chat_automation_update`, :279-298,
 *     :340-348, :356-362) нет: у бэкенда нет подключённых ботов — счётчик
 *     устройств = число сессий, вкладке `connectedBot`/`ttlDays` не уходят
 *     (TTL — О-7 плана 2D).
 *  7. `lottieLoader.loadLottieWorkers()` (:373) не зовётся: наш lottie-движок
 *     (tlottie) поднимает воркеры сам при первом плеере.
 *  8. `ariaLabel` кнопки ⋮ (`MultiAccount.More`, :101) — у нашего
 *     `ButtonIcon` нет опции `ariaLabel` (порт `buttonIcon.ts`).
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import type { Authorization } from '@layer'
import type { IconName } from '@core/tgico-icons'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import PeerProfile from '@components/peerProfile.solid'
import PeerProfileAvatars from '@components/peerProfileAvatars'
import type SidebarSlider from '@components/slider'
import { type SliderSuperTabConstructable, SliderSuperTabEventable } from '@components/sliderTab'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import {
  AppActiveSessionsTab,
  AppChatFoldersTab,
  AppDataAndStorageTab,
  AppEditProfileTab,
  AppGeneralSettingsTab,
  AppKeyboardShortcutsTab,
  AppLanguageTab,
  AppNotificationsTab,
  AppPrivacyAndSecurityTab,
  AppSpeakersAndCameraTab,
  AppStickersAndEmojiTab,
} from '@components/solidJsTabs/tabs'
import {
  showLogOutPopup,
  showMyQrCodePopup,
  showPremiumPopup,
  showSendGiftPicker,
  showStarsPopup,
} from '@components/sidebarLeft/settingsPopups'
import { useCollapsable } from '@helpers/solid/useCollapsable'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { shouldForceFold } from '@components/userInfo/helpers'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import type { Managers } from '@/client/bootstrap'

// ─────────────────────────────────────────────────────────────────────────────
// Helper — wraps a sub-tab declaration. If the tab has a static `getInitArgs`,
// fires the prefetch immediately so the per-domain promises start downloading
// the moment Settings opens. On click we await whatever was prefetched, hand it
// to `tab.open(...)`, and re-arm the prefetch after the sub-tab is destroyed.
// (tweb :55-86)
// ─────────────────────────────────────────────────────────────────────────────

type SubTabConfig = {
  icon: IconName
  text: LangPackKey
  tabConstructor: SliderSuperTabConstructable
  getInitArgs?: () => any[]
  args?: any
}

const makeSubTabConfig = (
  icon: IconName,
  text: LangPackKey,
  tabConstructor: SliderSuperTabConstructable,
  fromTab: unknown,
): SubTabConfig => {
  let getInitArgs: (() => any[]) | undefined
  const g = (tabConstructor as { getInitArgs?: (fromTab: unknown) => unknown }).getInitArgs
  if(g) {
    getInitArgs = () => [g(fromTab)]
  }
  return {
    icon,
    text,
    tabConstructor,
    getInitArgs,
    args: getInitArgs?.(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab UI
// ─────────────────────────────────────────────────────────────────────────────

const Settings = () => {
  const promiseCollector = usePromiseCollector()
  const [tab] = useSuperTab()
  const slider = () => tab.slider as SidebarSlider
  const managers = tab.managers as Managers

  // ── Header: the overflow menu (tweb :97-117; поиска нет — расхождение 1).
  const btnMenu = ButtonMenuToggle({
    listenerSetter: tab.listenerSetter,
    direction: 'bottom-left',
    buttons: [{
      icon: 'edit',
      text: 'EditAccount.Title',
      // расхождение 4
      onClick: () => void slider().createTab(AppEditProfileTab).open(),
    }, {
      icon: 'qr',
      text: 'QRCode.Title',
      onClick: () => showMyQrCodePopup(),
    }, {
      icon: 'logout',
      text: 'EditAccount.Logout',
      danger: true,
      onClick: () => showLogOutPopup(managers),
    }],
  })

  onMount(() => {
    tab.container.classList.add('settings-container')
    tab.header.append(btnMenu)
  })

  onCleanup(() => {
    // the header outlives the component (it belongs to the tab), so take the
    // button back out (tweb :219-221)
    btnMenu.remove()
  })

  // ── Sub-tab rows (notifications/data/privacy/general/folders/stickers/speakers).
  const subTabConfigs: SubTabConfig[] = [
    makeSubTabConfig('bell_filled', 'AccountSettings.Notifications', AppNotificationsTab, tab),
    makeSubTabConfig('data_filled', 'DataSettings', AppDataAndStorageTab, tab),
    makeSubTabConfig('key_filled', 'AccountSettings.PrivacyAndSecurity', AppPrivacyAndSecurityTab, tab),
    makeSubTabConfig('general_filled', 'Telegram.GeneralSettingsViewController', AppGeneralSettingsTab, tab),
    makeSubTabConfig('limit_folders_filled', 'AccountSettings.Filters', AppChatFoldersTab, tab),
    makeSubTabConfig('reactions_filled', 'StickersName', AppStickersAndEmojiTab, tab),
    makeSubTabConfig('speaker_filled', 'AccountSettings.SpeakersAndCamera', AppSpeakersAndCameraTab, tab),
  ]

  const onSubTabClick = (item: SubTabConfig) => async() => {
    const args = item.args ? await item.args : []
    const subTab = slider().createTab(item.tabConstructor)
    void subTab.open(...args)

    if(subTab instanceof SliderSuperTabEventable && item.getInitArgs) {
      subTab.eventListener.addEventListener('destroyAfter', (promise: Promise<void>) => {
        item.args = promise.then(() => item.getInitArgs!())
      })
    }
  }

  // ── Devices row + active sessions fetch (tweb :279-383; расхождение 6).
  let authorizations: Authorization.authorization[] | undefined
  let getAuthorizationsPromise: Promise<Authorization.authorization[]> | undefined
  const [authCount, setAuthCount] = createSignal('')
  const updateAuthCount = () => {
    if(authorizations) {
      setAuthCount('' + authorizations.length)
    }
  }

  const getAuthorizations = (overwrite?: boolean) => {
    if(getAuthorizationsPromise && !overwrite) return getAuthorizationsPromise

    const promise = getAuthorizationsPromise = managers.sessions.list()
      .finally(() => {
        if(getAuthorizationsPromise === promise) {
          getAuthorizationsPromise = undefined
        }
      })

    return promise
  }

  const updateActiveSessions = (overwrite?: boolean) => {
    return getAuthorizations(overwrite).then((auths) => {
      authorizations = auths
      updateAuthCount()
    })
  }

  // Fire-and-forget: the device count fills in via the `authCount` signal after
  // the tab is shown (tweb :350-352). Отказа оригинал не ловит — у нас он гасится,
  // чтобы не всплывать необработанным: число просто не появится.
  updateActiveSessions().catch(() => {})

  const onDevicesClick = async() => {
    if(!authorizations) {
      await updateActiveSessions()
    }

    const subTab = slider().createTab(AppActiveSessionsTab)
    subTab.eventListener.addEventListener('destroy', () => {
      authorizations = undefined
      updateActiveSessions(true).catch(() => {})
    }, { once: true })
    void subTab.open({ authorizations: authorizations! })
  }

  // ── Premium section (tweb :314-331; расхождение 5).
  const stars = subscribeExternal(
    useAppStateStore.subscribe,
    () => useAppStateStore.getState().starsBalance ?? 0,
  )

  // ── Self profile (avatar + name + collapse-on-scroll; tweb :364-370,
  //    расхождение 2).
  const meId = useChatsStore.getState().meId!
  const scrollableEl = tab.scrollable.container
  const avatars = new PeerProfileAvatars({
    managers,
    setCollapsedOn: tab.container,
    scrollableEl,
    unfold: (e) => unfold(e),
  })
  const { folded, unfold, fold } = useCollapsable({
    container: () => avatars.container,
    listenWheelOn: tab.container,
    scrollable: () => scrollableEl,
    disableHoverWhenFolded: false,
  })
  // tweb `peerProfileAvatars.ts:365-372`
  createEffect(() => {
    if(shouldForceFold(avatars.hasPhoto, folded())) {
      fold()
      return
    }

    avatars.setCollapsed(folded())
  })
  promiseCollector.collect(avatars.setPeer(meId))
  onCleanup(() => avatars.cleanup())

  return (
    <>
      <PeerProfile
        peerId={meId}
        isDialog={false}
        scrollable={scrollableEl}
        setCollapsedOn={tab.container}
        avatarsContainer={avatars.container}
        avatarsInfo={avatars.info}
      />
      <Section>
        <div class="profile-buttons">
          <For each={subTabConfigs}>
            {(item) => (
              <Row clickable={onSubTabClick(item)}>
                <Row.Icon icon={item.icon} />
                <Row.Title>{i18n(item.text)}</Row.Title>
              </Row>
            )}
          </For>
          <Row clickable={onDevicesClick}>
            <Row.Icon icon="devices_filled" />
            <Row.Title titleRight={<span>{authCount()}</span>} titleRightSecondary>
              {i18n('Devices')}
            </Row.Title>
          </Row>
          <Row clickable={() => void slider().createTab(AppLanguageTab).open()}>
            <Row.Icon icon="web_filled" />
            <Row.Title titleRight={i18n('LanguageName')} titleRightSecondary>
              {i18n('AccountSettings.Language')}
            </Row.Title>
          </Row>
          <Row clickable={() => void slider().createTab(AppKeyboardShortcutsTab).open()}>
            <Row.Icon icon="keyboard_filled" />
            <Row.Title>{i18n('KeyboardShortcuts.Title')}</Row.Title>
          </Row>
        </div>
      </Section>
      <Section>
        <Row clickable={() => showPremiumPopup()}>
          <Row.Icon icon="premium_badge" />
          <Row.Title>{i18n('Premium.Boarding.Title')}</Row.Title>
        </Row>
        <Show when={!!stars()}>
          <Row clickable={() => showStarsPopup()}>
            <Row.Icon icon="star_circle_filled" />
            <Row.Title titleRight={'' + stars()} titleRightSecondary>
              {i18n('MenuTelegramStars')}
            </Row.Title>
          </Row>
        </Show>
        <Row clickable={() => showSendGiftPicker()}>
          <Row.Icon icon="gift_filled" />
          <Row.Title>{i18n('Chat.Menu.SendGift')}</Row.Title>
        </Row>
      </Section>
    </>
  )
}

export default Settings
