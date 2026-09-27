/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/privacySection.tsx:1-393 (812502980) — секция правила
 * приватности: радио «Все / Мои контакты / Никто» с подписью, меняющейся по
 * выбору, и секция «Исключения» с двумя строками (Never / Always). Класс, как у
 * оригинала: вкладки `sidebarLeft/tabs/privacy/*` собирают из него императивно
 * одну-две секции и дописывают в свой скроллер; разметка — Solid `Section`/`Row`
 * через `wrapSolidComponent`. Правило пишется на `destroy` вкладки (`:271`,
 * `:279-344`), а не на каждом щелчке.
 *
 * Строка исключения — `Row.Icon` + `Row.Title` + `Row.Subtitle` со счётчиком
 * (`:214-216`): значение ПОД заголовком. Справа (`titleRight`, `flex: 0 0 auto`,
 * `_row.scss:222-226`) оно съедало русский заголовок до «Н…» — так было в
 * прежнем React-экране `settings/PrivacyRule.tsx`.
 *
 * Расхождения с оригиналом:
 *  1. Ключ правила — наш `PrivacyKey` (`core/managers/privacyManager.ts`, 12
 *     ключей бэкенда), а правило — экранная форма `PrivacyRule` (значение + два
 *     списка пользователей) вместо вектора `InputPrivacyRule`. Перевод в вектор
 *     конструкторов — `toPrivacyRules` менеджера; `getPrivacyRulesDetails` (`:234`)
 *     не нужен — экранная форма уже разобрана.
 *  2. `appPrivacyManager.getPrivacy` (`:72`) → `stores/privacyStore.ts`: у tweb
 *     ответ кэшируется в менеджере (`appPrivacyManager.ts:59-76`), у нас кэш —
 *     стор правил, загруженный на старте (`loadPrivacy`); не загружен — запрос
 *     ключа с зеркалом в стор. `setPrivacy` (`:343`) → `managers.privacy.setRule`
 *     + зеркало ответа в стор (у tweb это `updatePrivacy` → `privacy_update`,
 *     `appPrivacyManager.ts:14-17`, его слушает хаб); при ошибке стор
 *     перечитывается с сервера — хаб не показывает несохранённое.
 *  3. (О-17) Исключения — только пользователи: у `PrivacyRuleWire` нет
 *     `privacyValue(Dis)allowChatParticipants`. Селектору передаётся
 *     `filterPeerTypeBy: ['isUser']` (у оригинала вкладка выбора берёт группы и
 *     пользователей), `splitPeersByType` и ветки чатов в `generateStr`/записи
 *     (`:303-329`, `:372-379`, `:389`) не перенесены.
 *  4. (О-33) Нет `allowMiniApps`/`extras` (`:40-43`, `:188`, `:198`, `:204-209`,
 *     `:247-249`, `:337-339`, `:382`, `:390`) — мини-приложений и такого
 *     правила у нас нет; `takeOut` получает только пиров.
 *  5. (О-34) Нет премиум-замка: `premiumOnly`/`premiumCaption`/`premiumError`,
 *     `locked` радио и тост с `showPremiumPopup` (`:46`, `:95-97`, `:112-126`,
 *     `:132`, `:254-266`, `:275-282`), `myContactsAndPremium` (`:85-88`) и
 *     `privacyType` (`:64`, `:235`). Наш сервер не требует премиум ни для одного
 *     правила, попап премиума — React (волна 2C).
 *  6. Подпись — только ключ langpack (`PrivacySectionStr` без `HTMLElement`,
 *     `:31`, `:350-351`): узла-подписи у вкладок нет (подпись номера со ссылкой
 *     `PrivacyPhoneInfo4` — О-36, шапка `privacy/phoneNumber.solid.tsx`).
 */
import { createSignal, createUniqueId, For, type JSX, type Setter } from 'solid-js'
import { i18n, _i18n, type LangPackKey } from '@lib/langPack'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import type { IconName } from '@core/tgico-icons'
import type { PrivacyKey, PrivacyRule, PrivacyValue } from '@core/managers/privacyManager'
import { loadPrivacy, usePrivacyStore } from '@stores/privacyStore'
import type { Managers } from '@/client/bootstrap'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import type Scrollable from '@components/scrollable'
import Section, { type SectionParts } from '@components/section.solid'
import { AppAddMembersTab } from '@components/solidJsTabs/tabs'
import type { SliderSuperTabEventable } from '@components/sliderTab'
import type SidebarSlider from '@components/slider'

/** tweb `appManagers/utils/privacy/privacyType.ts` — индекс подписи в `captions`. */
export enum PrivacyType {
  Everybody = 2,
  Contacts = 1,
  Nobody = 0,
}

const TYPE_BY_VALUE: Record<PrivacyValue, PrivacyType> = {
  everybody: PrivacyType.Everybody,
  contacts: PrivacyType.Contacts,
  nobody: PrivacyType.Nobody,
}

const VALUE_BY_TYPE: Record<PrivacyType, PrivacyValue> = {
  [PrivacyType.Everybody]: 'everybody',
  [PrivacyType.Contacts]: 'contacts',
  [PrivacyType.Nobody]: 'nobody',
}

type PrivacyExceptionKey = 'allow' | 'disallow'
type PrivacyException = {
  titleLangKey: LangPackKey
  key: PrivacyExceptionKey
  icon: IconName
  subtitle: () => JSX.Element
  setSubtitle: Setter<JSX.Element>
}

// Расхождение 2: кэш правил — стор, запись — менеджер с зеркалом в стор.
function getPrivacy(managers: Managers, key: PrivacyKey): Promise<PrivacyRule> {
  const store = usePrivacyStore.getState()
  if(store.loaded) {
    return Promise.resolve(store.rules[key])
  }

  return managers.privacy.rule(key).then((rule) => {
    usePrivacyStore.getState().setRule(rule)
    return rule
  })
}

function setPrivacy(managers: Managers, rule: PrivacyRule) {
  return managers.privacy.setRule(rule).then((saved) => {
    usePrivacyStore.getState().setRule(saved)
  }, () => loadPrivacy(managers))
}

export type PrivacySectionStr = LangPackKey | ''
export default class PrivacySection {
  public radioSection: SectionParts
  public exceptionsSection?: SectionParts
  public exceptions?: Map<PrivacyExceptionKey, PrivacyException>
  public peerIds!: {
    disallow?: PeerId[]
    allow?: PeerId[]
  }
  public type!: PrivacyType

  private setSelectedType: Setter<PrivacyType | undefined>

  constructor(public options: {
    tab: SliderSuperTabEventable
    title: LangPackKey
    inputKey: PrivacyKey
    captions: [PrivacySectionStr, PrivacySectionStr, PrivacySectionStr]
    appendTo?: Scrollable
    noExceptions?: boolean
    onRadioChange?: (value: number) => void
    skipTypes?: PrivacyType[]
    exceptionTexts?: [LangPackKey, LangPackKey]
    managers: Managers
  }) {
    options.captions.reverse()

    const rulesPromise = getPrivacy(options.managers, options.inputKey)

    let radioOptions: Array<{ type: PrivacyType, langKey: LangPackKey }> = [{
      type: PrivacyType.Everybody,
      langKey: 'PrivacySettingsController.Everbody',
    }, {
      type: PrivacyType.Contacts,
      langKey: 'PrivacySettingsController.MyContacts',
    }, {
      type: PrivacyType.Nobody,
      langKey: 'PrivacySettingsController.Nobody',
    }]

    if(options.skipTypes) {
      radioOptions = radioOptions.filter((option) => !options.skipTypes!.includes(option.type))
    }

    const [selectedType, setSelectedType] = createSignal<PrivacyType>()
    this.setSelectedType = setSelectedType

    let radioContent!: HTMLElement, radioCaption!: HTMLElement
    const radioContainer = wrapSolidComponent(() => {
      const name = createUniqueId()
      return (
        <Section
          name={options.title}
          // an empty caption element `replaceCaption` fills in as the type changes
          caption={true}
          contentProps={{ ref: (element) => radioContent = element }}
          captionRef={(element) => radioCaption = element}
        >
          <form>
            <For each={radioOptions}>{({ type, langKey }) => (
              <Row>
                <Row.RadioField>
                  <RadioFieldTsx
                    checked={selectedType() === type}
                    class="disable-hover"
                    name={name}
                    value={String(type)}
                    onChange={(checked) => checked && this.onRadioChange(type)}
                  />
                </Row.RadioField>
                <Row.Title>{i18n(langKey)}</Row.Title>
              </Row>
            )}</For>
          </form>
        </Section>
      )
    }, options.tab.middlewareHelper.get())

    this.radioSection = { container: radioContainer, content: radioContent, caption: radioCaption }

    if(options.appendTo) {
      options.appendTo.append(radioContainer)
    }

    if(!options.noExceptions) {
      const createException = (
        key: PrivacyExceptionKey,
        titleLangKey: LangPackKey,
        icon: IconName,
      ): PrivacyException => {
        const [subtitle, setSubtitle] = createSignal<JSX.Element>(i18n('PrivacySettingsController.AddUsers'))
        return { titleLangKey, key, icon, subtitle, setSubtitle }
      }

      const exceptions = this.exceptions = new Map([[
        'disallow',
        createException('disallow', options.exceptionTexts![0], 'person_crossed_filled'),
      ], [
        'allow',
        createException('allow', options.exceptionTexts![1], 'adduser'),
      ]])

      let exceptionsContent!: HTMLElement
      const exceptionsContainer = wrapSolidComponent(() => (
        <Section
          name="PrivacyExceptions"
          caption="PrivacySettingsController.PeerInfo"
          contentProps={{ ref: (element) => exceptionsContent = element }}
        >
          <For each={[...exceptions.values()]}>{(exception) => (
            <Row
              classList={{
                hide: exception.key === 'allow' ?
                  selectedType() === PrivacyType.Everybody :
                  selectedType() === PrivacyType.Nobody,
              }}
              clickable={() => {
                void promise.then(() => {
                  const _peerIds = this.peerIds[exception.key]!
                  void (options.tab.slider as unknown as SidebarSlider).createTab(AppAddMembersTab).open({
                    type: 'privacy',
                    skippable: true,
                    title: exception.titleLangKey,
                    placeholder: 'PrivacyModal.Search.Placeholder',
                    // расхождение 3 (О-17)
                    filterPeerTypeBy: ['isUser'],
                    takeOut: (newPeerIds) => {
                      _peerIds.length = 0
                      _peerIds.push(...newPeerIds)
                      exception.setSubtitle(this.generateStr(newPeerIds))
                      this.onRadioChange(this.type)
                    },
                    selectedPeerIds: _peerIds,
                  })
                })
              }}
            >
              <Row.Icon icon={exception.icon} />
              <Row.Title>{i18n(exception.titleLangKey)}</Row.Title>
              <Row.Subtitle>{exception.subtitle()}</Row.Subtitle>
            </Row>
          )}</For>
        </Section>
      ), options.tab.middlewareHelper.get())

      this.exceptionsSection = { container: exceptionsContainer, content: exceptionsContent }

      if(options.appendTo) {
        options.appendTo.append(exceptionsContainer)
      }
    }

    const promise = rulesPromise.then((rule) => {
      if(this.exceptions) {
        this.peerIds = {}
        ;(['allow', 'disallow'] as const).forEach((k) => {
          const from = k === 'allow' ? rule.allowUserIds : rule.denyUserIds
          this.peerIds[k] = [...from]
          this.exceptions!.get(k)!.setSubtitle(this.generateStr(from))
        })
      }

      this.setRadio(TYPE_BY_VALUE[rule.value])

      options.tab.eventListener.addEventListener('destroy', this.onTabDestroy, { once: true })
    })
  }

  public onTabDestroy = () => {
    const rule: PrivacyRule = {
      key: this.options.inputKey,
      value: VALUE_BY_TYPE[this.type],
      allowUserIds: [],
      denyUserIds: [],
    }

    if(this.exceptions) {
      for(const k of ['allow', 'disallow'] as const) {
        if(
          (k === 'allow' && this.type === PrivacyType.Everybody) ||
          (k === 'disallow' && this.type === PrivacyType.Nobody)
        ) {
          continue
        }

        const _peerIds = this.peerIds[k]
        if(!_peerIds) {
          continue
        }

        rule[k === 'allow' ? 'allowUserIds' : 'denyUserIds'] = [..._peerIds]
      }
    }

    return setPrivacy(this.options.managers, rule)
  }

  private replaceCaption(caption: PrivacySectionStr = this.options.captions[this.type]) {
    const captionElement = this.radioSection.caption!
    if(!caption) {
      captionElement.replaceChildren()
    } else {
      _i18n(captionElement, caption)
    }
    captionElement.classList.toggle('hide', !caption)
  }

  private onRadioChange = (value: string | PrivacySection['type']) => {
    value = +value as PrivacySection['type']
    this.type = value
    this.setSelectedType(value)

    this.replaceCaption()

    this.options.onRadioChange?.(value)
  }

  public setRadio(type: PrivacySection['type']) {
    this.onRadioChange(type)
  }

  // расхождения 3, 4: только пользователи
  private generateStr(userIds: PeerId[]) {
    if(!userIds.length) {
      return [i18n('PrivacySettingsController.AddUsers')]
    }

    return [i18n('Users', [userIds.length])]
  }
}
