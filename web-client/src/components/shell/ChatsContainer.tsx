// `.chats-container.tabs-container` — контейнер вкладок-чатов (живой DOM tweb §1).
//
// Переход между чатами в tweb (appImManager.chatsSelectTab): уходящая вкладка
// теряет класс `active`, приходящая его получает, и обе ОСТАЮТСЯ в дереве на
// время анимации. Работает это так: `.tabs-container` — грид 100%×100%
// (_slider.scss), поэтому обе вкладки лежат в одной ячейке друг на друге, а
// `.chat { display: flex !important }` (_chat.scss) перебивает
// `.tabs-tab:not(.active) { display: none }` — иначе уходящий чат просто исчезал
// бы. Сама анимация — CSS: `.chat:not(.active)` уезжает на ∓200px и гаснет
// (_chat.scss:492-501), переход `transform/opacity var(--tabs-transition)`.
//
// Уходящий узел клонируется, а не создаётся заново: тот же key и тип, так что
// React меняет только проп `active`, сохраняя состояние компонента.
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

/** --tabs-transition: .2s ease-in-out (styles/_tokens.scss) */
const TAB_TRANSITION_MS = 200

interface Activatable {
  active?: boolean
}

const withActive = (node: ReactNode, active: boolean): ReactNode =>
  isValidElement(node) && typeof node.type !== 'string'
    ? cloneElement(node as ReactElement<Activatable>, { active })
    : node

export default function ChatsContainer({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const [outgoing, setOutgoing] = useState<ReactNode | null>(null)
  // Первый кадр после смены вкладки входящий чат рисуется неактивным, иначе
  // переходить не от чего — он бы сразу оказался на месте.
  const [entering, setEntering] = useState(false)
  const shownKey = useRef(tabKey)
  const lastNode = useRef<ReactNode>(children)

  if (shownKey.current !== tabKey) {
    shownKey.current = tabKey
    setOutgoing(lastNode.current)
    setEntering(true)
  }
  lastNode.current = children

  // Снимаем стартовое состояние после того, как браузер отрисовал кадр с ним
  // (двойной rAF — иначе переход схлопнется в один стиль и не сыграет).
  useEffect(() => {
    if (!entering) return
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setEntering(false)) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [entering])

  useEffect(() => {
    if (!outgoing) return
    const t = setTimeout(() => setOutgoing(null), TAB_TRANSITION_MS)
    return () => clearTimeout(t)
  }, [outgoing])

  return (
    <div className="chats-container tabs-container">
      {outgoing ? withActive(outgoing, false) : null}
      {withActive(children, !entering)}
    </div>
  )
}
