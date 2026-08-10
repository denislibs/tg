# Этап 0: активация middleware (примитив отмены tweb) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Активировать вендореный tweb-примитив `helpers/middleware.ts` как прикладной механизм отмены устаревшей асинхронщины: порт `middlewarePromise`, React-адаптер, обёртка всех реально незащищённых мест, замена одноразовых изобретений (`patternRunRef`), унификация `doubleRaf`.

**Architecture:** Примитивы — дословный tweb (`src/helpers/middleware.ts` уже в дереве, `middlewarePromise.ts` портируется 1:1), не форкаются. Поверх — один тонкий React-адаптер `useMiddlewareHelper()` (хелпер живёт жизнь компонента, `destroy()` на unmount). Канонический паттерн эффекта: дочерний scope через `middleware.create()` на прогон (иерархия отмены tweb) — либо `helper.clean()` в cleanup, когда весь компонент — одна зона актуальности.

**Tech Stack:** React 19, TS strict (вендор-файлы — `@ts-nocheck`, как принято для tweb-островков), vitest + @testing-library/react (happy-dom), oxlint.

## Global Constraints

- **Примитивы 1:1 tweb, не форкать**: `src/helpers/middleware.ts` не менять; `middlewarePromise.ts` — дословный порт `TWEB/src/helpers/middlewarePromise.ts` (вкл. шапку `@ts-nocheck — вендорено из tweb 1:1`).
- Расширения — только тонкими адаптерами поверх примитивов (`core/hooks/useMiddlewareHelper.ts`); в `helpers/` новый НЕ-вендорный код не класть.
- Ошибка протухания — объект `{type: 'MIDDLEWARE'}` из `makeError` (НЕ `instanceof Error`); в тестах проверять `.type`, не `toThrow(Error)`.
- Уже защищённые `alive`-флагом места в этом плане **не** конвертировать (churn без изменения поведения); мигрируют при ближайшем касании файла. Конвертируются только файлы, которые план и так меняет.
- Существующие `eslint-disable-next-line react-hooks/exhaustive-deps` в правках сохранять как есть (deps-массивы не расширять — это отдельная работа).
- Комментарии в коде — по-русски, в стиле окружающего кода; вендор-файлы — без изменений комментариев.
- Все команды — из `web-client/`: `npm test` (или `npx vitest run <path>`), `npm run typecheck`, `npm run lint`.
- Коммиты — на русском, префиксы `feat(...)`/`fix(...)`/`test(...)`/`refactor(...)`, каждый с трейлером Co-Authored-By как принято в сессии.

---

### Task 1: Тесты-пины семантики MiddlewareHelper

`src/helpers/middleware.ts` уже вендорен (98 строк, дословный tweb). Кода не меняем — пинами фиксируем семантику, на которую обопрётся весь этап (и будущий `setPeer` Этапа 2).

**Files:**
- Test: `web-client/src/helpers/middleware.test.ts` (новый)

**Interfaces:**
- Consumes: `getMiddleware(): MiddlewareHelper` из `./middleware` (уже существует).
- Produces: зафиксированные гарантии — `clean()` навсегда гасит старые замыкания; `onClean` на протухшем вызывается немедленно; `create()` — иерархия; `get(additionalCallback)` — доп-условие; `destroy()`/`onDestroy`.

- [ ] **Step 1: Написать тесты**

```ts
// web-client/src/helpers/middleware.test.ts
// Пины семантики вендореного tweb-примитива (src/helpers/middleware.ts, 1:1).
// Файл не меняем — фиксируем гарантии, на которые опирается прикладной код
// (эффекты с RPC, будущий setPeer): см. docs/superpowers/plans/2026-08-10-middleware-activation.md.
import { describe, expect, it, vi } from 'vitest'
import { getMiddleware } from './middleware'

describe('MiddlewareHelper: пины семантики tweb', () => {
  it('middleware() истинен до clean() и ложен навсегда после; новое поколение живо', () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    expect(middleware()).toBe(true)
    helper.clean()
    expect(middleware()).toBe(false)
    const fresh = helper.get()
    expect(fresh()).toBe(true)
    expect(middleware()).toBe(false) // старое замыкание мертво навсегда
  })

  it('onClean: на живом — копится до clean(), на протухшем — вызывается немедленно', () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    const cb = vi.fn()
    middleware.onClean(cb)
    expect(cb).not.toHaveBeenCalled()
    helper.clean()
    expect(cb).toHaveBeenCalledTimes(1)
    const late = vi.fn()
    middleware.onClean(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('create(): дочерний хелпер уничтожается вместе с родителем', () => {
    const parent = getMiddleware()
    const child = parent.get().create()
    const childMiddleware = child.get()
    expect(childMiddleware()).toBe(true)
    parent.clean()
    expect(childMiddleware()).toBe(false)
  })

  it('destroy() дочернего отцепляет его от родителя, родитель живёт', () => {
    const parent = getMiddleware()
    const parentMiddleware = parent.get()
    const child = parentMiddleware.create()
    child.destroy()
    expect(parentMiddleware()).toBe(true)
  })

  it('create() на протухшем middleware бросает {type: MIDDLEWARE}', () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    helper.clean()
    let thrown: unknown
    try {
      middleware.create()
    } catch (e) {
      thrown = e
    }
    expect((thrown as { type?: string } | undefined)?.type).toBe('MIDDLEWARE')
  })

  it('get(additionalCallback): доп-условие актуальности', () => {
    const helper = getMiddleware()
    let current = 1
    const middleware = helper.get(() => current === 1)
    expect(middleware()).toBe(true)
    current = 2
    expect(middleware()).toBe(false)
  })

  it('destroy(): onDestroy вызывается; после destroy — немедленно', () => {
    const helper = getMiddleware()
    const onDestroy = vi.fn()
    helper.onDestroy(onDestroy)
    helper.destroy()
    expect(onDestroy).toHaveBeenCalledTimes(1)
    const late = vi.fn()
    helper.onDestroy(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('после destroy() хелпер снова выдаёт живой middleware (пин под StrictMode-ремаунт)', () => {
    const helper = getMiddleware()
    helper.destroy()
    expect(helper.get()()).toBe(true)
  })
})
```

- [ ] **Step 2: Прогнать** — `npx vitest run src/helpers/middleware.test.ts`. Ожидание: все PASS (это пины существующего кода; упавший тест = моё непонимание семантики, разбираться, не «чинить» вендор).

- [ ] **Step 3: Commit** — `test(middleware): пины семантики вендореного tweb-примитива`

---

### Task 2: Порт middlewarePromise (1:1) + тесты

**Files:**
- Create: `web-client/src/helpers/middlewarePromise.ts`
- Test: `web-client/src/helpers/middlewarePromise.test.ts`

**Interfaces:**
- Produces: `middlewarePromise(middleware: () => boolean, throwWhat?): <T>(promise: T) => T` — default-экспорт; после await бросает `{type:'MIDDLEWARE'}` (или `throwWhat`), если middleware протух.

- [ ] **Step 1: Написать падающие тесты**

```ts
// web-client/src/helpers/middlewarePromise.test.ts
import { describe, expect, it } from 'vitest'
import middlewarePromise from './middlewarePromise'
import { getMiddleware } from './middleware'

describe('middlewarePromise: семантика tweb', () => {
  it('пропускает результат, пока middleware жив', async () => {
    const helper = getMiddleware()
    const m = middlewarePromise(helper.get())
    await expect(m(Promise.resolve(42))).resolves.toBe(42)
  })

  it('бросает {type: MIDDLEWARE}, если протух к моменту резолва', async () => {
    const helper = getMiddleware()
    const m = middlewarePromise(helper.get())
    const p = m(new Promise<number>((r) => setTimeout(() => r(42), 0)))
    helper.clean()
    let thrown: unknown
    try {
      await p
    } catch (e) {
      thrown = e
    }
    expect((thrown as { type?: string } | undefined)?.type).toBe('MIDDLEWARE')
  })

  it('не-промис проходит насквозь; Error бросается сразу', () => {
    const m = middlewarePromise(() => true)
    expect(m(42 as unknown as Promise<number>)).toBe(42)
    const err = new Error('boom')
    expect(() => m(err as unknown as Promise<never>)).toThrow('boom')
  })

  it('кастомный throwWhat подменяет ошибку', async () => {
    const helper = getMiddleware()
    const custom = { type: 'PEER_CHANGED' }
    const m = middlewarePromise(helper.get(), custom)
    const p = m(new Promise<number>((r) => setTimeout(() => r(1), 0)))
    helper.clean()
    await expect(p).rejects.toBe(custom)
  })
})
```

- [ ] **Step 2: Прогнать, убедиться в FAIL** — `npx vitest run src/helpers/middlewarePromise.test.ts`. Ожидание: FAIL «Cannot find module './middlewarePromise'».

- [ ] **Step 3: Портировать дословно** (`TWEB/src/helpers/middlewarePromise.ts`, меняется только шапка):

```ts
// @ts-nocheck — вендорено из tweb 1:1 (src/helpers/middlewarePromise.ts)
import makeError from '@helpers/makeError';

const error = makeError('MIDDLEWARE');
export default function middlewarePromise(middleware: () => boolean, throwWhat: any = error) {
  return <T>(promise: T): T => {
    if(!(promise instanceof Promise)) {
      if(promise instanceof Error) {
        throw promise;
      } else {
        return promise;
      }
    }

    return (promise as any as Promise<any>).then((result) => {
      if(!middleware()) {
        throw throwWhat;
      }

      return result;
    }) as any;
  };
}
```

- [ ] **Step 4: Прогнать до PASS** — та же команда. Затем `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit** — `feat(middleware): порт middlewarePromise из tweb 1:1`

---

### Task 3: React-адаптер useMiddlewareHelper + тесты

**Files:**
- Create: `web-client/src/core/hooks/useMiddlewareHelper.ts`
- Test: `web-client/src/core/hooks/useMiddlewareHelper.test.tsx`

**Interfaces:**
- Consumes: `getMiddleware`, `MiddlewareHelper` из `@helpers/middleware`.
- Produces: `useMiddlewareHelper(): MiddlewareHelper` — стабильная ссылка на жизнь компонента, `destroy()` на unmount. Канонические паттерны использования (нужны Task 4-7 дословно):

```ts
// (а) несколько независимых эффектов в одном компоненте — дочерний scope на прогон:
const helper = useMiddlewareHelper()
useEffect(() => {
  const scope = helper.get().create()
  const middleware = scope.get()
  void managers.x.y(id).then((r) => { if (middleware()) setState(r) }).catch(() => {})
  return () => scope.destroy()
}, [helper, id])

// (б) весь компонент/хук — одна зона актуальности (один источник async):
useEffect(() => {
  const middleware = helper.get()
  ...
  return () => helper.clean()
}, [deps])
```

- [ ] **Step 1: Написать падающие тесты**

```tsx
// web-client/src/core/hooks/useMiddlewareHelper.test.tsx
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMiddlewareHelper } from './useMiddlewareHelper'

describe('useMiddlewareHelper', () => {
  it('хелпер стабилен между рендерами', () => {
    const { result, rerender } = renderHook(() => useMiddlewareHelper())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('на unmount выданные middleware протухают', () => {
    const { result, unmount } = renderHook(() => useMiddlewareHelper())
    const middleware = result.current.get()
    expect(middleware()).toBe(true)
    unmount()
    expect(middleware()).toBe(false)
  })

  it('дочерние scope независимы: destroy одного не гасит другой', () => {
    const { result } = renderHook(() => useMiddlewareHelper())
    const a = result.current.get().create()
    const b = result.current.get().create()
    const mb = b.get()
    a.destroy()
    expect(mb()).toBe(true)
    b.destroy()
    expect(mb()).toBe(false)
  })

  it('переживает StrictMode-двойной маунт: после ремаунта middleware живой', () => {
    const { result } = renderHook(() => useMiddlewareHelper(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    })
    expect(result.current.get()()).toBe(true)
  })
})
```

- [ ] **Step 2: FAIL** — `npx vitest run src/core/hooks/useMiddlewareHelper.test.tsx` («Cannot find module»).

- [ ] **Step 3: Реализация**

```ts
// web-client/src/core/hooks/useMiddlewareHelper.ts
// React-адаптер вендореного tweb-примитива актуальности (@helpers/middleware):
// хелпер живёт жизнь компонента, на unmount уничтожается — все выданные им
// middleware протухают, опоздавшие .then/onload отбрасываются вызывающим кодом.
// Паттерны использования — в web-client/CLAUDE.md («Асинхронщина и актуальность»).
// StrictMode-безопасно: destroy() в clean() пересоздаёт details, поэтому после
// ремаунта тот же хелпер снова выдаёт живые middleware (пин в middleware.test.ts).
import { useEffect, useRef } from 'react'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'

export function useMiddlewareHelper(): MiddlewareHelper {
  const ref = useRef<MiddlewareHelper | null>(null)
  ref.current ??= getMiddleware()
  useEffect(() => {
    const helper = ref.current!
    return () => helper.destroy()
  }, [])
  return ref.current
}
```

- [ ] **Step 4: PASS + typecheck + lint.**

- [ ] **Step 5: Commit** — `feat(middleware): React-адаптер useMiddlewareHelper`

---

### Task 4: Chat.tsx — три незащищённых эффекта

Только реально незащищённые (эффекты с `alive` в этом файле НЕ трогать — `:320-329`, `:842-855`).

**Files:**
- Modify: `web-client/src/components/Chat.tsx` (эффекты у строк 338-343, 347-353, 358-364 + импорт + одна строка в теле компонента)

**Interfaces:**
- Consumes: `useMiddlewareHelper` (Task 3), паттерн (а).

- [ ] **Step 1: Импорт и хелпер.** К импортам добавить `import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'`; в теле компонента, сразу после строки `const managers = useManagers()`, добавить `const middlewareHelper = useMiddlewareHelper()`.

- [ ] **Step 2: Заменить три эффекта** (каждый — точный diff; deps-массивы и eslint-disable не менять):

```tsx
  const [scheduledCount, setScheduledCount] = useState(0)
  useEffect(() => {
    setScheduledCount(0)
    if (!isRealChat) return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.messages.listScheduled(numericChatId)
      .then((l) => { if (middleware()) setScheduledCount(l.length) })
      .catch(() => undefined)
    return () => scope.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])
```

```tsx
  useEffect(() => {
    if (!isRealChat || chat.type === 'private' || chat.type === 'saved') return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.messages.groupCallParticipants(numericChatId)
      .then((ids) => { if (middleware()) useGroupCallStore.getState().setActive(numericChatId, ids) })
      .catch(() => undefined)
    return () => scope.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])
```

```tsx
  useEffect(() => {
    if (!isRealChat || chat.type === 'private' || chat.type === 'saved') return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.livestream.status(numericChatId)
      .then((st) => { if (middleware()) useLivestreamStore.getState().setActive(numericChatId, st.active) })
      .catch(() => undefined)
    return () => scope.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])
```

- [ ] **Step 3: Проверка** — `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 4: Commit** — `fix(chat): поздние ответы listScheduled/groupCall/livestream не переживают смену чата (middleware)`

---

### Task 5: TopicsPanel + DatePickerPopup + два пропущенных .catch

**Files:**
- Modify: `web-client/src/components/TopicsPanel.tsx` (строки 76-86 + импорт + хелпер)
- Modify: `web-client/src/components/DatePickerPopup.tsx` (строки 229-243 + импорт + хелпер)
- Modify: `web-client/src/components/messages/VoiceMessage.tsx` (строка 80: добавить `.catch`)
- Modify: `web-client/src/core/hooks/usePremiumSubscription.ts` (строка 25: добавить `.catch`)

**Interfaces:**
- Consumes: `useMiddlewareHelper`, паттерн (б) — в обоих компонентах весь async — одна зона актуальности.

- [ ] **Step 1: TopicsPanel.** Импорт `import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'`; рядом с `const managers = useManagers()` — `const middlewareHelper = useMiddlewareHelper()`. Блок 76-86 →

```tsx
  const reload = () => {
    const middleware = middlewareHelper.get()
    void managers.groups.listTopics(chatId)
      .then((t) => { if (middleware()) setTopics(t) })
      .catch(() => { if (middleware()) setTopics([]) })
  }
  useEffect(() => {
    setTopics(null)
    reload()
    const middleware = middlewareHelper.get()
    void managers.groups.card(chatId).then((c) => {
      if (middleware()) setCanManage(c.myRole === 'creator' || (c.myRights & CHANGE_INFO) !== 0)
    }).catch(() => { if (middleware()) setCanManage(false) })
    // Смена chatId/unmount гасит и висящий reload() из меню — одна зона актуальности.
    return () => middlewareHelper.clean()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])
```

- [ ] **Step 2: DatePickerPopup.** Импорт `import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'`; в теле — `const middlewareHelper = useMiddlewareHelper()`. Эффект 229-243 → (появляются guard и `.catch`; `requested` не трогаем — политика ретраев не меняется):

```tsx
  useEffect(() => {
    if (chatId == null) return
    const middleware = middlewareHelper.get()
    for (const section of visible) {
      if (requested.current.has(section.key)) continue
      requested.current.add(section.key)
      void managers.messages.calendarMonth(chatId, Math.floor(section.date.getTime() / 1000)).then((days) => {
        if (!middleware() || !days.length) return
        setMediaByDay((prev) => {
          const next = new Map(prev)
          for (const d of days) next.set(dayKey(new Date(d.day * 1000)), d)
          return next
        })
      }).catch(() => {})
    }
  }, [visible, chatId, managers])
```

  Плюс отдельный эффект-деструктор рядом (запросы копятся между прогонами — гасим только на unmount): `useEffect(() => () => middlewareHelper.clean(), [middlewareHelper])`.

- [ ] **Step 3: VoiceMessage** — строка 80: `void managers.media.meta(mediaId).then((m) => {…})` получает `.catch(() => {})` (сейчас отказ ручки = unhandled rejection). `alive`-механику файла не менять.

- [ ] **Step 4: usePremiumSubscription** — цепочка `managers.premium.getSubscription().then(…)` получает `.catch(() => { if (alive) setLoading(false) })`. `alive`-механику не менять.

- [ ] **Step 5: Проверка** — `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit** — `fix(ui): актуальность async в TopicsPanel/DatePicker + пропущенные catch (middleware)`

---

### Task 6: useGlobalSearch — гонка пагинации + тест

Смена запроса/таба во время in-flight страницы дописывала старую страницу в новый список (`useGlobalSearch.ts:47-50` без гарда). Файл переводится на один механизм (middleware), `alive` уходит.

**Files:**
- Modify: `web-client/src/core/hooks/useGlobalSearch.ts`
- Test: `web-client/src/core/hooks/useGlobalSearch.test.tsx` (новый)

**Interfaces:**
- Consumes: `useMiddlewareHelper`, паттерн (б).
- Produces: сигнатура `useGlobalSearch(q, tab, filter)` не меняется.

- [ ] **Step 1: Написать падающий тест.** Харнес фейковых managers — по образцу `src/core/hooks/useMessageWindow.test.ts` (там уже решено, как подсовывать managers в `renderHook`; перенять его провайдер/моки дословно). Сценарий и ассерты:

```tsx
// Гонка пагинации: страница, запрошенная для старого query, не должна
// дописываться в список после смены query.
// 1) render с q='old', tab=0; фейковый searchGlobal возвращает управляемые
//    deferred-промисы; таймер дебаунса 250мс — vi.useFakeTimers().
// 2) резолвим первую страницу 'old' (offset 0) → msgs = страница A.
// 3) вызываем result.current.onScroll с моком e.currentTarget
//    ({scrollHeight: 1000, scrollTop: 900, clientHeight: 100} → у нижнего края);
//    searchGlobal получает второй вызов (offset PAGE) — НЕ резолвим.
// 4) rerender с q='new'; резолвим первую страницу 'new' → msgs = страница B.
// 5) теперь резолвим ЗАВИСШУЮ страницу шага 3 (от 'old').
// Ассерт: msgs === страница B (длина и содержимое не изменились) — старая
// страница отброшена. До фикса тест красный: список становится B+A-хвост.
```

- [ ] **Step 2: FAIL** — `npx vitest run src/core/hooks/useGlobalSearch.test.tsx`. Ожидание: красный именно на шаге 5 (список вырос).

- [ ] **Step 3: Реализация** — файл целиком (54 строки → замена; сигнатура и дебаунс не меняются):

```ts
import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { useMiddlewareHelper } from './useMiddlewareHelper'
import type { Message } from '../models'

export type SearchFilter = '' | 'media' | 'links' | 'files' | 'music' | 'voice'

const PAGE = 30

// Глобальный поиск сообщений (managers.messages.searchGlobal) для SearchView:
// таб «Чаты» ищет по тексту (нужен q), медиа-табы листают по типу (filter), q
// дополнительно сужает. Дебаунс 250мс, смена таба/запроса сбрасывает список;
// onScroll подгружает следующую страницу у нижнего края. null = ещё грузится.
// Актуальность — @helpers/middleware: смена q/tab/filter (cleanup эффекта)
// гасит и первую страницу, и висящую пагинацию onScroll.
export function useGlobalSearch(q: string, tab: number, filter: SearchFilter): {
  msgs: Message[] | null
  msgCount: number
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
} {
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const [msgs, setMsgs] = useState<Message[] | null>(null)
  const [msgCount, setMsgCount] = useState(0)
  const loadingMore = useRef(false)

  useEffect(() => {
    const need = tab === 0 ? q !== '' : filter !== ''
    setMsgs(null)
    setMsgCount(0)
    if (!need) return
    const middleware = middlewareHelper.get()
    const id = window.setTimeout(() => {
      managers.messages.searchGlobal(q, filter, 0, PAGE)
        .then((r) => { if (middleware()) { setMsgs(r.messages); setMsgCount(r.count) } })
        .catch(() => { if (middleware()) { setMsgs([]); setMsgCount(0) } })
    }, 250)
    return () => {
      window.clearTimeout(id)
      middlewareHelper.clean()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, filter])

  // Подгрузка следующей страницы у нижнего края скролла.
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 600) return
    if (loadingMore.current || msgs == null || msgs.length >= msgCount) return
    loadingMore.current = true
    const middleware = middlewareHelper.get()
    managers.messages.searchGlobal(q, filter, msgs.length, PAGE)
      .then((r) => { if (middleware()) setMsgs((cur) => [...(cur ?? []), ...r.messages]) })
      .catch(() => undefined)
      .finally(() => { loadingMore.current = false })
  }

  return { msgs, msgCount, onScroll }
}
```

- [ ] **Step 4: PASS + весь набор** — `npx vitest run src/core/hooks/useGlobalSearch.test.tsx && npm test && npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit** — `fix(search): страница старого запроса не дописывается в новый список (middleware)`

---

### Task 7: ChatBackground — patternRunRef → middleware

`patternRunRef`/`superseded` (`ChatBackground.tsx:86-87, 238-239`) — одноразовое изобретение ровно этого примитива (фикс `eba3646`). Заменяем на общий механизм. Регрессионная сетка уже существует: `ChatBackground.test.tsx` («опоздавшая загрузка узора…», «после смены data-theme…») — должна остаться зелёной без правок тестов.

**Files:**
- Modify: `web-client/src/components/ChatBackground.tsx`

**Interfaces:**
- Consumes: `useMiddlewareHelper`, паттерн (б) — cleanup эффекта узора протухает его прогон.

- [ ] **Step 1: Импорт и хелпер.** `import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'`; в теле компонента рядом с остальными хуками — `const middlewareHelper = useMiddlewareHelper()`. Удалить строки 86-87 (`// Счётчик прогонов…` и `const patternRunRef = useRef(0)`).

- [ ] **Step 2: Эффект узора** (`:207-276`). Удалить блок 225-239 (комментарий «Токен прогона…» и `const run/superseded`), взамен после `const paint = …` вставить:

```tsx
    // Актуальность прогона — @helpers/middleware (аналог tweb disposeBuilt,
    // chatBackground.tsx:299 «used when an effect run is superseded»): cleanup
    // эффекта протухает middleware, опоздавшие onload/onerror прошлого прогона
    // (например, сетевой pattern.svg, обогнанный memory-кэшем после тика темы)
    // холст не трогают. История бага — коммит eba3646 и тест
    // «опоздавшая загрузка узора…» в ChatBackground.test.tsx.
    const middleware = middlewareHelper.get()
```

  В `img.onload`: `if (superseded()) return` → `if (!middleware()) return`. В `img.onerror` добавить первой строкой `if (!middleware()) return` (раньше guard'а не было — протухший onerror помечал готовность чужому прогону). Cleanup эффекта:

```tsx
    window.addEventListener('resize', paint)
    return () => {
      window.removeEventListener('resize', paint)
      middlewareHelper.clean()
    }
```

  Dep-массив (`:276`) не менять.

- [ ] **Step 3: Проверка регрессионной сеткой** — `npx vitest run src/components/ChatBackground.test.tsx` (все зелёные, тесты не редактировать), затем `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 4: Commit** — `refactor(wallpaper): patternRunRef → общий middleware-примитив`

---

### Task 8: Унификация doubleRaf (3 копии → 1)

Канон — вендореный `src/helpers/schedulers.ts:70` (tweb, поверх `fastRaf`-батчинга). Две самодельные копии удаляются.

**Files:**
- Modify: `web-client/src/core/accountTransition.ts` (строки 14-15)
- Modify: `web-client/src/components/messages/MediaLightbox.tsx` (строка 119)

- [ ] **Step 1: accountTransition.** Строки 14-15 заменить на re-export (потребители `App.tsx`/`AuthFlow.tsx` импортируют `doubleRaf` отсюда — их не трогаем):

```ts
export { doubleRaf } from '@helpers/schedulers'
```

  (`export const pause = …` остаётся как был.)

- [ ] **Step 2: MediaLightbox.** Удалить строку 119 (локальный `const doubleRaf = …`), в импорты добавить `import { doubleRaf } from '@helpers/schedulers'`.

- [ ] **Step 3: Проверка** — `npm test && npm run typecheck && npm run lint && npm run build` (build — потому что схлопывание импортов затрагивает чанки).

- [ ] **Step 4: Commit** — `refactor(dom): единый doubleRaf из vendored schedulers (было 3 копии)`

---

### Task 9: Конвенция в web-client/CLAUDE.md

**Files:**
- Modify: `web-client/CLAUDE.md` (после блока «МОЖНО:», перед «**Известное исключение**»)

- [ ] **Step 1: Добавить раздел** (дословно):

```md
**Асинхронщина и актуальность (middleware):**
- Любой асинхронный результат (RPC `.then`, `img.onload`, таймер), который пишет в
  `useState`/стор, обязан проверяться на актуальность через `@helpers/middleware`
  (вендор tweb 1:1) — React-адаптер `core/hooks/useMiddlewareHelper`. Паттерны:
  несколько независимых эффектов — дочерний scope `helper.get().create()` на прогон
  с `scope.destroy()` в cleanup; весь компонент — одна зона актуальности —
  `helper.get()` + `helper.clean()` в cleanup. Для await-цепочек —
  `@helpers/middlewarePromise` (бросает `{type:'MIDDLEWARE'}` после протухшего await).
- Ручные `alive`-флаги в новом коде не заводить; существующие мигрируют при
  ближайшем касании файла.
- Примитивы (`helpers/middleware.ts`, `helpers/middlewarePromise.ts`) — дословный
  tweb, не форкать; расширения — только тонкими адаптерами поверх.
```

- [ ] **Step 2: Commit** — `docs(claude): конвенция middleware для асинхронщины`

---

## Self-Review

- Покрытие: примитив (T1), порт (T2), адаптер (T3), все подтверждённые незащищённые места из аудита — Chat.tsx ×3 (T4), TopicsPanel/DatePicker + 2 пропущенных catch (T5), пагинация поиска (T6), замена bespoke-токена (T7), doubleRaf (T8), конвенция (T9). Места с уже существующим `alive` — сознательно вне скоупа (Global Constraints).
- `useHeaderMenuActions.toggleBlock` (command-путь по клику, пишет глобальный `blockedTotal`, не chat-scoped) — сознательно вне скоупа: результат валиден независимо от смонтированности вызвавшего меню.
- Типы: `useMiddlewareHelper` возвращает `MiddlewareHelper`; паттерны (а)/(б) в T4-T7 используют только `get`/`create`/`clean`/`destroy` из T1-пинов. Имена файлов свободны (проверено).
