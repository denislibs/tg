import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useChatStackStore, type ChatInstanceDesc } from '../../stores/chatStackStore'
import { ChatInstanceProvider } from '../../core/chat/chatInstanceContext'
import { NAVIGATION_TRANSITION_TIME, runNavigationTransition } from '../../core/dom/navigationTransition'

// Порт `appImManager.chatsSelectTab` (tweb lib/appImManager.ts:2237) поверх уже
// портированного примитива перехода: контейнер — `.chats-container.tabs-container
// [data-animation="navigation"]` (tweb appImManager.ts:306-308), по узлу на
// инстанс стека, `.active` только у верхнего.
//
// Рендерим из renderList, а не прямо из stack: на push новый узел обязан
// появиться в DOM ДО анимации (переход запускается следующим layout-эффектом),
// на pop уходящий обязан дожить до её конца (список подрезается по таймеру).
// Поэтому renderList всегда ⊇ stack.

interface Props {
  /** тело инстанса; резолв дескриптора в сущность чата остаётся за вызывающим */
  renderInstance: (desc: ChatInstanceDesc) => ReactNode
}

interface PendingTransition {
  fromKey: string
  toKey: string
  toRight: boolean
}

export default function ChatsContainer({ renderInstance }: Props) {
  const stack = useChatStackStore((s) => s.stack)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef(new Map<string, HTMLDivElement>())
  const prevStackRef = useRef<ChatInstanceDesc[]>(stack)
  const [renderList, setRenderList] = useState<ChatInstanceDesc[]>(stack)
  // Отложенный переход — стейт, а не реф: эффекту №2 нужны явные зависимости
  // ([pending, renderList]), иначе он обязан переигрывать на КАЖДОМ рендере
  // компонента (а не только когда реально что-то изменилось), в т.ч. на
  // ре-рендере, вызванном родителем (например, новым `renderInstance` —
  // как будет у ChatsContainer в App.tsx). Такой лишний прогон эффекта без
  // зависимостей до этой правки уже ловился на снятии таймера удаления узла.
  const [pending, setPending] = useState<PendingTransition | null>(null)
  // Таймер, которым по завершении pop-перехода обрезается renderList до
  // stack (удаляет уходящий узел). Держим в рефе и снимаем ЯВНО перед
  // постановкой нового — а не полагаемся на cleanup эффекта №2: два перехода
  // подряд (двойной pop, pop во время push) иначе либо теряют таймер, либо
  // пытаются обрезать список дважды на устаревшие данные.
  const removalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeKey = stack.length ? stack[stack.length - 1].key : null

  // 1) реакция на смену стека: решаем, что рендерить и какой переход играть
  useLayoutEffect(() => {
    const prev = prevStackRef.current
    prevStackRef.current = stack
    if (prev === stack) return

    const top = stack[stack.length - 1]
    const prevTop = prev[prev.length - 1]

    if (!top || !prevTop || top.key === prevTop.key) {
      setRenderList(stack)
      return
    }

    setPending({ fromKey: prevTop.key, toKey: top.key, toRight: stack.length > prev.length })
    // push: узел нового инстанса нужен в DOM — коммитим список сразу;
    // pop: уходящий верхний доживает до конца перехода, а промежуточные узлы
    // убираем сразу (tweb spliceChats:2705 — «fix middle chat z-index on animation»).
    setRenderList(stack.length > prev.length ? stack : [...stack, prevTop])
  }, [stack])

  // 2) исполнение отложенного перехода — когда оба узла уже в DOM.
  // Зависимости [pending, renderList]: эффект реально работает только когда
  // появился новый pending (эффект №1 отреагировал на смену стека) или когда
  // renderList сменился (нужный узел мог домонтироваться) — а не на любом
  // ре-рендере компонента.
  useLayoutEffect(() => {
    if (!pending) return
    const container = containerRef.current
    if (!container) return

    const to = nodesRef.current.get(pending.toKey) ?? null
    const from = nodesRef.current.get(pending.fromKey) ?? null
    if (!to) return // узел ещё не смонтирован — доиграем на следующем коммите (renderList вот-вот подтянет его)

    setPending(null)
    runNavigationTransition({ container, to, from, toRight: pending.toRight })

    // Новый переход отменяет таймер обрезки от предыдущего — вне зависимости
    // от того, push это или pop: список к этому моменту уже пересчитан
    // заново эффектом №1 и старый отложенный setRenderList бил бы по
    // устаревшему снимку.
    if (removalTimerRef.current !== null) {
      clearTimeout(removalTimerRef.current)
      removalTimerRef.current = null
    }
    if (pending.toRight) return

    removalTimerRef.current = setTimeout(() => {
      removalTimerRef.current = null
      setRenderList(useChatStackStore.getState().stack)
    }, NAVIGATION_TRANSITION_TIME + 100)
  }, [pending, renderList])

  // снятие таймера обрезки строго на размонтирование — не через cleanup
  // эффекта №2 (см. комментарий у removalTimerRef)
  useEffect(() => {
    return () => {
      if (removalTimerRef.current !== null) clearTimeout(removalTimerRef.current)
    }
  }, [])

  // первый показ и смены без анимации: активность ставим сразу
  // (tweb chatsSelectTab с animate === false)
  useLayoutEffect(() => {
    if (!activeKey || pending) return
    const node = nodesRef.current.get(activeKey)
    if (node && !node.classList.contains('active')) node.classList.add('active')
  }, [activeKey, renderList, pending])

  return (
    <div ref={containerRef} className="chats-container tabs-container" data-animation="navigation">
      {renderList.map((desc) => (
        <div
          key={desc.key}
          ref={(el) => {
            if (el) nodesRef.current.set(desc.key, el)
            else nodesRef.current.delete(desc.key)
          }}
          className="chat tabs-tab"
          data-type={desc.type}
        >
          <ChatInstanceProvider value={{ desc, isActive: desc.key === activeKey }}>
            {renderInstance(desc)}
          </ChatInstanceProvider>
        </div>
      ))}
    </div>
  )
}
