// src/core/realtime/eventCatalog.ts
//
// ЕДИНЫЙ каталог WS-типов realtime — единственный источник правды. Раньше их было
// три рукописных списка, которые дрейфовали:
//   • FRAME_TYPES (connectionManager) — на что подписываться;
//   • PASS_THROUGH (worker) — эфемерные wsType → RT;
//   • APPLY (worker) — логируемые wsType (через funnel курсора).
// FRAME_TYPES отстал на 13 типов (dialog_mute/checklist_update/
// chat_update/folder_update/paid_media_unlock/balance_update + geo_live_update/
// suggested_post_update/bot_callback_answer/story_new/story_deleted/story_reaction) —
// а WsClient шлёт кадр ТОЛЬКО слушателям своего типа, поэтому эти кадры молча
// дропались. Теперь всё выводится отсюда:
//   FRAME_TYPES  = все ключи каталога (полный, не дрейфует);
//   PASS_THROUGH = {wsType: rt} для kind:'ephemeral';
//   LoggedWsType = ключи kind:'logged' (worker APPLY сверяется типом → пропуск
//                  логируемого типа = ошибка компиляции).
//
// kind:
//   'logged'    — идёт через funnel курсора (несёт pts); cache-фн — в worker APPLY.
//   'ephemeral' — без pts, прямая трансляция в RT (rt обязателен).
//   'bespoke'   — спец-обработка в onFrame / connectionManager (hello/pong/
//                 new_message-decrypt/секрет-handshake/обёртки звонков).

import { RT } from './events'

interface CatalogEntry { kind: 'logged' | 'ephemeral' | 'bespoke'; rt?: string }

export const EVENT_CATALOG = {
  // ── logged (funnel курсора; cache-фн — в worker APPLY) ──
  read:              { kind: 'logged' },
  media_read:        { kind: 'logged' },
  edit_message:      { kind: 'logged' },
  delete_message:    { kind: 'logged' },
  pin_message:       { kind: 'logged' },
  reaction:          { kind: 'logged' },
  factcheck_update:  { kind: 'logged' },
  chat_removed:      { kind: 'logged' },
  draft_update:      { kind: 'logged' },
  dialog_pin:        { kind: 'logged' },
  dialog_archive:    { kind: 'logged' },
  dialog_mute:       { kind: 'logged' },
  poll_update:       { kind: 'logged' },
  checklist_update:  { kind: 'logged' },
  giveaway_update:   { kind: 'logged' },
  boost_update:      { kind: 'logged' },
  chat_theme_update: { kind: 'logged' },
  chat_update:       { kind: 'logged' },
  folder_update:     { kind: 'logged' },
  web_page_update:   { kind: 'logged' },
  paid_media_unlock: { kind: 'logged' },
  balance_update:    { kind: 'logged' },
  user_update:       { kind: 'logged' },
  // ── ephemeral (без pts; прямая трансляция в RT) ──
  message_ack:           { kind: 'ephemeral', rt: RT.ack },
  message_error:         { kind: 'ephemeral', rt: RT.messageError },
  typing:                { kind: 'ephemeral', rt: RT.typing },
  presence:              { kind: 'ephemeral', rt: RT.presence },
  geo_live_update:       { kind: 'ephemeral', rt: RT.geoLiveUpdate },
  suggested_post_update: { kind: 'ephemeral', rt: RT.suggestedPost },
  bot_callback_answer:   { kind: 'ephemeral', rt: RT.botCallbackAnswer },
  story_new:             { kind: 'ephemeral', rt: RT.storyNew },
  story_deleted:         { kind: 'ephemeral', rt: RT.storyDeleted },
  story_reaction:        { kind: 'ephemeral', rt: RT.storyReaction },
  secret_chat_reject:    { kind: 'ephemeral', rt: RT.secretReject },
  // ── bespoke (спец-обработка в onFrame / connectionManager) ──
  hello:               { kind: 'bespoke' }, // {pts,date} — fast-reconnect gate
  pong:                { kind: 'bespoke' }, // heartbeat — гасится в connectionManager
  new_message:         { kind: 'bespoke' }, // E2E-decrypt перед funnel (см. onFrame)
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

export type WsType = keyof typeof EVENT_CATALOG
/** Типы, что идут через funnel курсора — worker APPLY обязан покрыть ровно их. */
export type LoggedWsType = { [K in WsType]: typeof EVENT_CATALOG[K]['kind'] extends 'logged' ? K : never }[WsType]

/** На что подписывается connectionManager (полный список — не дрейфует). */
export const FRAME_TYPES: string[] = Object.keys(EVENT_CATALOG)

/** Эфемерные wsType → RT-имя: worker транслирует как есть (без funnel). */
export const PASS_THROUGH: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_CATALOG)
    .filter(([, e]) => e.kind === 'ephemeral')
    .map(([t, e]) => [t, (e as { rt: string }).rt]),
)
