/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/wrappers/webPage.tsx` (812502980) — `WebPageBox`,
 * карточка превью ссылки в бабле (`chat/bubbles.ts`, ветка `messageMediaWebPage`,
 * tweb bubbles.ts:9334-9786). Разметка и классы — дословно; стили —
 * `styles/tweb/_chatBubble.scss` (`.webpage`) и `_quote.scss` (`.quote-like`).
 */
import type { JSX, Ref } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { getDirection } from '@helpers/dom/setInnerHTML'
import classNames from '@helpers/string/classNames'
import { IconTsx } from '@components/iconTsx.solid'
import { Ripple } from '@components/rippleTsx.solid'

const className = 'webpage'

function WebPageFooter(props?: {
  content: JSX.Element,
  link?: boolean,
  text?: boolean,
  ref?: (el: HTMLElement) => void
}) {
  return props?.content && (
    <div
      dir={getDirection()}
      class={classNames(`${className}-footer`, props.link && 'is-link', props.text && 'is-text', !props.text && 'is-button')}
      ref={props.ref}
    >
      {props.content}
      {props.link && <IconTsx icon="arrow_next" class={`${className}-footer-icon`} />}
    </div>
  )
}

function WebPageName(props?: {
  content: JSX.Element,
  tip?: {
    content: JSX.Element,
    onClick: (e: MouseEvent) => void
  }
}) {
  return props?.content && (
    <div dir={getDirection()} class={`${className}-name`}>
      <strong>
        {props.content}
      </strong>
      {props.tip && (
        <span class={`${className}-name-tip`} onClick={props.tip.onClick}>
          {props.tip.content}
        </span>
      )}
    </div>
  )
}

function WebPageTitle(text?: JSX.Element) {
  return text && (
    <div dir={getDirection()} class={`${className}-title`}>
      <strong>
        {text}
      </strong>
    </div>
  )
}

function WebPageText(props: {
  children: JSX.Element
}) {
  return (
    <div dir={getDirection()} class={`${className}-text`}>
      {props.children}
    </div>
  )
}

function WebPageMedia(props?: {
  ref?: Ref<HTMLDivElement>,
  content?: HTMLElement,
  position: 'top' | 'bottom',
  hasDocument?: boolean,
  photoSize?: 'vertical' | 'square'
}) {
  if(!props) {
    return
  }

  const _className = `${className}-preview`
  const withDocument = props.hasDocument && `${_className}-with-document`
  if(props.content) {
    props.content.classList.add(...[_className, withDocument].filter((v): v is string => !!v))
  }

  return (
    <div class={`${className}-preview-resizer`}>
      {props.content || <div ref={props.ref} class={classNames(_className, withDocument)}></div>}
    </div>
  )
}

export type WebPageBoxProps = {
  footer?: Parameters<typeof WebPageFooter>[0],
  name?: Parameters<typeof WebPageName>[0],
  title?: Parameters<typeof WebPageTitle>[0],
  text?: Parameters<typeof WebPageText>[0]['children'],
  media?: Parameters<typeof WebPageMedia>[0],
  ref?: (el: HTMLAnchorElement) => void,
  minContent?: boolean,
  clickable?: boolean
}

export default function WebPageBox(props: WebPageBoxProps) {
  const viewButton = WebPageFooter(props.footer)
  const siteName = WebPageName(props.name)
  const titleDiv = WebPageTitle(props.title)
  const previewResizer = WebPageMedia(props.media)

  const contentDiv = (
    <div class={classNames(`${className}-content`, props.media?.hasDocument && 'has-document', props.minContent && 'min-content')}>
      {props.media?.position === 'top' && previewResizer}
      {siteName}
      {titleDiv}
      {props.text && <WebPageText>{props.text}</WebPageText>}
      {props.media?.position === 'bottom' && previewResizer}
      {viewButton}
    </div>
  )

  const quote = (
    <div
      class={classNames(
        `${className}-quote`,
        'quote-like-border',
      )}
    >
      {contentDiv}
    </div>
  )

  const ret = (
    <Dynamic
      component={props.clickable ? 'a' : 'div'}
      ref={props.ref}
      class={classNames(
        className,
        'quote-like',
        props.clickable && 'quote-like-hoverable',
        props.media?.photoSize && `has-${props.media.photoSize}-photo`,
      )}
    >
      {quote}
    </Dynamic>
  )

  if(!props.clickable) {
    return ret
  }

  return (
    <Ripple>{ret}</Ripple>
  )
}
