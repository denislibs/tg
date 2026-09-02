/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/section.tsx` — секция настроек в Solid-разметке.
 *
 * ЭТО НЕ ОБЁРТКА над `components/settingSection.ts`, а второй, самостоятельный
 * рендер той же карточки — ровно как в оригинале, где эти два файла тоже
 * независимы. Разметка и классы у них общие
 * (`sidebar-left-section-container` > `sidebar-left-section` >
 * `sidebar-left-section-content`), поэтому один и тот же SCSS
 * (`styles/tweb/_section.scss`) обслуживает обе версии, а вкладка может
 * смешивать их в одном дереве: `sidebarLeft/tabs/language.solid.tsx` рисует
 * первую секцию этим компонентом, а вторая содержит императивную форму радио.
 *
 * `captionOld` — не «старый вариант», а МЕСТО подписи: при `true` подпись
 * лежит ВНУТРИ карточки (последним контент-блоком), при `false`/по умолчанию —
 * снаружи, под карточкой. Та же развилка есть и у императивного порта
 * (`settingSection.ts`), и разобрана там же.
 */
import { splitProps, type JSX, type ParentComponent, type Ref } from 'solid-js'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import classNames from '@helpers/string/classNames'

export type SectionOptions = {
  name?: LangPackKey | HTMLElement | DocumentFragment | JSX.Element
  nameArgs?: FormatterArguments
  nameRight?: JSX.Element
  nameRef?: Ref<HTMLDivElement>
  caption?: LangPackKey | Exclude<JSX.Element, string>
  captionArgs?: FormatterArguments
  captionOld?: boolean
  captionRef?: Ref<HTMLDivElement>
  noDelimiter?: boolean
  noShadow?: boolean
  noMarginBottom?: boolean
  class?: JSX.HTMLAttributes<HTMLDivElement>['class']
  innerClass?: string
  contentProps?: JSX.HTMLAttributes<HTMLDivElement>
  ref?: Ref<HTMLDivElement>
}

const className = 'sidebar-left-section'

const SectionContent: ParentComponent<JSX.HTMLAttributes<HTMLDivElement>> = (props) => {
  return (
    <div ref={props.ref as Ref<HTMLDivElement>} class={classNames(className + '-content', props.class as string)}>
      {props.children}
    </div>
  )
}

const SectionCaption = (props: Pick<SectionOptions, 'caption' | 'captionArgs' | 'captionRef'>) => {
  return (
    <SectionContent ref={props.captionRef as Ref<HTMLDivElement>} class={className + '-caption'}>
      {typeof props.caption === 'string' ?
        i18n(props.caption as LangPackKey, props.captionArgs) :
        props.caption as JSX.Element}
    </SectionContent>
  )
}

const Section: ParentComponent<SectionOptions & JSX.HTMLAttributes<HTMLDivElement>> = (props) => {
  const [, rest] = splitProps(props, [
    'name', 'nameRef', 'nameArgs', 'nameRight', 'innerClass', 'caption', 'captionArgs',
    'captionOld', 'captionRef', 'noDelimiter', 'noShadow', 'class', 'contentProps',
  ])
  return (
    <div
      class={classNames(className + '-container', props.class as string)}
      ref={props.ref as Ref<HTMLDivElement>}
      {...rest}
    >
      <div
        class={classNames(
          className,
          props.noShadow && 'no-shadow',
          props.noDelimiter && 'no-delimiter',
          props.innerClass,
          props.noMarginBottom && 'no-margin-bottom',
        )}
      >
        <SectionContent {...props.contentProps}>
          {props.name && (
            <div ref={props.nameRef as Ref<HTMLDivElement>} class={classNames('sidebar-left-h2', className + '-name')}>
              {typeof props.name === 'string' ? i18n(props.name as LangPackKey, props.nameArgs) : props.name as JSX.Element}
              {props.nameRight && <div class={className + '-name-right'}>{props.nameRight}</div>}
            </div>
          )}
          {props.children}
        </SectionContent>
        {props.caption && props.captionOld && <SectionCaption {...props} />}
      </div>
      {props.caption && !props.captionOld && <SectionCaption {...props} />}
    </div>
  )
}

export default Section
