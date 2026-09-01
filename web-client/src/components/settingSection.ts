/**
 * Порт tweb `src/components/settingSection.ts` — секция настроек (карточка
 * с тенью в левом сайдбаре: опциональный заголовок + блоки контента +
 * опциональная подпись), из строк (`Row`) которой собираются вкладки
 * настроек.
 *
 * ── Раунд 1 ревью: структура вернулась к двум узлам ──────────────────────
 * Первая версия сливала `container`/`innerContainer` в один узел, потому что
 * иллюстративный тест из брифа проверял класс `sidebar-left-section` прямо
 * на публичном `container`. Ведущий признал это ошибкой брифа: «порт
 * дословный» — сильнее иллюстративного кода теста. Оригинал — два вложенных
 * div'а: внешний `container` (`sidebar-left-section-container`, только
 * `padding-inline` — tweb `scss/partials/_section.scss:78`, наш порт —
 * `styles/tweb/_section.scss:78-79`) и внутренний `innerContainer`
 * (`sidebar-left-section`: фон/тень/скругление, туда льётся контент,
 * `_section.scss` целиком). Оба узла и `title` восстановлены как публичные
 * поля — у них есть живые потребители в tweb:
 *  • `innerContainer` — `components/selectorSearch.ts:52-53`
 *    (`section.innerContainer.classList.add('selector-search-section')`,
 *    рядом же и `section.container.classList.add(...)` — оба узла нужны
 *    одному и тому же вызывающему одновременно, слить их было нельзя);
 *  • `title` — `components/sidebarRight/tabs/userPermissions.tsx:101`
 *    (`section.content.insertBefore(div, section.title)`, вставка перед
 *    заголовком) и `components/popups/sharedFolderInvite.ts:173`
 *    (`this.selector.section.title.append(selectAllI18n.element)` —
 *    "выбрать всех" кладётся ВНУТРЬ строки заголовка, справа от текста).
 *
 * ── `captionOld` восстановлен ─────────────────────────────────────────────
 * По умолчанию (`captionOld` не задан) блок подписи создаётся как обычный
 * контент-блок `innerContainer` (`generateContentElement()`), а затем
 * ЯВНО переносится в ВЕШНИЙ `container` — визуально подпись оказывается
 * НИЖЕ карточки, вне её фона/тени/скругления (сравни `-caption` в
 * `_section.scss:65-76`: `margin: -0.375rem 0 1rem` — отступ рассчитан на
 * позицию снаружи, не поверх `--surface-color` карточки). `captionOld:
 * true` пропускает перенос — подпись остаётся ВНУТРИ карточки, старое
 * поведение. Опция жива в оригинале не только у самого класса
 * (`settingSection.ts:72-79`), но и у Solid-обёртки `components/section.tsx`
 * (`SectionCaption` рендерится либо внутри, либо вне карточки по этому же
 * флагу) — используется у `popups/boostsViaGifts.tsx` (7 мест),
 * `sidebarLeft/tabs/2fa/index.tsx:50`, `2fa/email.tsx:137`,
 * `2fa/emailConfirmation.tsx:147`, `2fa/passwordSet.tsx:29`.
 *
 * ── Опущено (не объявлено в типе) ─────────────────────────────────────────
 *  • `fullWidth`/`noPaddingTop` — в самом tweb закомментированы (мёртвые
 *    ветки, без вызывающих на момент порта) — портировать нечего;
 *  • `generateSection(appendTo: Scrollable, …)` — свободная функция поверх
 *    класса; в продуцируемый интерфейс задачи не входит (там только сам
 *    класс) и в кодовой базе пока не нужна — опущена как невостребованная.
 *
 * ── Сверено со стилями (то, что реально проверено, не больше) ────────────
 *  • `sidebar-left-section`, `no-shadow`, `-content`, `-name`, `-caption`,
 *    `-container`(`padding-inline`) — есть в нашем `styles/tweb/_section.scss`
 *    (уже портирован);
 *  • `no-delimiter` — ИМЕЕТ реальный визуальный эффект: tweb
 *    `scss/partials/popups/_boostsViaGifts.scss:170-176` —
 *    `.sidebar-left-section:not(.no-delimiter) { border-top: 1px solid
 *    var(--border-color) }` в контексте попапа буста. Ошибка в первой версии
 *    этого докблока (round 0) утверждала обратное — не был проверен вызов
 *    класса КОНТЕКСТНЫМИ стилями, только его собственный файл;
 *  • `with-fake-delimiter` — по-прежнему НЕ встречается нигде, кроме места
 *    своего же присвоения (`grep -rn with-fake-delimiter tweb/src` — одно
 *    вхождение, сам `settingSection.ts:41`). Как `row-with-toggle` в
 *    `row.ts` — ветка в оригинале жива, но у класса-маркера нет стиля;
 *    портируется как есть;
 *  • сама ветка `<hr>`/делимитер/ничего решает НЕ «слипается ли список» (это
 *    было неверной мотивировкой в брифе задачи — `hr` в tweb в принципе не
 *    показывается: `scss/base.scss:1388` `hr { display: none !important }`
 *    перекрывает базовый `scss/base.scss:784`; оба правила у нас уже
 *    портированы, `styles/index.scss:26-42`, с явным комментарием там же про
 *    `SettingSection`), а РАССТАВЛЯЕТ КЛАССЫ на `innerContainer`
 *    (`no-delimiter`/`with-fake-delimiter`), которыми пользуются контекстные
 *    стили вроде `_boostsViaGifts.scss` выше;
 *  • `.gradient-delimiter` (сам узел делимитера, не маркер) имеет базовый
 *    стиль в `tweb/src/scss/base.scss:1371`, который в наш `styles/tweb/`
 *    ещё не перенесён (сейчас там только контекстный оверрайд в
 *    `_profile.scss`). Перенос самого стиля — #112.
 *
 * ── Прочие адаптации под наш стек ────────────────────────────────────────
 *  • заголовок и подпись строит `i18n_({element, key, args})` ядра — дословно
 *    как оригинал (:63, :81), вместе с `nameArgs`/`captionArgs`. Обратите
 *    внимание: `i18n_` пишет В ПЕРЕДАННЫЙ узел, то есть класс `i18n` лежит на
 *    самом `.sidebar-left-section-name`, а не на вложенном `span`;
 *  • `generateDelimiter()` (`@components/generateDelimiter` в tweb) —
 *    тривиальный `div.gradient-delimiter` без внешних зависимостей,
 *    инлайнен сюда же вместо отдельного файла — единственный потребитель.
 *
 * ── Остаток волны (#112) ─────────────────────────────────────────────────
 * `web-client/src/shared/ui/SidebarSection/SidebarSection.tsx` — React-двойник
 * этой же карточки (потребители: `SearchView.tsx`, `UserInfoPanel.tsx`,
 * `components/settings/kit.tsx`), рисующий тот же внешний
 * `div.sidebar-left-section-container`. Снимать не нужно — уйдёт вместе с
 * React-экранами, которые его используют, по мере переезда волны на Solid.
 */
import { i18n_, type FormatterArguments, type LangPackKey } from '@lib/langPack'

type CaptionOption = LangPackKey | true

export type SettingSectionOptions = {
  name?: LangPackKey | HTMLElement
  nameArgs?: FormatterArguments
  caption?: CaptionOption
  captionArgs?: FormatterArguments
  captionOld?: CaptionOption
  noDelimiter?: boolean
  fakeGradientDelimiter?: boolean
  noShadow?: boolean
}

const className = 'sidebar-left-section'

const generateDelimiter = () => {
  const delimiter = document.createElement('div')
  delimiter.classList.add('gradient-delimiter')
  return delimiter
}

export default class SettingSection {
  public container: HTMLElement
  public innerContainer: HTMLElement
  public content: HTMLElement
  public title?: HTMLElement
  public caption?: HTMLElement

  constructor(options: SettingSectionOptions = {}) {
    const container = (this.container = document.createElement('div'))
    container.classList.add(className + '-container')

    const innerContainer = (this.innerContainer = document.createElement('div'))
    innerContainer.classList.add(className)

    if (options.noShadow) {
      innerContainer.classList.add('no-shadow')
    }

    if (options.fakeGradientDelimiter) {
      innerContainer.append(generateDelimiter())
      innerContainer.classList.add('with-fake-delimiter')
    } else if (!options.noDelimiter) {
      innerContainer.append(document.createElement('hr'))
    } else {
      innerContainer.classList.add('no-delimiter')
    }

    const content = (this.content = this.generateContentElement())

    if (options.name) {
      const title = (this.title = document.createElement('div'))
      title.classList.add('sidebar-left-h2', className + '-name')
      if (typeof options.name === 'string') {
        i18n_({ element: title, key: options.name, args: options.nameArgs })
      } else {
        title.append(options.name)
      }
      content.append(title)
    }

    container.append(innerContainer)

    const caption = options.caption ?? options.captionOld
    if (caption) {
      const el = (this.caption = this.generateContentElement())
      el.classList.add(className + '-caption')

      if (!options.captionOld) {
        container.append(el)
      }

      if (caption !== true) {
        i18n_({ element: el, key: caption, args: options.captionArgs })
      }
    }
  }

  public generateContentElement(): HTMLElement {
    const content = document.createElement('div')
    content.classList.add(className + '-content')
    this.innerContainer.append(content)
    return content
  }
}
