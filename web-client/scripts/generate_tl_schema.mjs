// Печатает `src/lib/mtproto/schema.ts` — таблицу конструкторов TL для клиента.
//
// Зеркало `backend/cmd/tl-schemagen` (Go) на второй стороне провода: источник
// один и тот же (`schema/schema.json` + `schema/schema_additional_params.json`
// в корне репозитория), правило одно и то же, а результат — то, что кодек
// знает о конструкторах: числовой id, порядок параметров, их типы.
//
// Форма файла взята у оригинала БУКВАЛЬНО (`tweb/src/lib/mtproto/schema.ts`):
// два объявления типов, `export default {…}` одной строкой и хвост `as {…}`.
// Так `tl_utils` находит конструкторы тем же кодом, что и в оригинале, — по
// `Schema.API.constructors.find(...)`.
//
// Отличие от оригинала одно, и оно про НАШИ конструкторы: записи
// `schema_additional_params.json`, у которых есть `id`, дописываются в
// `API.constructors`. Это те объекты, которых в схеме оригинала нет вовсе
// (кадры-снимки, «чат исчез», ответ бота): на провод они идут, значит и id у
// них есть — назначенный явно. Записи без `id` — клиентские (на провод не
// идут) и в таблицу не попадают: их место в `layer.d.ts`.
//
// Числа приводятся к ЗНАКОВОМУ int32 — тем же преобразованием, что у
// `tweb/src/scripts/format_schema.js` (`uintToInt`): на проводе это те же
// четыре байта, а знаковая запись позволяет сравнивать id обычным `===`.
//
// Дрейф ловит пин `scripts/tlSchema.test.js`: файл печатается заново и
// сравнивается с закоммиченным.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

const HEADER = `export type MTProtoConstructor = {
  id: number,
  predicate: string,
  params: Array<{
    name: string,
    type: string
  }>,
  type: string
};

export type MTProtoMethod = {
  id: number,
  method: string,
  params: Array<{
    name: string,
    type: string
  }>,
  type: string
};

// eslint-disable-next-line quotes, comma-spacing
export default `

const FOOTER = ` as {
  MTProto: {
    constructors: MTProtoConstructor[],
    methods: MTProtoMethod[],
    constructorsIndex?: {[id: number]: number}
  },
  API: {
    constructors: MTProtoConstructor[],
    methods: MTProtoMethod[],
    constructorsIndex?: {[id: number]: number}
  },
  layer: number,
};
`

/** Порт `uintToInt` из tweb/src/scripts/format_schema.js. */
function uintToInt(value) {
  return value > 2147483647 ? value - 4294967296 : value
}

export function generateSchema(schemaJSON, additionalJSON) {
  const schema = JSON.parse(schemaJSON)
  const additional = JSON.parse(additionalJSON)

  for (const namespace of ['MTProto', 'API']) {
    for (const kind of ['constructors', 'methods']) {
      for (const item of schema[namespace][kind]) item.id = uintToInt(+item.id)
    }
  }

  // Наши конструкторы: `id` есть — значит объект идёт на провод.
  for (const c of additional) {
    if (c.id === undefined) continue
    schema.API.constructors.push({
      id: uintToInt(+c.id),
      predicate: c.predicate,
      params: (c.params ?? []).map((p) => ({ name: p.name, type: p.type })),
      type: c.type,
    })
  }

  return HEADER + JSON.stringify(schema) + FOOTER
}

/** Печатает файл из схем, лежащих в корне репозитория. */
export function generateFromRepo() {
  return generateSchema(
    readFileSync(join(repoRoot, 'schema', 'schema.json'), 'utf8'),
    readFileSync(join(repoRoot, 'schema', 'schema_additional_params.json'), 'utf8'),
  )
}

export const SCHEMA_TS_PATH = join(here, '..', 'src', 'lib', 'mtproto', 'schema.ts')

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = generateFromRepo()
  writeFileSync(SCHEMA_TS_PATH, out)
  console.log(`generate_tl_schema: ${SCHEMA_TS_PATH}, ${out.length} байт`)
}
