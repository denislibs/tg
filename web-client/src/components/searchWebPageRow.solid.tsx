/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/searchWebPageRow.tsx:1-63 (812502980) — строка вкладки
 * «Ссылки» shared media на Solid `Row` (`components/rowTsx.solid.tsx`). Зовёт её
 * `AppSearchSuper.processUrlFilter` (`appSearchSuper.ts`, у tweb `:1398-1409`) —
 * вместо прежнего императивного `new Row(…)` + `applyMediaElement`.
 *
 * Расхождения с оригиналом:
 *  1. `link.onClick` (inline-атрибут `onclick`, `:27-29`) → `link.action` в атрибуте
 *     `ANCHOR_ACTION_ATTRIBUTE` (`@lib/richtext/url`): наш `wrapRichText` не пишет
 *     inline-обработчиков в разметку (расхождение 23 шапки `appSearchSuper.ts`),
 *     действие ссылки несёт этот атрибут, и строка переносит его с якоря на себя.
 */
import type { JSX } from 'solid-js'
import Row from '@components/rowTsx.solid'
import type { Middleware } from '@helpers/middleware'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { ANCHOR_ACTION_ATTRIBUTE, setBlankToAnchor } from '@lib/richtext/url'

type SearchWebPageRowLink = {
  href: string
  action?: string
  targetBlank?: boolean
}

type SearchWebPageRowProps = {
  title: JSX.Element
  titleRight: JSX.Element
  subtitle: JSX.Element
  media: HTMLElement
  link?: SearchWebPageRowLink
}

function SearchWebPageRow(props: SearchWebPageRowProps) {
  const setRef = (element: HTMLElement) => {
    if(!props.link) return

    const anchor = element as HTMLAnchorElement
    anchor.href = props.link.href
    if(props.link.action) {
      anchor.setAttribute(ANCHOR_ACTION_ATTRIBUTE, props.link.action)
    }

    if(props.link.targetBlank) {
      setBlankToAnchor(anchor)
    }
  }

  return (
    <Row
      ref={setRef}
      as={props.link ? 'a' : undefined}
      clickable
      havePadding
      noRipple
    >
      <Row.Title titleRight={props.titleRight}>{props.title}</Row.Title>
      <Row.Subtitle>{props.subtitle}</Row.Subtitle>
      <Row.Media element={props.media} size="big" />
    </Row>
  )
}

export function renderSearchWebPageRow(
  props: SearchWebPageRowProps & { middleware: Middleware },
) {
  return wrapSolidComponent(() => (
    <SearchWebPageRow
      title={props.title}
      titleRight={props.titleRight}
      subtitle={props.subtitle}
      media={props.media}
      link={props.link}
    />
  ), props.middleware)
}
