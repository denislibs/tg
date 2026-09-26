/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/section.tsx:1-148` (812502980) — секция настроек в
 * Solid-разметке.
 *
 *   div.sidebar-left-section-container[.no-margin-bottom]                 (:84-89)
 *     [div.sidebar-left-section-content.sidebar-left-section-caption]      ← captionTop (:90)
 *     div.sidebar-left-section[.no-shadow][.no-delimiter]                  (:91-99, нет при noContent)
 *       [div.gradient-delimiter]                                           ← fakeGradientDelimiter (:100)
 *       div.sidebar-left-section-content                                   (:101-108)
 *         [div.sidebar-left-h2.sidebar-left-section-name > … + div.sidebar-left-section-name-right]
 *         …дети…
 *       [div.sidebar-left-section-content.sidebar-left-section-caption]    ← captionOld (:109)
 *     [div.sidebar-left-section-content.sidebar-left-section-caption]      ← по умолчанию (:112)
 *
 * `captionOld` — не «старый вариант», а МЕСТО подписи: внутри карточки
 * (последним контент-блоком). По умолчанию подпись — сосед карточки внутри
 * контейнера, `captionTop` — над карточкой. Отступ до следующей секции —
 * `padding-bottom` контейнера (`styles/tweb/_section.scss`, tweb
 * `_section.scss:82-91`), поэтому `noMarginBottom` ставит класс на контейнер.
 *
 * Та же разметка у императивного `settingSection.ts` (порт удалённого в tweb
 * 2556fc949 файла) и у React-двойника `shared/ui/SidebarSection` — стили общие.
 *
 * Расхождения с оригиналом:
 *  1. `caption` типизирован как `LangPackKey | Exclude<JSX.Element, string>`
 *     (у tweb `LangPackKey | JSX.Element`): строка подписи — всегда ключ
 *     langpack (`typeof === 'string'` → `i18n`), готовый текст не пролезет
 *     мимо ключа. Разметка та же.
 *  2. Сообщение `appendSectionContent` не называет `unwrapSolidElement` —
 *     хелпера tweb (a27e97144) у нас нет; комментарий к проверке переведён.
 *  3. Импорты по нашим алиасам (`@lib/langPack`, `@helpers/string/classNames`),
 *     точка с запятой и кавычки — по стилю репо.
 */
import { splitProps, type JSX, type ParentComponent, type Ref } from 'solid-js'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import classNames from '@helpers/string/classNames'
import { generateDelimiter } from '@components/generateDelimiter'

export type SectionOptions = {
  name?: LangPackKey | HTMLElement | DocumentFragment | JSX.Element
  nameArgs?: FormatterArguments
  nameRight?: JSX.Element
  nameRef?: Ref<HTMLDivElement>
  caption?: LangPackKey | Exclude<JSX.Element, string>
  captionArgs?: FormatterArguments
  captionOld?: boolean
  captionTop?: boolean
  captionRef?: Ref<HTMLDivElement>
  noDelimiter?: boolean
  /** A gradient band above the section instead of the hairline — what separates it from a list above it. */
  fakeGradientDelimiter?: boolean
  noShadow?: boolean
  noMarginBottom?: boolean
  noContent?: boolean
  class?: JSX.HTMLAttributes<HTMLDivElement>['class']
  innerClass?: string
  contentProps?: JSX.HTMLAttributes<HTMLDivElement>
  ref?: Ref<HTMLDivElement>
}

const className = 'sidebar-left-section'

/**
 * The pieces of a rendered `<Section>` that imperative code still reaches for. Collect them with
 * `ref` / `contentProps.ref` / `nameRef` / `captionRef` and hand this around instead of an element.
 */
export type SectionParts = {
  container: HTMLElement
  content: HTMLElement
  title?: HTMLElement
  caption?: HTMLElement
}
type SectionProps = SectionOptions & Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  keyof SectionOptions
>
const SectionContent: ParentComponent<JSX.HTMLAttributes<HTMLDivElement>> = (props) => {
  const [local, rest] = splitProps(props, ['ref', 'class', 'children'])
  return (
    <div
      {...rest}
      ref={local.ref}
      class={classNames(className + '-content', local.class)}
    >
      {local.children}
    </div>
  )
}
/**
 * The title of a section - and, on its own, of a stretch of a list that is divided by them (the
 * letters of the contacts sorted by name)
 */
export const SectionName: ParentComponent<{
  ref?: Ref<HTMLDivElement>
  class?: string
  /** what goes at the far end of the title */
  right?: JSX.Element
}> = (props) => {
  return (
    <div ref={props.ref} class={classNames('sidebar-left-h2', className + '-name', props.class)}>
      {props.children}
      {props.right && <div class={className + '-name-right'}>{props.right}</div>}
    </div>
  )
}
const SectionCaption = (props: Pick<SectionOptions, 'caption' | 'captionArgs' | 'captionRef'>) => {
  return (
    <SectionContent ref={props.captionRef} class={className + '-caption'}>
      {typeof props.caption === 'string' ?
        i18n(props.caption as LangPackKey, props.captionArgs) :
        props.caption}
    </SectionContent>
  )
}
const Section: ParentComponent<SectionProps> = (props) => {
  const [, rest] = splitProps(props, ['name', 'nameRef', 'nameArgs', 'nameRight', 'innerClass', 'caption', 'captionArgs', 'captionOld', 'captionTop', 'captionRef', 'noDelimiter', 'fakeGradientDelimiter', 'noShadow', 'noMarginBottom', 'noContent', 'class', 'contentProps', 'ref'])
  return (
    <div
      class={classNames(className + '-container', props.noMarginBottom && 'no-margin-bottom', props.class)}
      ref={props.ref}
      {...rest}
    >
      {props.caption && props.captionTop && <SectionCaption {...props} />}
      {!props.noContent && (
        <div
          class={classNames(
            className,
            props.noShadow && 'no-shadow',
            props.noDelimiter && 'no-delimiter',
            props.innerClass,
          )}
        >
          {props.fakeGradientDelimiter && generateDelimiter()}
          <SectionContent {...props.contentProps}>
            {props.name && (
              <SectionName ref={props.nameRef} right={props.nameRight}>
                {typeof (props.name) === 'string' ? i18n(props.name as LangPackKey, props.nameArgs) : props.name}
              </SectionName>
            )}
            {props.children}
          </SectionContent>
          {props.caption && !props.captionTop && props.captionOld && <SectionCaption {...props} />}
        </div>
      )}
      {props.caption && !props.captionTop && !props.captionOld && <SectionCaption {...props} />}
    </div>
  )
}

/**
 * A `<Section>` renders one content element. Some panels stack several inside the same
 * section (a button, then a list that is reordered by index), which needs its own element —
 * this appends one next to the existing content, like the old SettingSection's
 * `generateContentElement()` did.
 */
export function appendSectionContent(section: HTMLElement) {
  // `<Section/>` — КОМПОНЕНТ, и его результат не всегда сам узел: dev-сервер
  // оборачивает компоненты в memo ради hot reload, там это функция, а в
  // прод-сборке — элемент. Код, который кастует его `as HTMLElement`, живёт до
  // первого запуска из dev-сервера — отсюда проверка с названной причиной
  // вместо `undefined is not a function` посреди рендера (tweb a27e97144).
  if (typeof section?.querySelector !== 'function') {
    throw new Error(
      `appendSectionContent: expected the section element, got ${typeof section}. ` +
      'A `<Section/>` value has to be unwrapped to its element before it is cast to HTMLElement.',
    )
  }

  const inner = section.querySelector('.' + className)
  if (!inner) {
    throw new Error('appendSectionContent: this section has no content element to append next to (`noContent`?)')
  }

  const content = document.createElement('div')
  content.classList.add(className + '-content')
  inner.append(content)
  return content
}

export default Section
