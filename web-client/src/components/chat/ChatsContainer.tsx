import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useChatStackStore, type ChatInstanceDesc } from '../../stores/chatStackStore'
import { ChatInstanceProvider } from '../../core/chat/chatInstanceContext'
import { clearPendingTransitionCleanup, NAVIGATION_TRANSITION_TIME, runNavigationTransition } from '../../core/dom/navigationTransition'

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
  fromId: number
  toId: number
  toRight: boolean
}

export default function ChatsContainer({ renderInstance }: Props) {
  const stack = useChatStackStore((s) => s.stack)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef(new Map<number, HTMLDivElement>())
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

  const activeId = stack.length ? stack[stack.length - 1].id : null

  // 1) реакция на смену стека: решаем, что рендерить и какой переход играть
  useLayoutEffect(() => {
    const prev = prevStackRef.current
    prevStackRef.current = stack
    if (prev === stack) return

    const top = stack[stack.length - 1]
    const prevTop = prev[prev.length - 1]

    // Тот же ИНСТАНС наверху — перехода нет, даже если у него сменился пир:
    // это `chat.setPeer()` внутри одного контейнера, на котором
    // `chatsSelectTab` выходит первой строкой (appImManager.ts:2238-2240).
    if (!top || !prevTop || top.id === prevTop.id) {
      setRenderList(stack)
      return
    }

    // Владелец объявил «без анимации» — порт `animate === false`, который
    // оригинал отдаёт в `chatsSelectTab` и там гасит переход через
    // `disableTransition` (appImManager.ts:2243-2245). Читаем из того же
    // снимка, которым приехал `stack`: стор ставит пару одним `set()`.
    if (!useChatStackStore.getState().animateNext) {
      setRenderList(stack)
      return
    }

    setPending({ fromId: prevTop.id, toId: top.id, toRight: stack.length > prev.length })
    // push: узел нового инстанса нужен в DOM — коммитим список сразу;
    // pop: уходящий верхний доживает до конца перехода, а промежуточные узлы
    // убираем сразу (tweb spliceChats:2705 — «fix middle chat z-index on animation»).
    setRenderList(stack.length > prev.length ? stack : [...stack, prevTop])
  }, [stack])

  // 2) исполнение отложенного перехода — когда оба узла уже в DOM.
  // Зависимости [pending, renderList]: эффект реально работает только когда
  // появился новый pending (эффект №1 отреагировал на смену стека) — а не на
  // любом постороннем ре-рендере компонента (напр. родитель передал новый
  // `renderInstance`). `renderList` в зависимостях — эффект №1 всегда коммитит
  // `setPending` и `setRenderList` парой в одном флаше, поэтому к моменту,
  // когда этот эффект видит свежий `pending`, `renderList` уже содержит нужный
  // узел (React 18+ батчит оба setState в один следующий рендер) — оба узла
  // гарантированно уже в DOM, отдельной проверки/повтора «на следующем
  // коммите» не нужно.
  useLayoutEffect(() => {
    if (!pending) return
    const container = containerRef.current
    if (!container) return

    const to = nodesRef.current.get(pending.toId) ?? null
    const from = nodesRef.current.get(pending.fromId) ?? null

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
    if (activeId === null || pending) return
    const node = nodesRef.current.get(activeId)
    if (!node) return

    // Снять чужую отложенную уборку — то же, что делает первой строкой сам
    // переход. Узел, который только что уходил в АНИМИРОВАННОМ переходе, ещё
    // держит на себе таймер, снимающий с него `active`; мгновенная смена
    // (`animateNext: false` — клик по другому чату, пока открыт тред,
    // chatStackStore.ts:134) возвращает ему активность СЕЙЧАС, а таймер через
    // NAVIGATION_TRANSITION_TIME её отбирает — и колонка чата пустеет.
    // ВНЕ проверки на `active` ниже: в этом сценарии класс с узла ещё не снят,
    // и проверка увела бы мимо.
    clearPendingTransitionCleanup(node)

    if (!node.classList.contains('active')) node.classList.add('active')
  }, [activeId, renderList, pending])

  return (
    <div ref={containerRef} className="chats-container tabs-container" data-animation="navigation">
      {renderList.map((desc) => (
        <div
          key={desc.id}
          ref={(el) => {
            if (el) nodesRef.current.set(desc.id, el)
            else nodesRef.current.delete(desc.id)
          }}
          className="chat tabs-tab"
          data-type={desc.type}
        >
          <ChatInstanceProvider value={{ desc, isActive: desc.id === activeId }}>
            {renderInstance(desc)}
          </ChatInstanceProvider>
        </div>
      ))}
    </div>
  )
}
