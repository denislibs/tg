// Два пина на таблицу конструкторов TL для клиента.
//
// 1. Дрейф. `src/lib/mtproto/schema.ts` — производная общей схемы, а не
//    рукописный файл. Правка руками разъехалась бы со схемой молча: кодек
//    читает ИМЕННО эту таблицу, и подправленный id означал бы, что мы
//    разбираем чужой объект, не заметив этого.
//
// 2. Согласие сторон провода. Тот же кодек напечатан на Go
//    (`backend/internal/pkg/tl/schema_gen.go`) из тех же файлов. Совпадение
//    правил проверяется не чтением двух генераторов глазами, а сравнением
//    напечатанного: у каждого конструктора Go-таблицы обязан быть двойник с
//    тем же id в таблице клиента.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { generateFromRepo, SCHEMA_TS_PATH } from './generate_tl_schema.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptsDir, '..', '..')

/** Конструкторы напечатанной таблицы клиента: predicate → id. */
function clientTable() {
  const src = readFileSync(SCHEMA_TS_PATH, 'utf8')
  const json = JSON.parse(src.slice(src.indexOf('export default ') + 'export default '.length, src.lastIndexOf(' as {')))
  return new Map(json.API.constructors.map((c) => [c.predicate, c.id]))
}

/** Конструкторы напечатанной таблицы Go: predicate → id. */
function goTable() {
  const src = readFileSync(join(repoRoot, 'backend', 'internal', 'pkg', 'tl', 'schema_gen.go'), 'utf8')
  return new Map(
    [...src.matchAll(/^\t\{ID: (-?\d+), Predicate: "([^"]+)"/gm)].map((m) => [m[2], Number(m[1])]),
  )
}

describe('TL: таблица конструкторов клиента', () => {
  it('src/lib/mtproto/schema.ts совпадает с тем, что печатает генератор', () => {
    expect(generateFromRepo()).toBe(readFileSync(SCHEMA_TS_PATH, 'utf8'))
  })

  it('id конструкторов совпадают с таблицей Go — обе стороны читают одно число', () => {
    const client = clientTable()
    const go = goTable()
    expect(go.size).toBeGreaterThan(1000) // разбор Go-таблицы не должен молча выродиться в пустоту
    const mismatched = []
    for (const [predicate, id] of go) {
      if (client.get(predicate) !== id) mismatched.push(`${predicate}: Go ${id}, клиент ${client.get(predicate)}`)
    }
    expect(mismatched).toEqual([])
  })

  it('наши собственные конструкторы попали в таблицу', () => {
    const client = clientTable()
    // Кадры, которых в схеме оригинала нет вовсе: без них клиент не разберёт
    // ни снимок карточки, ни «чат исчез».
    for (const predicate of ['updateChatFullSnapshot', 'updateChannelFullSnapshot', 'updateChatRemoved']) {
      expect(client.has(predicate), `${predicate} нет в таблице клиента`).toBe(true)
    }
  })

  it('клиентские псевдо-конструкторы (без id) на провод не попали', () => {
    const client = clientTable()
    const additional = JSON.parse(readFileSync(join(repoRoot, 'schema', 'schema_additional_params.json'), 'utf8'))
    const clientOnly = additional.filter((c) => c.type && c.id === undefined).map((c) => c.predicate)
    expect(clientOnly.length).toBeGreaterThan(0)
    for (const predicate of clientOnly) expect(client.has(predicate)).toBe(false)
  })
})
