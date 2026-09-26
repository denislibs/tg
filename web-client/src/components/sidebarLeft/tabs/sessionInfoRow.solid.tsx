/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/sessionInfoRow.tsx:1-29 (812502980) —
 * одна строка «метка → значение» секции `Info` экрана сессии (`session.solid.tsx`).
 *
 * Расхождение: нет пропа `valueClass` (:15-16) — у оригинала им расширяет
 * значение только экран бизнес-бота (`connectedBotSession.tsx`, `.deviceValue`),
 * а бизнес-ботов у нас нет.
 */
import type { JSX } from 'solid-js'
import Row from '@components/rowTsx.solid'
import classNames from '@helpers/string/classNames'
import styles from './sessionDetails.module.scss'

const EMPTY_VALUE = '—'

export default function SessionInfoRow(props: {
  label: JSX.Element
  value: JSX.Element
}) {
  return (
    <Row>
      <Row.Title
        titleRight={props.value || EMPTY_VALUE}
        titleRightClass={classNames('text-overflow-no-wrap', styles.value)}
        titleRightSecondary
      >
        {props.label}
      </Row.Title>
    </Row>
  )
}
