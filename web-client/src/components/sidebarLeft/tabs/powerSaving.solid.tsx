/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/powerSaving.tsx:1-122 (812502980) —
 * вкладка «Энергосбережение» (`AppPowerSavingTab`, `solidJsTabs/tabs.ts`), задача
 * 11 плана волны 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 *
 * Две секции в `<form>`: мастер `all` («Режим энергосбережения», подпись
 * `LiteMode.Info` под карточкой) и дерево ключей `:28-37` — группы с аккордеоном
 * и счётчиком (`components/checkboxFields.solid.tsx`). Смысл тумблеров — как у
 * оригинала: мастер = `liteMode.all`, остальные = «анимация включена»
 * (`!liteMode[key]`). При `all` строки выключены (`is-disabled`, поля
 * `is-fake-disabled`, счётчики 0/M), щелчок по секции — тост
 * `LiteMode.DisableAlert`. Сохранение — на каждое `change` формы, `all` пишется
 * через 200 мс (дать строкам погаснуть до того, как выключатся анимации).
 *
 * Побочки настройки (классы уровня анимаций, `no-backdrop`, автоплей стикеров) —
 * не здесь, а у подписчика самой настройки `client/liteModeSettings.ts`.
 *
 * Расхождения с оригиналом:
 *  1. Запись — `{...appSettings.liteMode, ...liteMode}`, а не голый `liteMode`
 *     (`:108`): `setAppSettings` оригинала пишет в Solid-стор, который СЛИВАЕТ
 *     объект с прежним, и ключи эмодзи-группы (её на экране нет, `:33`)
 *     переживают запись. Наш мост кладёт лист в zustand целиком (О-2) — слияние
 *     сделано явно, чтобы результат совпал.
 *  2. `appSettings.liteMode` — мост `useAppSettings` над zustand (О-2).
 */
import { onMount } from 'solid-js'
import flatten from '@helpers/array/flatten'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import type { LiteModeKey } from '@helpers/liteMode'
import pause from '@helpers/schedulers/pause'
import type { LangPackKey } from '@lib/langPack'
import CheckboxFields, { type CheckboxFieldsField } from '@components/checkboxFields.solid'
import Section from '@components/section.solid'
import { toastNew } from '@components/toast'
import { useAppSettings } from '@stores/appSettings.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppPowerSavingTab } from '@components/solidJsTabs/tabs'
import type { Settings } from '@/settings'

type PowerSavingCheckboxFieldsField = CheckboxFieldsField & {
  key: LiteModeKey
}

const PowerSaving = () => {
  const [tab] = useSuperTab<typeof AppPowerSavingTab>()
  const [appSettings, setAppSettings] = useAppSettings()

  let formEl!: HTMLFormElement
  let infoContentEl!: HTMLDivElement
  let sectionContentEl!: HTMLDivElement

  onMount(() => {
    tab.container.classList.add('power-saving-container')

    const keys: Array<LiteModeKey | [LiteModeKey, LiteModeKey[]]> = [
      'all',
      'video',
      'gif',
      ['stickers', ['stickers_panel', 'stickers_chat', 'emoji_appear']],
      // ['emoji', ['emoji_panel', 'emoji_messages']],
      ['effects', ['effects_reactions', 'effects_premiumstickers', 'effects_emoji']],
      ['chat', ['chat_background', 'chat_spoilers']],
      'animations',
      'blur',
    ]

    const wrap = (key: typeof keys[0]): PowerSavingCheckboxFieldsField[] => {
      const isArray = Array.isArray(key)
      const mainKey = isArray ? key[0] : key
      const nested = isArray ? flatten(key[1].map(wrap)) : undefined
      const value = appSettings.liteMode[mainKey]
      return [{
        key: mainKey,
        // у tweb `strict` выключен; ключ из шаблона — `LangPackKey` по построению
        text: mainKey === 'all' ? 'LiteMode.EnableText' : `LiteMode.Key.${mainKey}.Title` as LangPackKey,
        checked: mainKey === 'all' ? value : !value,
        nested: nested,
        name: 'power-saving-' + mainKey,
      }, ...(nested || [])]
    }

    const fields = flatten(keys.map(wrap))

    const checkboxFields = new CheckboxFields({
      fields: fields,
      listenerSetter: tab.listenerSetter,
    })

    fields.forEach((field, idx) => {
      const created = checkboxFields.createField(field)
      if(!created) {
        return
      }

      const { nodes } = created;
      (idx === 0 ? infoContentEl : sectionContentEl).append(...nodes)
    })

    attachClickEvent(sectionContentEl, () => {
      if(appSettings.liteMode.all) {
        toastNew({ langPackKey: 'LiteMode.DisableAlert' })
      }
    }, { listenerSetter: tab.listenerSetter })

    const onAllChange = (disable: boolean) => {
      fields.forEach((field) => {
        if(field.key === 'all') {
          return
        }

        if(field.nested) {
          checkboxFields.setNestedCounter(field, disable ? 0 : undefined)
        }

        field.checkboxField!.input.classList.toggle('is-fake-disabled', disable)
        field.row!.toggleDisability(disable)
      })
    }

    tab.listenerSetter.add(formEl)('change', async() => {
      const liteMode = {} as Settings['liteMode']
      fields.forEach((field) => {
        const checked = field.checkboxField!.checked
        liteMode[field.key] = field.key === 'all' ? checked : !checked
      })

      const wasAll = appSettings.liteMode.all
      if(wasAll !== liteMode.all) {
        onAllChange(!wasAll)

        if(liteMode.all) {
          await pause(200)
        }
      }

      // расхождение 1 — слияние, как у Solid-стора оригинала
      void setAppSettings('liteMode', { ...appSettings.liteMode, ...liteMode })
    })

    onAllChange(appSettings.liteMode.all)
  })

  return (
    <form ref={(el) => formEl = el}>
      <Section caption="LiteMode.Info" contentProps={{ ref: (el: HTMLDivElement) => infoContentEl = el }} />
      <Section contentProps={{ ref: (el: HTMLDivElement) => sectionContentEl = el }} />
    </form>
  )
}

export default PowerSaving
