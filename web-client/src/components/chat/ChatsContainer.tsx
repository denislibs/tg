import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

/** Поэлементное сравнение по ссылке: `[...stack, prevTop]` — новый массив с теми
 *  же дескрипторами, если стек не поменялся с прошлого расчёта. Без этой проверки
 *  `setRenderList` считает такой массив новым состоянием (другая ссылка) и рождает
 *  лишний коммит; эффект №2 (см. ниже) не имеет своего списка зависимостей —
 *  он обязан переигрывать на каждом коммите, чтобы подхватить узел, которого не
 *  было в DOM на прошлом коммите, — а значит и его cleanup (снятие таймера ухода)
 *  тоже отработает на этом лишнем коммите и отменит уже поставленный таймер. */
function sameList(a: ChatInstanceDesc[], b: ChatInstanceDesc[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i])
}

export default function ChatsContainer({ renderInstance }: Props) {
  const stack = useChatStackStore((s) => s.stack)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef(new Map<string, HTMLDivElement>())
  const prevStackRef = useRef<ChatInstanceDesc[]>(stack)
  const pendingRef = useRef<{ fromKey: string; toKey: string; toRight: boolean } | null>(null)
  const [renderList, setRenderList] = useState<ChatInstanceDesc[]>(stack)
  // Актуальный renderList для сравнения внутри эффекта №1 (deps которого —
  // только [stack]): через ref, а не замыканием стейта, — иначе
  // exhaustive-deps требует дописать renderList в зависимости, а это заставит
  // эффект переигрывать при каждой смене списка и само по себе плодить лишние
  // коммиты, которые мы этой проверкой и убираем.
  const renderListRef = useRef(renderList)
  renderListRef.current = renderList

  const activeKey = stack.length ? stack[stack.length - 1].key : null

  // 1) реакция на смену стека: решаем, что рендерить и какой переход играть
  useLayoutEffect(() => {
    const prev = prevStackRef.current
    prevStackRef.current = stack
    if (prev === stack) return

    const top = stack[stack.length - 1]
    const prevTop = prev[prev.length - 1]

    if (!top || !prevTop || top.key === prevTop.key) {
      if (!sameList(renderListRef.current, stack)) setRenderList(stack)
      return
    }

    pendingRef.current = { fromKey: prevTop.key, toKey: top.key, toRight: stack.length > prev.length }
    // push: узел нового инстанса нужен в DOM — коммитим список сразу;
    // pop: уходящий верхний доживает до конца перехода, а промежуточные узлы
    // убираем сразу (tweb spliceChats:2705 — «fix middle chat z-index on animation»).
    const next = stack.length > prev.length ? stack : [...stack, prevTop]
    if (!sameList(renderListRef.current, next)) setRenderList(next)
  }, [stack])

  // 2) исполнение отложенного перехода — когда оба узла уже в DOM
  useLayoutEffect(() => {
    const pending = pendingRef.current
    const container = containerRef.current
    if (!pending || !container) return

    const to = nodesRef.current.get(pending.toKey) ?? null
    const from = nodesRef.current.get(pending.fromKey) ?? null
    if (!to) return // узел ещё не смонтирован — доиграем на следующем коммите

    pendingRef.current = null
    runNavigationTransition({ container, to, from, toRight: pending.toRight })

    if (pending.toRight) return
    const timer = setTimeout(() => setRenderList(useChatStackStore.getState().stack), NAVIGATION_TRANSITION_TIME + 100)
    return () => clearTimeout(timer)
  })

  // первый показ и смены без анимации: активность ставим сразу
  // (tweb chatsSelectTab с animate === false)
  useLayoutEffect(() => {
    if (!activeKey || pendingRef.current) return
    const node = nodesRef.current.get(activeKey)
    if (node && !node.classList.contains('active')) node.classList.add('active')
  }, [activeKey, renderList])

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
