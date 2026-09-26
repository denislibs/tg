/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/language.tsx:91-176 (812502980) —
 * вкладка «Язык» (`AppLanguageTab`, `solidJsTabs/tabs.ts`). Задача 8 плана 2D
 * (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`): список —
 * `createSignal` + `For` + `Row.RadioField`/`RadioFieldTsx` HEAD (ef41b29db,
 * `:98-154`) вместо императивных `new Row` + `RadioFormFromRows`.
 *
 * Расхождения с оригиналом:
 *  1. Секции перевода сообщений (`TranslateSection`, `:22-89`) нет — ЗАДАЧА #133,
 *     обоснование сверено заново 2026-09-26 и не устарело. ПРОВОД перевода есть:
 *     ручка `POST /translate` (`backend/.../chat_handler.go::Translate`) и
 *     менеджер `messages.translate` (`core/managers/messages/translationMethods.ts`).
 *     Нет ровно того, чем секция управляет:
 *     • у `messages.translate` НЕТ НИ ОДНОГО ВЫЗЫВАЮЩЕГО в интерфейсе: пункта
 *       «Перевести» в меню сообщения нет (разбор — шапка `components/chat/contextMenu.ts`),
 *       плашки перевода чата нет, `pickLanguage` (tweb `components/chat/translation.ts`,
 *       строка «Do Not Translate», `:73-86`) не портирован;
 *     • нет `usePremium`/`showPremiumPopup`, которыми оригинал гейтит две из трёх
 *       строк секции (`:24`, `:38-41`, `:56-60`): строка, чей единственный исход —
 *       попап, которого нет;
 *     • настройки секции (`showTranslateButton`, `translateTo` в `settings.tsx`)
 *       НЕ ЧИТАЕТ НИКТО.
 *     Три переключателя, ни один из которых ни на что не влияет, — не порт.
 *  2. `rootScope.managers.apiManager.invokeApiCacheable('langpack.getLanguages',
 *     {lang_pack: 'web'})` (`:106-108`) → `tab.managers.langPack.getLanguages()`:
 *     кэш, ради которого у tweb `invokeApiCacheable`, живёт внутри нашего
 *     менеджера (`core/managers/langPackManager.ts`), повторное открытие так же
 *     не ходит в сеть.
 *  3. `langs2` (пакет macOS, `:109-110`) у оригинала — ПУСТОЙ массив «disabled in
 *     legacy tab», то есть мёртвая половина `concat`. Не переносим ни массив, ни
 *     `concat`, ни дедуп `rendered` (`:112-118`), который защищал только от этого
 *     `concat`, ни `webLangCodes` (`:103`, `:113`): второй параметр
 *     `getLangPackAndApply(code, webLangCodes.includes(code))` (`:143`) отвечает
 *     «web-пакет или macOS», а пакет у нас один — `getLangPackAndApply(code)`.
 *  4. Проверка «применённый язык есть в списке» с `console.error('no language
 *     row')` (`:121-124`) снята: отметку даёт сравнение `selectedLanguage() ===
 *     lang_code` в самой строке, и язык не из списка просто не отмечает ни одной
 *     строки — видимый исход тот же. У нас это штатное состояние, а не отладочный
 *     след: локальный английский до первого ответа сети (`lib/langPack.ts` —
 *     `applyServerLangPack(null)` на холодном старте).
 *
 * Порядок выдачи НЕ трогаем: он серверный (`position`, миграция 0129 — сначала
 * предложенные, дальше по алфавиту), у оригинала выдача тоже без сортировки.
 * Сбой применения языка откатывает запрошенный язык в самом `getLangPackAndApply`
 * (tweb 00c1e1a86); отметку строки оригинал при этом не возвращает — у нас так же.
 */
import { createSignal, For, onMount } from 'solid-js'
import type { LangPackLanguage } from '@layer'
import I18n from '@lib/langPack'
import { randomLong } from '@helpers/random'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppLanguageTab } from '@components/solidJsTabs/tabs'

const LanguageListSection = () => {
  const [tab] = useSuperTab<typeof AppLanguageTab>()
  const promiseCollector = usePromiseCollector()
  const [languages, setLanguages] = createSignal<LangPackLanguage[]>([])
  const [selectedLanguage, setSelectedLanguage] = createSignal<string>()
  const radioName = randomLong()

  // tweb :92-96 — список собирается в коллектор вкладки: открытие ЖДЁТ его,
  // иначе секция въезжает пустой и на глазах доливается полусотней строк.
  promiseCollector.collect((async() => {
    setLanguages(await tab.managers!.langPack.getLanguages())

    // Отметка на открытии — по ПРИМЕНЁННОМУ пакету (tweb :120-126), а не по
    // первому в списке: выбор мог не состояться (офлайн), гореть обязан прежний.
    const langPack = await I18n.getCacheLangPackAndApply()
    setSelectedLanguage(langPack.lang_code)
  })())

  return (
    <Section>
      <form>
        <For each={languages()}>{(language) => (
          <Row>
            <Row.RadioField>
              <RadioFieldTsx
                class="disable-hover"
                checked={selectedLanguage() === language.lang_code}
                name={radioName}
                value={language.lang_code}
                onChange={(checked) => {
                  if(!checked) return
                  setSelectedLanguage(language.lang_code)
                  void I18n.getLangPackAndApply(language.lang_code)
                }}
              />
            </Row.RadioField>
            <Row.Title>{language.name}</Row.Title>
            <Row.Subtitle>{language.native_name}</Row.Subtitle>
          </Row>
        )}</For>
      </form>
    </Section>
  )
}

const Language = () => {
  const [tab] = useSuperTab<typeof AppLanguageTab>()

  onMount(() => {
    tab.header.classList.add('with-border')
    tab.container.classList.add('language-container')
  })

  // tweb :168-173 — без `TranslateSection` (расхождение 1).
  return (
    <LanguageListSection />
  )
}

export default Language
