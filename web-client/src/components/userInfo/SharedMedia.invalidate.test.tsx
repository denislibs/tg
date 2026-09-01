// src/components/userInfo/SharedMedia.invalidate.test.tsx
//
// Панель «Общие медиа» использует ДЛИНУ ОКНА открытого чата как СИГНАЛ
// инвалидации своих вкладок: пришло/ушло сообщение — сбросить кэш страниц и
// перезагрузить активный таб, чтобы свежая отправка появилась сразу
// (`SharedMedia.tsx`, эффект по `winLen`).
//
// Пин заведён потому, что цена ошибки здесь МОЛЧАЛИВАЯ: если сигнал пропадёт
// (окно читается не оттуда, куда доезжают сообщения, — например из zustand-копии
// React-ленты после её сноса), панель не упадёт и ничего не залогирует — вкладки
// просто перестанут обновляться до переоткрытия профиля. Компиляции для этого
// мало, поэтому тест смотрит на ПОВЕДЕНИЕ: после появления сообщения в окне
// активный таб обязан сходить за первой страницей ЗАНОВО и показать новый ряд.
//
// Источник окна — зеркало `core/history/messagesMirror.ts`: именно в него
// приезжают операции воркера (`applyOpsToMirror`) и страницы истории, и именно
// его читает императивная лента.
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SharedMedia from './SharedMedia'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import { applyOpsToMirror, resetMessagesMirror, winKey } from '../../core/history/messagesMirror'
import { makeMessage } from '../../core/messages/testMessage'
import type { MyMessage } from '../../core/models'

const CHAT = 77
const ME = 1

const link = (id: number): MyMessage =>
  makeMessage({ id, peerId: CHAT, fromId: ME, text: `https://site-${id}.example/page`, date: 1_750_000_000 + id })

/** Страницы, которые сейчас отдаёт бэк по фильтру «Ссылки». */
let serverLinks: MyMessage[]
/** Запросы ПЕРВОЙ СТРАНИЦЫ таба (limit=30); зонды тоталов (limit=1) сюда не идут. */
let pageRequests: { filter: string; offset: number }[]

const managers = {
  messages: {
    mediaHistory: async (_chatId: number, filter: string, offset: number, limit: number) => {
      // Лёгкий зонд тоталов — по одному на каждый таб при открытии панели.
      if (limit === 1) return { messages: [], count: filter === 'links' ? serverLinks.length : 0 }
      pageRequests.push({ filter, offset })
      return { messages: serverLinks.slice(offset), count: serverLinks.length }
    },
  },
} as unknown as Managers

const urls = () => Array.from(document.querySelectorAll('.search-super-content-links .row-subtitle')).map((n) => n.textContent)
const pagesOfLinks = () => pageRequests.filter((r) => r.filter === 'links')

function mount() {
  return render(
    <ManagersProvider managers={managers}>
      <SharedMedia tab="SharedLinksTab2" onTab={() => {}} chatId={CHAT} />
    </ManagersProvider>,
  )
}

beforeEach(() => {
  resetMessagesMirror()
  serverLinks = [link(10)]
  pageRequests = []
})

afterEach(() => {
  cleanup()
  resetMessagesMirror()
  vi.restoreAllMocks()
})

describe('SharedMedia — окно чата как сигнал инвалидации вкладок', () => {
  it('новое сообщение в окне перезагружает активный таб с первой страницы', async () => {
    mount()
    await screen.findByText('https://site-10.example/page')
    expect(pagesOfLinks()).toEqual([{ filter: 'links', offset: 0 }])

    // Сообщение доехало до окна ТЕМ ЖЕ путём, что и в бою: операция воркера
    // (`rt:message_op` → `storeProjection` → `applyOpsToMirror`).
    serverLinks = [link(10), link(11)]
    await act(async () => {
      applyOpsToMirror([{ op: 'insert', key: winKey(CHAT), msg: link(11) }])
    })

    // Сигнал жив: кэш сброшен, таб перезапрошен с нуля и показал новый ряд.
    await waitFor(() => expect(urls()).toEqual([
      'https://site-10.example/page',
      'https://site-11.example/page',
    ]))
    expect(pagesOfLinks()).toEqual([
      { filter: 'links', offset: 0 },
      { filter: 'links', offset: 0 },
    ])
  })

  it('удаление из окна — тот же сигнал (длина изменилась в другую сторону)', async () => {
    serverLinks = [link(10), link(11)]
    mount()
    await waitFor(() => expect(urls()).toHaveLength(2))

    serverLinks = [link(10)]
    await act(async () => {
      applyOpsToMirror([{ op: 'insert', key: winKey(CHAT), msg: link(11) }])
    })
    await waitFor(() => expect(pagesOfLinks()).toHaveLength(2))
    await act(async () => {
      applyOpsToMirror([{ op: 'remove', key: winKey(CHAT), msgId: 11 }])
    })

    await waitFor(() => expect(pagesOfLinks()).toHaveLength(3))
    expect(urls()).toEqual(['https://site-10.example/page'])
  })

  it('изменение окна ЧУЖОГО чата вкладки не трогает', async () => {
    mount()
    await screen.findByText('https://site-10.example/page')

    await act(async () => {
      applyOpsToMirror([{ op: 'insert', key: winKey(CHAT + 1), msg: link(11) }])
    })

    // Дать эффектам шанс сработать — и убедиться, что перезагрузки не было.
    await act(async () => { await Promise.resolve() })
    expect(pagesOfLinks()).toEqual([{ filter: 'links', offset: 0 }])
  })
})
