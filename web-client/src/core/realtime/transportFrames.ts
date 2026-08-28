// src/core/realtime/transportFrames.ts
//
// Кадры БЕЗ конструктора — те, что опознаются типом конверта, а не
// дискриминатором. Раньше здесь лежал каталог ВСЕХ WS-типов (48 штук) и был
// источником правды о кадрах; апдейты из него ушли в `updateCatalog.ts`, где
// ветвление идёт по `_`.
//
// Кадр попадает сюда по одной из двух причин, и они разные:
//
//   • ТРАНСПОРТ (решение Р6 разбора). `hello`, `pong`, `message_ack`,
//     `message_error`, хендшейк секретных чатов, обёртки звонков и трансляций
//     — не апдейты вовсе. У оригинала их роль играют слои MTProto
//     (`rpc_result`, `pong`, контейнеры), которых мы не портируем: у нас свой
//     транспорт. Апдейтами они не станут — это решение, а не долг.
//
//   • ПРЕДМЕТ НЕ ПОРТИРОВАН — долг с именем и номером: `folder_update` (#51,
//     ждёт порта самой папки), `geo_live_update`, `story_*`,
//     `suggested_post_update` (#52). Эти уйдут отсюда, когда появятся их
//     объекты.
//
// kind:
//   'logged'    — несёт курсор, идёт через воронку (сейчас ровно один —
//                 folder_update: конструктора нет, а pts есть);
//   'ephemeral' — без курсора, прямая трансляция в RT (rt обязателен);
//   'bespoke'   — спец-обработка в onFrame / connectionManager.

import { RT } from './events'

interface CatalogEntry { kind: 'logged' | 'ephemeral' | 'bespoke'; rt?: string }

export const TRANSPORT_FRAMES = {
  // ── предмет не портирован, но курсор кадр несёт (#51) ──
  folder_update: { kind: 'logged' },
  // ── предмет не портирован, курсора нет (#52) ──
  geo_live_update:       { kind: 'ephemeral', rt: RT.geoLiveUpdate },
  suggested_post_update: { kind: 'ephemeral', rt: RT.suggestedPost },
  // ── транспорт (решение Р6) ──
  message_ack:         { kind: 'ephemeral', rt: RT.ack },
  message_error:       { kind: 'ephemeral', rt: RT.messageError },
  secret_chat_reject:  { kind: 'ephemeral', rt: RT.secretReject },
  hello:               { kind: 'bespoke' }, // {pts,date} — fast-reconnect gate
  pong:                { kind: 'bespoke' }, // heartbeat — гасится в connectionManager
  secret_chat_request: { kind: 'bespoke' },
  secret_chat_accept:  { kind: 'bespoke' },
  call_request:        { kind: 'bespoke' },
  call_accept:         { kind: 'bespoke' },
  call_decline:        { kind: 'bespoke' },
  call_end:            { kind: 'bespoke' },
  call_signal:         { kind: 'bespoke' },
  group_call_update:   { kind: 'bespoke' },
  group_call_signal:   { kind: 'bespoke' },
  livestream_update:   { kind: 'bespoke' },
} as const satisfies Record<string, CatalogEntry>

export type TransportFrameType = keyof typeof TRANSPORT_FRAMES

/**
 * Единственный кадр, который несёт курсор, но конструктора не имеет.
 *
 * Назван константой, а не строкой по месту, потому что это ВРЕМЕННОЕ
 * исключение с номером (#51): пока у папки нет предмета в модели, кадр
 * опознаётся типом конверта и проходит воронку по нему.
 */
export const LOGGED_WITHOUT_CONSTRUCTOR = 'folder_update'

/** Эфемерные wsType → RT-имя: воркер транслирует как есть (без воронки). */
export const PASS_THROUGH: Record<string, string> = Object.fromEntries(
  Object.entries(TRANSPORT_FRAMES)
    .filter(([, e]) => e.kind === 'ephemeral')
    .map(([t, e]) => [t, (e as { rt: string }).rt]),
)
