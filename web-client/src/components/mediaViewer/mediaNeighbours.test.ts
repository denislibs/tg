// Пины постраничной догрузки соседей медиавьювера
// (`mediaViewer/mediaNeighbours.ts`).
//
// Предмет — НЕ форма вызова, а содержимое списка листания: сколько запросов
// ушло, какой курсор в них поехал и что оказалось в выданном срезе.
//
// Главный пин — «вставка сверху между страницами»: тот же сценарий, которым
// пагинация по курсору проверена на бэкенде (`messagesrepo` MediaHistory).
// Пока листали смещением (`offset = уже загружено`), новое медиа, приехавшее
// в чат между двумя запросами, сдвигало окно на единицу: вторая страница
// приходила с ДУБЛЕМ последнего элемента первой (или, при удалении, с ДЫРОЙ).
import { describe, it, expect } from 'vitest'
import { createMediaNeighboursLoader } from './mediaNeighbours'
import { generateMessageId, getServerMessageId } from '@core/history/messageId'
import type { MyMessage } from '@core/models'

const cid = generateMessageId

/** Сообщение — только то, что читает загрузчик: номер. */
const msg = (seq: number) => ({ id: cid(seq), peerId: 1 } as MyMessage)

/**
 * Серверная сторона ручки `/chats/{id}/media` в миниатюре: список newest-first
 * и выборка строго НИЖЕ курсора (`WHERE m.seq < $offset_id ORDER BY seq DESC`,
 * `messagesrepo.go`). Курсор приводится к СЕРВЕРНОМУ номеру ровно там же, где
 * его приводит менеджер (`getServerMessageId`), — иначе фейк отвечал бы не то,
 * что настоящая ручка. `seqs` живой: тест дописывает в него новое сообщение
 * между запросами.
 */
function fakeBackend(seqs: number[], pageSize: number) {
  const queries: number[] = []
  return {
    queries,
    fetchPage: async (offsetId: number, limit: number) => {
      queries.push(offsetId)
      expect(limit).toBe(pageSize)
      const seq = getServerMessageId(offsetId)
      const desc = [...seqs].sort((a, b) => b - a)
      const from = seq ? desc.filter((s) => s < seq) : desc
      return from.slice(0, limit).map(msg)
    },
  }
}

describe('mediaNeighbours: постраничная догрузка соседей', () => {
  it('первая страница идёт без курсора, следующая — по номеру последнего показанного', async () => {
    const be = fakeBackend([10, 9, 8, 7, 6, 5, 4, 3], 3)
    const loader = createMediaNeighboursLoader({ fetchPage: be.fetchPage, pageSize: 3 })

    // якорь во ВТОРОЙ странице → одна докрутка на поиск + докрутки под loadCount
    const older = await loader.neighbours(cid(7), true, 2)

    expect(be.queries[0]).toBe(0)
    expect(be.queries[1]).toBe(cid(8)) // курсор = последний элемент первой страницы
    expect(older.map((m) => m.id)).toEqual([cid(6), cid(5)])
  })

  it('вставка нового медиа СВЕРХУ между страницами не даёт ни дубля, ни пропуска', async () => {
    const seqs = [10, 9, 8, 7, 6, 5]
    const be = fakeBackend(seqs, 3)
    const loader = createMediaNeighboursLoader({ fetchPage: be.fetchPage, pageSize: 3 })

    // якоря нет в первой странице → она загрузится, потом придёт новое медиа,
    // и только после этого пойдёт запрос второй страницы
    const neighbours = loader.neighbours(cid(5), true, 3)
    await Promise.resolve()
    seqs.push(11) // новое сообщение в чате — оно встаёт ВВЕРХУ списка
    await neighbours

    const ids = loader.cached.map((m) => m.id)
    expect(ids).toEqual(Array.from(new Set(ids))) // дублей нет
    expect(ids).toEqual([cid(10), cid(9), cid(8), cid(7), cid(6), cid(5)]) // и дыр тоже
  })

  it('короткая страница закрывает список: лишних запросов больше нет', async () => {
    const be = fakeBackend([10, 9], 3)
    const loader = createMediaNeighboursLoader({ fetchPage: be.fetchPage, pageSize: 3 })

    await loader.neighbours(cid(10), true, 5)
    await loader.neighbours(cid(10), true, 5)

    expect(be.queries).toEqual([0])
  })

  it('якоря нет в фильтре media — срез пуст, а список дочитан до конца', async () => {
    const be = fakeBackend([10, 9], 3)
    const loader = createMediaNeighboursLoader({ fetchPage: be.fetchPage, pageSize: 3 })

    expect(await loader.neighbours(cid(99), true, 5)).toEqual([])
    expect(be.queries).toEqual([0])
  })

  it('в сторону новых курсор не крутится: срез берётся из уже загруженного', async () => {
    const be = fakeBackend([10, 9, 8, 7, 6, 5], 3)
    const loader = createMediaNeighboursLoader({ fetchPage: be.fetchPage, pageSize: 3 })

    const newer = await loader.neighbours(cid(9), false, 5)

    expect(be.queries).toEqual([0])
    expect(newer.map((m) => m.id)).toEqual([cid(10)])
  })
})
