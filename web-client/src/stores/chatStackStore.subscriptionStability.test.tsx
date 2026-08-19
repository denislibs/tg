// src/stores/chatStackStore.subscriptionStability.test.tsx
//
// Регрессия со стенда (:38080): открытие темы форума роняло приложение в белый
// экран, React error #185 «Maximum update depth exceeded». Причина —
// `selectOpenThread` строит НОВЫЙ объект `{peerId, thread}` на каждый вызов;
// Zustand v5 (`useStore` поверх `useSyncExternalStore`) сравнивает снимок
// подписки по ССЫЛКЕ, поэтому `useChatStackStore(selectOpenThread)` при глубине
// стека > 1 (т.е. как раз когда открыт тред) на каждом рендере видит «новый»
// снимок → бесконечный цикл ре-рендеров. При глубине ≤ 1 селектор стабильно
// отдаёт `null` — баг был не виден юнит-тестами Task 5, которые дёргали
// `selectOpenThread(getState())` НАПРЯМУЮ (вызов функции, не подписка) и ни разу
// не рендерили компонент с реальной подпиской на глубине > 1.
//
// Этот файл ловит именно ПОДПИСКУ: рендерит настоящий компонент через
// `useChatStackStore(selector)`, доводит стек до глубины 2 и проверяет, что
// число рендеров конечно и стабилизировалось — а не тестирует функцию-селектор
// изолированным вызовом (это уже покрыто `chatStackStore.test.ts`).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, act } from '@testing-library/react'
import { useChatStackStore, selectOpenThreadDesc, type ChatType } from './chatStackStore'

afterEach(cleanup)

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
})

type Selector = (s: ReturnType<typeof useChatStackStore.getState>) => unknown

function Probe({ selector, onRender }: { selector: Selector; onRender: () => void }) {
  useChatStackStore(selector)
  onRender()
  return null
}

const thread = { rootMsgId: 7, title: 'Тема', kind: 'topic' as const }
const CHAT: ChatType = 'chat'

describe('подписка useChatStackStore(selectOpenThreadDesc) — стабильность снимка на глубине > 1', () => {
  it('число рендеров конечно и растёт ровно по одному на реальное изменение стека', () => {
    let renders = 0
    render(<Probe selector={selectOpenThreadDesc} onRender={() => { renders += 1 }} />)
    const afterMount = renders

    // Корень (глубина 1) держит `selectOpenThreadDesc` на стабильном `undefined`
    // ДО и ПОСЛЕ — Object.is(undefined, undefined) не считается изменением
    // снимка, поэтому этот компонент вовсе не обязан перерендериться. Это не
    // тот случай, где баг проявлялся; воспроизводим ИМЕННО переход через
    // глубину > 1 следующим шагом.
    act(() => { useChatStackStore.getState().setPeer({ peerId: 1, type: CHAT }) })
    const afterRoot = renders

    // Здесь при старой реализации (`selectOpenThread`, новый объект на вызов)
    // React ушёл бы в бесконечный цикл ре-рендеров этого же компонента — тест
    // либо зависает, либо React бросает «Maximum update depth exceeded».
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 1, threadId: 7, type: CHAT, thread })
    })
    const afterThread = renders

    // setPeer не меняет результат селектора (undefined → undefined) — ре-рендера
    // нет; setInnerPeer переводит стек через глубину 1 → результат меняется на
    // сам дескриптор, ровно один ре-рендер.
    expect(afterRoot - afterMount).toBe(0)
    expect(afterThread - afterRoot).toBe(1)

    // Ещё один прогон рендер-цикла (act без изменений стора) не должен
    // добавлять рендеров — снимок стабилен по ссылке, повторных вызовов нет.
    act(() => {})
    expect(renders).toBe(afterThread)
  })
})
