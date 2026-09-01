/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/language.tsx` — вкладка «Язык».
 * Вторая настоящая Solid-вкладка после «Устройств» (#112, пункт 2).
 *
 * ── Из ДВУХ секций оригинала портирована ОДНА, и это не сокращение объёма ──
 * У оригинала вкладка состоит из секции перевода сообщений
 * (`TranslateSection`, :23-89) и списка языков (`LanguageListSection`,
 * :96-146). Первой у нас нет ПРЕДМЕТА, и не одного, а сразу трёх:
 *  • подсистемы перевода сообщений нет вовсе — ни `pickLanguage`
 *    (tweb `components/chat/translation.ts`), ни пункта «Перевести» в меню
 *    сообщения (он и в контекстном меню не портирован — разбор в шапке
 *    `components/chat/contextMenu.ts`), ни ручки перевода на бэкенде;
 *  • нет `usePremium`/`PopupPremium`, которыми оригинал гейтит две из трёх
 *    строк секции (`:41`, `:63-67`): дословный порт дал бы строки, чей
 *    единственный исход — открыть попап, которого нет;
 *  • сами настройки, которые секция редактирует (`showTranslateButton`,
 *    `translateTo` в `settings.tsx`), СЕГОДНЯ НЕ ЧИТАЕТ НИКТО — их писал и
 *    читал только снесённый React-экран `settings/LanguageSettings.tsx`.
 * Перенести секцию «как есть» значило бы нарисовать три переключателя, ни один
 * из которых ни на что не влияет. Секция целиком — ЗАДАЧА #133 (там же
 * решается судьба двух осиротевших ключей настроек).
 *
 * ── Список языков — дословно ───────────────────────────────────────────────
 * Порядок выдачи НЕ трогаем: он серверный (`position`, миграция 0129 — сначала
 * предложенные, дальше по алфавиту), и у оригинала так же — выдача
 * перебирается без сортировки (:117). Отсортируй здесь, и русский уехал бы на
 * четвёртое место.
 *
 * ── Адаптации под наш стек ─────────────────────────────────────────────────
 *  • `apiManager.invokeApiCacheable('langpack.getLanguages', {lang_pack: 'web'})`
 *    (:103-105) → `tab.managers.langPack.getLanguages()`. Кэширование, ради
 *    которого у tweb стоит `invokeApiCacheable`, живёт у нас внутри самого
 *    менеджера (`core/managers/langPackManager.ts:212`), поэтому повторное
 *    открытие вкладки так же не ходит в сеть;
 *  • `langs2` (пакет macOS, :107-108) — у оригинала это ПУСТОЙ массив с
 *    комментарием «disabled in legacy tab», то есть мёртвая половина `concat`.
 *    Не переносим ни массив, ни `concat`, ни `rendered`-дедуп, который только
 *    от этого `concat` и защищал: у одного источника дублей быть не может;
 *  • `I18n.getLangPackAndApply(value, webLangCodes.includes(value))` (:131) →
 *    `getLangPackAndApply(value)`. Второй параметр оригинала отвечает на
 *    вопрос «этот язык из web-пакета или из macOS-пакета»; пакет у нас один,
 *    и вопроса не существует;
 *  • `console.error('no row', …)` (:141) на ненайденной строке заменён на
 *    молчание. У оригинала это отладочный след, а у нас единственный путь
 *    сюда — «применённый язык отсутствует в серверном списке», то есть
 *    штатное состояние локального английского до первого ответа сети
 *    (`lib/langPack.ts` — `applyServerLangPack(null)` на холодном старте).
 */
import { onMount } from 'solid-js'
import type { Component } from 'solid-js'
import I18n from '@lib/langPack'
import { randomLong } from '@helpers/random'
import Row, { RadioFormFromRows } from '@components/row'
import RadioField from '@components/radioField'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppLanguageTab } from '@components/solidJsTabs/tabs'

const LanguageListSection = () => {
  const [tab] = useSuperTab<typeof AppLanguageTab>()
  const promiseCollector = usePromiseCollector()
  let containerEl!: HTMLDivElement

  // Список собирается в коллектор вкладки (tweb :98, :102): открытие ЖДЁТ
  // его, иначе секция въезжает пустой и на глазах доливается полусотней
  // строк. При повторном открытии менеджер отвечает из кэша, то есть ждать
  // будет нечего.
  promiseCollector.collect((async() => {
    const languages = await tab.managers!.langPack.getLanguages()

    const radioRows = new Map<string, Row>()
    const random = randomLong()

    languages.forEach((language) => {
      const row = new Row({
        radioField: new RadioField({
          text: language.name,
          name: random,
          value: language.lang_code,
        }),
        subtitle: language.native_name,
      })

      radioRows.set(language.lang_code, row)
    })

    const form = RadioFormFromRows([...radioRows.values()], (value) => {
      I18n.getLangPackAndApply(value)
    })

    containerEl.replaceChildren(form)

    // Отметка ставится по ПРИМЕНЁННОМУ пакету, а не по тому, куда кликнули:
    // выбор мог не состояться (офлайн), и тогда гореть обязан прежний язык.
    const langPack = await I18n.getCacheLangPackAndApply()
    radioRows.get(langPack.lang_code)?.radioField.setValueSilently(true)
  })())

  return (
    <Section>
      <div ref={containerEl} />
    </Section>
  )
}

const Language: Component = () => {
  const [tab] = useSuperTab<typeof AppLanguageTab>()

  onMount(() => {
    tab.header.classList.add('with-border')
    tab.container.classList.add('language-container')
  })

  return (
    <LanguageListSection />
  )
}

export default Language
