/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/lastSeen.tsx:1-89 (812502980) —
 * вкладка правила `last_seen` (`AppPrivacyLastSeenTab`, `solidJsTabs/tabs.ts`):
 * `PrivacySection` в скроллер вкладки, под ним — секция тумблера «Hide Read Time»
 * с подписью `HideReadTimeInfo` (:64-74), видимая, только когда «был в сети» от
 * кого-то скрыт (`canHideReadTime`, :23-25, :38-40); тумблер пишется на закрытии
 * и только при изменении (:44-59).
 *
 * Расхождения с оригиналом:
 *  1. (О-18) Предмет тумблера — не флаг `globalPrivacySettings.hide_read_marks`
 *     (его на бэкенде нет), а наше правило `read_time` («кто видит, когда я
 *     прочитал»), которое сервер проверяет ВЗАИМНО
 *     (`backend/internal/usecase/chat/message.go::OutboxReadDate`). Смысл флага
 *     tweb — «скрыть время прочтения от тех, кто не видит мой „был в сети“, и
 *     самому не видеть их» — это ровно правило `read_time`, равное правилу
 *     `last_seen`; поэтому «включено» пишет в `read_time` копию правила этой же
 *     вкладки (`PrivacySection.getRule`), «выключено» — «Все» без исключений.
 *     Отметка на открытии — `read_time` не «Все без исключений». Своей вкладки
 *     и строки хаба у правила больше нет: так у оригинала (задача 23 плана 2D).
 *     Правило, заданное прежней вкладкой независимо от «был в сети», на первом
 *     закрытии с изменением приводится к этой форме. Нет и полезной нагрузки
 *     `GlobalPrivacySettings` и события `privacy` (:16, :57).
 *  2. (О-34) Секции с кнопкой «Premium: last seen» (:75-84, `showPremiumPopup`)
 *     нет: попап премиума — React (волна 2C), у сервера нет премиум-обхода
 *     правила «был в сети».
 *  3. Ключ правила — наш `PrivacyKey` (шапка `components/privacySection.solid.tsx`).
 */
import { createSignal, onMount } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import type { PrivacyRule } from '@core/managers/privacyManager'
import PrivacySection, { getPrivacy, PrivacyType, setPrivacy } from '@components/privacySection.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppPrivacyLastSeenTab } from '@components/solidJsTabs/tabs'

// расхождение 1
const isHidingReadTime = (rule: PrivacyRule) => rule.value !== 'everybody' || !!rule.denyUserIds.length

const sameIds = (a: PeerId[], b: PeerId[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

const sameRule = (a: PrivacyRule, b: PrivacyRule) =>
  a.value === b.value && sameIds(a.allowUserIds, b.allowUserIds) && sameIds(a.denyUserIds, b.denyUserIds)

const PrivacyLastSeen = () => {
  const [tab] = useSuperTab<typeof AppPrivacyLastSeenTab>()
  const managers = tab.managers!
  const hideReadTimeSignal = createSignal(false)
  const [showAdditionalSettings, setShowAdditionalSettings] = createSignal(true)

  let privacySection: PrivacySection

  const canHideReadTime = () => {
    return privacySection.type !== PrivacyType.Everybody || !!privacySection.peerIds.disallow?.length
  }

  onMount(() => {
    tab.container.classList.add('privacy-tab', 'privacy-last-seen')

    const caption: LangPackKey = 'PrivacySettingsController.LastSeenDescription'
    privacySection = new PrivacySection({
      tab,
      title: 'LastSeenTitle',
      inputKey: 'last_seen',
      captions: [caption, caption, caption],
      exceptionTexts: ['PrivacySettingsController.NeverShare', 'PrivacySettingsController.AlwaysShare'],
      appendTo: tab.scrollable,
      onRadioChange: () => {
        setShowAdditionalSettings(canHideReadTime())
      },
      managers,
    })

    // расхождение 1: отметка — по правилу `read_time`
    void getPrivacy(managers, 'read_time').then((readTime) => {
      hideReadTimeSignal[1](isHidingReadTime(readTime))

      tab.eventListener.addEventListener('destroy', () => {
        const hide = hideReadTimeSignal[0]() && canHideReadTime()
        const rule: PrivacyRule = hide ?
          { ...privacySection.getRule(), key: 'read_time' } :
          { key: 'read_time', value: 'everybody', allowUserIds: [], denyUserIds: [] }
        if(sameRule(rule, readTime)) {
          return
        }

        return setPrivacy(managers, rule)
      }, { once: true })
    })
  })

  return (
    <Section
      classList={{ hide: !showAdditionalSettings() }}
      caption="HideReadTimeInfo"
    >
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx signal={hideReadTimeSignal} toggle />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('HideReadTime')}</Row.Title>
      </Row>
    </Section>
  )
}

export default PrivacyLastSeen
