// src/core/sendingParams.test.ts
//
// ПИН пакета параметров отправки (порт tweb `MessageSendingParams`,
// `core/managers/messages/sendingParams.ts`). Инвариант: КАЖДЫЙ путь отправки
// передаёт пакет целиком, а не дописывает `replyToId`/цитату/`silent`/эффект/
// send-as руками. Тогда новый путь физически не может «забыть» поле — оно
// приходит пакетом; а если кто-то всё же зовёт отправку в обход, это видно
// здесь.
//
// ЗАЧЕМ ИМЕННО СКАН, а не только поведенческие тесты. Поведенческий тест
// проверяет ТЕ пути, которые в нём перечислены; путь, добавленный завтра, он не
// увидит и промолчит. Ровно так и появилась дыра, которую закрывает эта задача:
// `replyToId` знал один текстовый путь, а десять остальных писались позже и
// просто не знали, что такое поле есть. Скан ловит именно это — «появился вызов
// отправки без пакета».
//
// Форма — по образцу `core/scrollWriters.test.ts` / `core/state/noAdHocReads.test.ts`:
// читаем исходники текстом (импорт ничего не скажет о ТОМ, как вызов записан).
// Список исключений ниже разобран поштучно; рост числа или новый файл в нём —
// осознанное решение, правь список руками, а не подгоняй код под тест.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

/**
 * Точки входа отправки — все методы, которые в итоге порождают сообщение.
 * `messages.sendText`/`sendFile` — кадр send_message (порт tweb
 * `sendText`/`sendFile`/`sendOther`); `sendPoll`/`sendGeoLive` — свои
 * REST-эндпоинты; `secret.*` — E2E-путь; `channels.post` — пост канала по REST.
 */
const ENTRY_POINTS = [
  'messages.sendText',
  'messages.sendFile',
  'messages.sendPoll',
  'messages.sendGeoLive',
  'secret.sendText',
  'secret.sendMedia',
  'channels.post',
]

/**
 * Вызовы отправки, которые пакет НЕ передают, — разобранные и обоснованные.
 * Путь относительно `src/` → ожидаемое число таких вызовов.
 */
const ALLOWED: Record<string, number> = {
  // Лог звонка (type 'call'): сервисная запись «звонок N минут», которую пишет
  // движок звонков по завершении соединения. Композера в этот момент может не
  // быть вовсе (звонок принимают из уведомления), плашки ответа — тем более;
  // отвечать логом звонка на сообщение нельзя ни в Telegram, ни у нас.
  'core/calls/callEngine.ts': 1,
  // Ответ на историю (Stories): уходит обычным сообщением в приватный чат
  // автора истории, из вьювера историй. Плашки ответа там нет, тредов нет,
  // send-as нет — собирать в пакет нечего.
  'core/hooks/useStoryViewer.ts': 1,
  // Пост канала: эндпоинт POST /channels/{id}/messages принимает ровно
  // {text, entities, client_msg_id} (backend channel_handler.go:65-71 →
  // PostToChannel с позиционной сигнатурой). Довести пакет = менять сигнатуру
  // usecase и её тест-вызовы — отдельная работа по бэкенду; плашку этот путь
  // при этом гасит (useChatSend.test.tsx).
  'core/hooks/useChatSend.ts': 1,
}

/** Аргументы вызова: от `(` до парной `)`. */
function callArgs(code: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return code.slice(openIdx + 1, i)
    }
  }
  return code.slice(openIdx)
}

describe('пакет параметров отправки: ни один путь не зовёт отправку в обход', () => {
  it('вызовы без пакета — только разобранные исключения', () => {
    const actual: Record<string, number> = {}
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      // Сам владелец пакета не сканируется: `pending.ts` — это и есть приёмник,
      // он пакет разбирает, а не передаёт.
      if (rel === 'core/managers/messages/pending.ts') continue
      const raw = readFileSync(file, 'utf8')
      // Комментарии — вон (в них имена методов упоминаются часто), пробелы
      // вокруг точек — тоже: цепочка `managers.messages\n  .sendPoll(` должна
      // читаться как один вызов.
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
        .replace(/\s*\.\s*/g, '.')

      let count = 0
      for (const ep of ENTRY_POINTS) {
        let from = 0
        for (;;) {
          const at = code.indexOf(`${ep}(`, from)
          if (at === -1) break
          from = at + ep.length
          if (!callArgs(code, at + ep.length).includes('sendingParams')) count++
        }
      }
      if (count > 0) actual[rel] = count
    }

    expect(actual).toEqual(ALLOWED)
  })

  // Вторая половина того же инварианта: пакет должен ДОХОДИТЬ до провода
  // целиком. Список полей здесь — не украшение: пропусти `sendingParamsToWire`
  // одно поле, и путь будет «передавать пакет», а поле молча не уедет (ровно
  // это годами происходило с `effect` — он был в SendArgs и не попадал в кадр).
  it('пакет разворачивается ровно в восемь проводных полей', async () => {
    const { sendingParamsToWire } = await import('./managers/messages/sendingParams')
    expect(Object.keys(sendingParamsToWire({})).sort()).toEqual([
      'effect', 'replyQuoteOffset', 'replyQuoteText', 'replyToId', 'replyToPeerId',
      'sendAsPeerId', 'silent', 'threadRootId',
    ])
  })
})
