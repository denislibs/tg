/**
 * Порт tweb `src/components/settingSection.ts` — секция настроек (карточка
 * с тенью в левом сайдбаре: опциональный заголовок + блоки контента +
 * опциональная подпись снизу), из строк (`Row`) которой собираются вкладки
 * настроек.
 *
 * ── Слияние `container`/`innerContainer` в один узел ────────────────────
 * У tweb секция — два вложенных div'а: внешний `container`
 * (`sidebar-left-section-container`, только `padding-inline` —
 * `styles/tweb/_section.scss:75`, наш уже портированный кусок этого файла)
 * и внутренний `innerContainer` (`sidebar-left-section`: фон/тень/скругление,
 * именно в него льётся контент). Задача фиксирует продуцируемый интерфейс
 * как `container`/`content`/`caption`/`generateContentElement()` — без
 * `innerContainer`, и обязательный тест проверяет
 * `container.classList.contains('sidebar-left-section')` — класс, который в
 * оригинале висит на ВНУТРЕННЕМ узле. Поэтому здесь узел один: `container`
 * = бывший `innerContainer`. Внешний `sidebar-left-section-container`
 * (горизontal `padding-inline`) в порт не попал — он держится на
 * существовании отдельного внешнего узла, которого в этой версии нет; если
 * понадобится именно эта горизонтальная поправка, обёртку придётся
 * добавить сверху, там, где секции реально вставляются в DOM.
 *
 * ── Опущено (не объявлено в типе — см. п.1 разрешения неоднозначностей
 *    задачи) ──────────────────────────────────────────────────────────────
 *  • `captionOld` — в оригинале переключает, попадает ли контент-блок
 *    подписи в общий (внешний) `container` или остаётся в `innerContainer`
 *    рядом с остальным контентом. У нас это один и тот же узел — разница,
 *    которую переключает флаг, физически исчезла; объявлять опцию, которая
 *    ничего не меняет, — обманывать интерфейс, а не портировать его;
 *  • `fullWidth`/`noPaddingTop` — в самом tweb закомментированы (мёртвые
 *    ветки, не используются ни одним вызывающим на момент порта) —
 *    портировать нечего;
 *  • `generateSection(appendTo: Scrollable, ...)` — свободная функция поверх
 *    класса; в продуцируемый интерфейс задачи не входит (там только сам
 *    класс) и в кодовой базе пока не нужна — опущена как невостребованная.
 *
 * ── Сверено со стилями (то, что реально проверено, не больше) ───────────
 *  • `sidebar-left-section`, `no-shadow`, `-content`, `-name`, `-caption` —
 *    есть в нашем `styles/tweb/_section.scss` (уже портирован);
 *  • `with-fake-delimiter` и `no-delimiter` — НЕ встречаются нигде в
 *    `tweb/src/scss` (проверено grep'ом по всему дереву). Как и
 *    `row-with-toggle` в `row.ts`, это не наш недочёт: ветка в оригинале
 *    жива (решает, что вставляется — `<hr>`, градиент-делимитер или ничего),
 *    просто у самих классов-маркеров нет визуального эффекта — портируется
 *    как есть;
 *  • `.gradient-delimiter` (сам делимитер, не маркер) имеет базовый стиль в
 *    `tweb/src/scss/base.scss:1371`, который в наш `styles/tweb/` ещё не
 *    перенесён (там сейчас только контекстный оверрайд в `_profile.scss`).
 *    Перенос самого стиля — не в этой задаче, задача про структуру класса.
 *
 * ── Прочие адаптации под наш стек ───────────────────────────────────────
 *  • `LangPackKey` + `i18n_`/`true` → строка-ключ через
 *    `useI18nStore.getState().t`, узел — `i18nSpan` (тот же приём, что в
 *    `row.ts`/`button.ts`); `nameArgs`/`captionArgs` не портированы — у
 *    нашего `t()` нет интерполяции (та же причина, что и там же);
 *  • `generateDelimiter()` (`@components/generateDelimiter` в tweb) —
 *    тривиальный `div.gradient-delimiter` без внешних зависимостей,
 *    инлайнен сюда же вместо отдельного файла — единственный потребитель.
 */
import i18nSpan from '@helpers/dom/i18nSpan'
import { useI18nStore } from '../i18n'

export type SettingSectionOptions = {
  name?: string | HTMLElement
  caption?: string | true
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
  public content: HTMLElement
  public caption?: HTMLElement

  constructor(options: SettingSectionOptions = {}) {
    const container = (this.container = document.createElement('div'))
    container.classList.add(className)

    if (options.noShadow) {
      container.classList.add('no-shadow')
    }

    if (options.fakeGradientDelimiter) {
      container.append(generateDelimiter())
      container.classList.add('with-fake-delimiter')
    } else if (!options.noDelimiter) {
      container.append(document.createElement('hr'))
    } else {
      container.classList.add('no-delimiter')
    }

    const content = (this.content = this.generateContentElement())

    if (options.name) {
      const title = document.createElement('div')
      title.classList.add('sidebar-left-h2', className + '-name')
      if (typeof options.name === 'string') {
        title.append(i18nSpan(useI18nStore.getState().t(options.name)))
      } else {
        title.append(options.name)
      }
      content.append(title)
    }

    if (options.caption) {
      const el = (this.caption = this.generateContentElement())
      el.classList.add(className + '-caption')
      if (options.caption !== true) {
        el.append(i18nSpan(useI18nStore.getState().t(options.caption)))
      }
    }
  }

  public generateContentElement(): HTMLElement {
    const content = document.createElement('div')
    content.classList.add(className + '-content')
    this.container.append(content)
    return content
  }
}
