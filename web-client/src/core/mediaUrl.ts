// Synchronous media-URL builder for the MAIN thread.
//
// The media manager (and its token) live in the worker, so building a media URL
// the normal way (managers.media.contentUrl) is an async RPC round-trip — doing
// that per <img> on mount is what made the feed jitter. Instead the short-lived
// media token is mirrored here and URLs are built synchronously during render.
//
// Stage 1C.2 (Task 3): владелец токена — воркер (core/managers/mediaManager.ts),
// там же ЕДИНСТВЕННОЕ расписание обновления — перезапрос за минуту до истечения
// с публикацией всем вкладкам (rt:media_token → client/realtime/storeProjection
// → applyMediaToken). Здесь только зеркало: хранит присланное, отдаёт синхронно,
// будит подписчиков (useMediaTokenVersion), чтобы медиа-баблы пересобрали URL
// со свежим токеном — иначе истёкший дал бы 401 и застрявший плейсхолдер.
// Своего таймера у зеркала нет; пин на это — core/noDuplicateMediaToken.test.ts.
// Единственное, что зеркало решает само, — годится ли удержанный снимок для
// сборки URL прямо сейчас (URL_SAFETY_MARGIN ниже): это защита от потерянного
// кадра обновления, а не второе расписание.
//
// Второй кадр владельца, который зеркало обязано применить, — уход активной
// сессии (rt:logging_out → resetMediaToken): токен подписан на id пользователя
// и живёт до 15 минут, поэтому пережить переход он не может ни у владельца, ни
// здесь.
//
// Task 6/7 (медиа-суперпорт, стадия C): картинки ПЕРЕЕХАЛИ с токенного URL на
// rt:media_url/downloadMediaURL — objectURL из воркерного конвейера
// (mediaManager) с зеркалом в core/mediaCache.ts (потребление —
// core/hooks/useMediaUrl). Токен-механизм остаётся СТРИМУ и БАЙТАМ:
// <video>/<audio> при DNP-OFF (resolveStreamUrl ниже, инлайн-автоплей
// RealMediaBubble), байтовые fetch'и (StickerMedia, waveform,
// mediaPlaybackController, secret/mediaCache, DocRow). mediaThumbUrl удалён —
// превью-картинок на токене больше нет.
import { useSyncExternalStore } from 'react'
import { startClient } from '../client/bootstrap'
import { AppConfig } from '../config/app'
import type { MediaTokenInfo } from './managers/mediaManager'

const API_BASE = '/api' // mirrors the worker's RestClient base
let token = ''
let expiresAt = 0
let version = 0
let priming: Promise<void> | null = null
// Поколение сессии зеркала: растёт на каждом resetMediaToken(). Ответ на уже
// улетевший tokenInfo() принадлежит той сессии, под которой запрос ушёл (см.
// primeMediaToken).
let gen = 0
const subs = new Set<() => void>()

function notify() {
  version++
  subs.forEach((f) => f())
}

// Применить снимок, посчитанный владельцем: событие rt:media_token или ответ
// tokenInfo(). На холодном старте один и тот же снимок приезжает обоими путями
// (RPC-ответом и бродкастом того же запроса) — повторное применение подписчиков
// не будит, иначе каждый медиа-бабл перерисовывался бы вхолостую.
export function applyMediaToken(t: MediaTokenInfo): void {
  if (t.token === token && t.expiresAt === expiresAt) return
  token = t.token
  expiresAt = t.expiresAt
  notify()
}

// Активная сессия сменилась (кадр rt:logging_out — единственный вызывающий,
// client/realtime/storeProjection.ts). Владелец свой токен уже выбросил, но
// зеркало он не спрашивает: оно отдаёт снимок синхронно на рендере, пока тот
// годен, — то есть без этого сброса вкладка продолжала бы строить URL ключом
// прошлого пользователя (токен подписан на его id и живёт до 15 минут).
// Пробуждение подписчиков здесь обязательно: медиа-баблы пересобирают src, а
// заодно их подписка сама идёт к владельцу за токеном текущей сессии
// (useMediaTokenVersion) — «застрять на подложке» им не даёт именно оно.
export function resetMediaToken(): void {
  token = ''
  // Летящий ответ владельца был запрошен ПРОШЛОЙ сессией — обесцениваем его
  // (иначе он приземлится уже после сброса) и снимаем склейку, чтобы
  // следующий потребитель начал новый запрос, а не ждал мёртвого.
  gen++
  priming = null
  notify()
}

// Окно безопасности зеркала. Это НЕ второе расписание: «пора ли обновлять»
// решает только воркер (mediaManager::TOKEN_MARGIN), здесь другой вопрос —
// «переживёт ли собранный URL свой полёт до сервера». Запас нужен ровно на
// случай, когда кадр обновления ПОТЕРЯЛСЯ и владелец о зеркале уже не позаботится:
//  - плановый перезапрос владельца упал: он переарминает таймер только на успехе,
//    так что второй попытки не будет, и снимок на руках доживает до истечения;
//  - вкладка спраймила токен, но насос smp → rootScope у неё не поднят — под
//    passcode-локом `startRealtime()` отложен `runWhenUnlocked`, и все публикации
//    этого времени мимо неё.
// Без запаса `hasMediaToken()` в такой ситуации скажет «да» токену, которому
// осталась секунда, URL уйдёт в полёт и вернётся 401 — застрявший плейсхолдер,
// то есть ровно тот симптом, который задача обязана исключить.
// Значение совпадает с воркерным намеренно, и петли из-за этого нет: предикаты
// одинаковые, а зеркало вычисляет свой РАНЬШЕ (t1), чем владелец свой (t2 > t1),
// — если стало несвежо у зеркала, у владельца тем более, и он идёт в сеть за
// НОВЫМ токеном. Прежний код петлю как раз давал: там пороги разъезжались
// (витрина 90 с против воркера 60 с), владелец отвечал «ещё свежий» и отдавал
// тот же снимок — 30 секунд опроса каждые 5 с. Импортировать константу из
// mediaManager нельзя: это воркерный модуль, value-import затащил бы его в
// главный бандл.
const URL_SAFETY_MARGIN = 60_000
export const hasMediaToken = (): boolean => !!token && Date.now() < expiresAt - URL_SAFETY_MARGIN

// Запросить токен у владельца: холодный старт, вторая вкладка (у живого воркера
// он уже есть — приедет ответом RPC, не следующим обновлением) и восстановление
// после 401 (`force`, из onError медиа-элемента). НЕ расписание: обновляет
// воркер сам.
export function primeMediaToken(force = false): Promise<void> {
  if (!force && hasMediaToken()) return Promise.resolve()
  if (priming) return priming
  const g = gen
  const p = startClient().managers.media
    .tokenInfo()
    .then((t) => { if (g === gen) applyMediaToken(t) })
    .finally(() => { if (g === gen) priming = null })
  priming = p
  return p
}

export function mediaContentUrl(id: number): string {
  if (!hasMediaToken()) void primeMediaToken()
  return `${API_BASE}/media/${id}/content?token=${encodeURIComponent(token)}`
}

// Разрешить URL медиа для не-render одноразовых нужд (аудио, waveform): синхронно
// при свежем токене (важно, чтобы назначить src в рамках user-gesture), иначе один
// async-RPC к media-менеджеру. Инкапсулирует доступ к воркеру здесь, чтобы сторам/
// хелперам не тянуть startClient напрямую.
export function resolveMediaContentUrl(id: number): string | Promise<string> {
  return hasMediaToken() ? mediaContentUrl(id) : startClient().managers.media.contentUrl(id)
}

// Как resolveMediaContentUrl, но для стримового медиа (<video>/<audio>): при DNP-ON
// уводит на /dnp-stream/{id} (SW-206 из Noise-канала). При DNP-off — прежнее
// поведение (синхронный token-URL в рамках жеста, где можно).
export function resolveStreamUrl(id: number): string | Promise<string> {
  if (AppConfig.dnp.enabled) return startClient().managers.media.streamUrl(id)
  return resolveMediaContentUrl(id)
}

// Не-React подписка на смену токена — по образцу subscribeMediaUrlMirror
// (core/mediaCache.ts). Нужна императивному <video>/<audio>: стрим при DNP-OFF
// живёт на токенном URL (resolveStreamUrl), токен протухает за 15 минут, и без
// пересборки src открытый в ленте бабл получил бы 401 на середине буфера.
//
// Запрос токена ЖИВЁТ ЗДЕСЬ, а не только в mediaContentUrl, и это не
// дублирование: потребитель, который гейтится на hasMediaToken() и при «нет»
// рисует подложку, mediaContentUrl вообще не зовёт — единственный, кто в этом
// состоянии идёт к владельцу, сама подписка (см. пин core/mediaUrl.test.ts).
export function subscribeMediaToken(cb: () => void): () => void {
  subs.add(cb)
  if (!hasMediaToken()) void primeMediaToken()
  return () => { subs.delete(cb) }
}

// Subscribe a component to token updates so it re-renders with a fresh URL.
// Returns a version number that changes whenever the worker publishes a new token.
export function useMediaTokenVersion(): number {
  return useSyncExternalStore(subscribeMediaToken, () => version)
}
