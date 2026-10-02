/** @jsxImportSource solid-js */
/**
 * порт tweb/src/components/sidebarRight/tabs/editChatInviteLink.tsx:1-381 (812502980) —
 * вкладка «Новая ссылка» / «Изменить ссылку» правой колонки: имя ссылки,
 * (у канала) одобрение админом, срок ступенчатым селектором со строкой даты,
 * лимит вступивших ступенчатым селектором с числовым полем. Сеть — ТОЛЬКО по
 * угловой галке (`exportChatInvite` / `editExportedChatInvite`, `:71-104`), затем
 * событие `finish` с готовой ссылкой и закрытие. Регистрация —
 * `AppEditChatInviteLinkTab` в `solidJsTabs/tabs.ts` (tweb `:670-682`).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. (О-123) Платные ссылки-подписки — нет на бэкенде: секции «Подписка»
 *     (`InviteLink.Subscription.*`, `InputStarsField`, `appConfig.stars_*`,
 *     `:113-150`, `:343-356`) и `stars` в `exportChatInvite` (`:98`) не
 *     портированы. Ветка `onPaidLinkChange(false)` (`:139-140`) — как у
 *     оригинала: подпись секции одобрения — `InviteLink.AdminApproval.Disabled`
 *     для неплатной ссылки.
 *  2. `isBroadcast` (`:110`) — синхронно из зеркала пиров (`isBroadcastPeer`), как
 *     во вкладке типа чата (`chatType.solid.tsx`, расхождение 3).
 *  3. Календарь срока (`showDatePickerPopup`, `:216-221`) — мост
 *     `popups/datePicker.bridge.ts` (React `DatePickerPopup`, ВРЕМЕННО до 2C-23).
 *  4. `ButtonCorner` без `ariaLabel: 'Save'` (`:68`) — шапка `components/buttonCorner.ts`.
 *  5. Срок и лимит сервер принимает относительным сроком и `null` вместо `0`
 *     (`expire_seconds`, `usage_limit`) — перевод в менеджере
 *     (`groupsManager.exportChatInvite`/`editExportedChatInvite`), вкладка шлёт
 *     поля оригинала.
 */
import { createSignal, onMount, Show, type Component, type JSX } from 'solid-js'
import { formatFullSentTime } from '@helpers/date'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import { placeCaretAtEnd } from '@shared/lib/caret'
import formatDuration from '@helpers/formatDuration'
import clamp from '@helpers/number/clamp'
import tsNow from '@helpers/tsNow'
import { i18n } from '@lib/langPack'
import ButtonCorner from '@components/buttonCorner'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import type InputField from '@components/inputField'
import { InputFieldTsx } from '@components/inputFieldTsx.solid'
import { InputRightNumber } from '@components/popups/payment'
import showDatePickerPopup from '@components/popups/datePicker.bridge' // ВРЕМЕННО до 2C-23
import { setButtonLoader } from '@components/putPreloader'
import RangeStepsSelector from '@components/rangeStepsSelector'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import { wrapFormattedDuration } from '@components/wrappers/wrapDuration'
import type { ChatInvite } from './chatInviteLinkShared'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppEditChatInviteLinkTab } from '@components/solidJsTabs/tabs'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { isBroadcastPeer } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'

export function findClosestDifference(array: Array<number>, difference: number) {
  const differences = array.map((value, idx) => {
    return { idx, diff: Math.abs(value - difference) }
  })

  return differences.sort((a, b) => a.diff - b.diff)[0]
}

const EditChatInviteLink: Component = () => {
  const [tab] = useSuperTab<typeof AppEditChatInviteLinkTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!
  const { chatId, invite } = tab.payload

  let nameInputField!: InputField
  let timePeriodSelector!: RangeStepsSelector<number | Date | undefined>
  let usersLimitSelector!: RangeStepsSelector<number | undefined>

  let timePeriodContent!: HTMLDivElement
  let usersLimitContent!: HTMLDivElement
  const [isBroadcast, setIsBroadcast] = createSignal(false)
  const [approveNewMembers, setApproveNewMembers] = createSignal(false)
  const [approveDisabled, setApproveDisabled] = createSignal(false)
  const [approveCaption, setApproveCaption] = createSignal<HTMLElement>()
  const [usersLimitHidden, setUsersLimitHidden] = createSignal(false)

  // расхождение 1: без поля цены (`paidWrapper`, `:60`)
  const onPaidLinkChange = (checked: boolean) => {
    setApproveDisabled(checked)
    setApproveCaption(i18n(checked ? 'ApproveNewMembersDescription' : 'InviteLink.AdminApproval.Disabled'))
  }

  const onApproveNewMembersChange = (checked: boolean) => {
    setUsersLimitHidden(checked)
  }

  const build = async() => {
    const confirmBtn = ButtonCorner({ className: 'is-visible', icon: 'check' })
    tab.content.append(confirmBtn)

    attachClickEvent(confirmBtn, async() => {
      setButtonLoader(confirmBtn)
      const expireDateValue = timePeriodSelector.value
      const expireDate = expireDateValue instanceof Date ? expireDateValue.getTime() / 1000 | 0 : (expireDateValue ? tsNow(true) + expireDateValue : 0)
      const title = nameInputField.value
      const requestNeeded = approveNewMembers()
      const usageLimit = requestNeeded ? 0 : (usersLimitSelector.value ?? 0)

      let chatInvite: ChatInvite
      if(invite) {
        const result = await managers.groups.editExportedChatInvite({
          chatId,
          link: invite.link,
          expireDate,
          requestNeeded,
          title,
          usageLimit,
        })

        chatInvite = result.invite
      } else {
        chatInvite = await managers.groups.exportChatInvite({
          chatId,
          title,
          requestNeeded,
          usageLimit,
          expireDate,
        })
      }

      tab.eventListener.dispatchEvent('finish', chatInvite)
      void tab.close()
    }, { listenerSetter: tab.listenerSetter })

    if(invite?.title) {
      nameInputField.setOriginalValue(invite.title)
    }

    // расхождение 2
    const isBroadcastChat = isBroadcastPeer(toPeerId(chatId as number, true))

    if(isBroadcastChat) {
      setIsBroadcast(true)

      // расхождение 1: платной ссылки не бывает
      onPaidLinkChange(false)
    }

    {
      const range: typeof timePeriodSelector = timePeriodSelector = new RangeStepsSelector({
        generateStep: (value) => {
          const formatted = formatDuration(value instanceof Date ? (value.getTime() / 1000 | 0) - tsNow(true) : value!, 1)
          return [wrapFormattedDuration(formatted), value]
        },
        generateSteps: (values) => {
          return [
            ...values.map(range.generateStep),
            ['∞', undefined],
          ]
        },
        onValue: (value) => {
          if(!value) {
            setExpiry()
          } else {
            let date: Date
            if(value instanceof Date) {
              date = value
            } else {
              date = new Date()
              date.setSeconds(date.getSeconds() + value)
            }

            setExpiry(date.getTime() / 1000)
          }
        },
        middleware: tab.middlewareHelper.get(),
      })

      const [expiryTitle, setExpiryTitle] = createSignal<JSX.Element>(i18n('EditInvitation.Never'))

      const setCustomTimestamp = (timestamp: number) => {
        const difference = timestamp - tsNow(true)
        const closest = findClosestDifference(stepValues, difference)
        const newSteps = steps.slice()
        newSteps[closest.idx] = range.generateStep(new Date(timestamp * 1000))
        range.setSteps(newSteps, closest.idx)
      }

      const setExpiry = (timestamp?: number) => {
        setExpiryTitle(!timestamp ? i18n('EditInvitation.Never') : formatFullSentTime(timestamp))
      }

      const stepValues: number[] = [3600, 86400, 86400 * 7]
      const steps = range.generateSteps(stepValues)
      range.setSteps(steps, steps.length - 1)

      if(invite && invite.expire_date && invite.expire_date > tsNow(true)) {
        setCustomTimestamp(invite.expire_date)
      }

      const row = wrapSolidComponent(
        () => (
          <Row clickable={() => {
            let initDate: Date
            const value = range.value
            if(value) {
              initDate = new Date(value instanceof Date ? value : tsNow() + value * 1000)
            } else {
              initDate = new Date()
              initDate.setDate(initDate.getDate() + 7)
            }

            // расхождение 3
            showDatePickerPopup({
              initDate,
              withTime: true,
              onPick: setCustomTimestamp,
              btnConfirmLangKey: 'Save',
            })
          }}>
            <Row.Title titleRight={expiryTitle()} titleRightSecondary>
              {i18n('EditInvitation.ExpiryDate')}
            </Row.Title>
          </Row>
        ),
        tab.middlewareHelper.get(),
      )
      timePeriodContent.append(range.container, row)
    }

    {
      const range: typeof usersLimitSelector = usersLimitSelector = new RangeStepsSelector({
        generateStep: (value) => ['' + value, value],
        generateSteps: (values) => {
          return [
            ...values.map(range.generateStep),
            ['∞', undefined],
          ]
        },
        onValue: (value) => {
          setNumber(value)
        },
        middleware: tab.middlewareHelper.get(),
      })

      const inputRightNumber = new InputRightNumber()
      const { input } = inputRightNumber
      const [numberTitle, setNumberTitle] = createSignal<JSX.Element>(i18n('EditInvitation.Unlimited'))

      const onInput = () => {
        let originalValue = inputRightNumber.value
        const isEmpty = !originalValue.trim()
        originalValue = originalValue.replace(/\D/g, '')

        const value = clamp(isEmpty ? 0 : +originalValue, stepValues[0], 9999)
        if(!isEmpty) inputRightNumber.value = '' + value
        ignoreNextSet = true
        setCustomNumber(value)
      }

      tab.listenerSetter.add(input)('input', onInput)

      const setCustomNumber = (value: number) => {
        const closest = findClosestDifference(stepValues, value)
        const newSteps = steps.slice()
        newSteps[closest.idx] = range.generateStep(value)
        range.setSteps(newSteps, closest.idx)
      }

      let ignoreNextSet = false
      const setNumber = (value?: number) => {
        if(ignoreNextSet) {
          ignoreNextSet = false
          return
        }

        if(!value) {
          setNumberTitle(i18n('EditInvitation.Unlimited'))
        } else {
          inputRightNumber.value = '' + value
          setNumberTitle(input)
        }
      }

      const stepValues = [1, 10, 50, 100]
      const steps = range.generateSteps(stepValues)
      range.setSteps(steps, steps.length - 1)

      if(invite?.usage_limit) {
        const value = Math.max(stepValues[0], invite.usage_limit - (invite.usage || 0))
        setNumber(value)
        setCustomNumber(value)
      }

      const row = wrapSolidComponent(
        () => (
          <Row clickable noRipple>
            <Row.Title titleRight={numberTitle()} titleRightSecondary>
              {i18n('EditInvitation.NumberOfUsers')}
            </Row.Title>
          </Row>
        ),
        tab.middlewareHelper.get(),
      )
      usersLimitContent.append(range.container, row)

      tab.listenerSetter.add(row)('mousedown', (e: MouseEvent) => {
        if(!range.value) {
          setCustomNumber(stepValues[0])
        }

        if(!findUpAsChild(e.target as HTMLElement, input)) {
          placeCaretAtEnd(input)
        }
      })
    }

    if(isBroadcastChat && invite) {
      const value = !!invite.pFlags?.request_needed
      setApproveNewMembers(value)
      setUsersLimitHidden(value)
    }
  }

  onMount(() => {
    promiseCollector.collect(build())
  })

  return (
    <>
      <Section caption="LinkNameHelp">
        <div class="input-wrapper">
          <InputFieldTsx
            label="LinkNameHint"
            maxLength={32}
            instanceRef={(ref) => nameInputField = ref}
          />
        </div>
      </Section>
      <Show when={isBroadcast()}>
        {/* :343-356 — подписка (расхождение 1) */}
        <Section caption={approveCaption()}>
          <Row>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                signal={[approveNewMembers, setApproveNewMembers]}
                toggle
                disabled={approveDisabled()}
                onChange={onApproveNewMembersChange}
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('ApproveNewMembers')}</Row.Title>
          </Row>
        </Section>
      </Show>
      <Section name="LimitByPeriod" caption="TimeLimitHelp">
        <div ref={(element) => timePeriodContent = element} />
      </Section>
      <Section name="LimitNumberOfUses" caption="UsesLimitHelp" classList={{ hide: usersLimitHidden() }}>
        <div ref={(element) => usersLimitContent = element} />
      </Section>
    </>
  )
}

export default EditChatInviteLink
