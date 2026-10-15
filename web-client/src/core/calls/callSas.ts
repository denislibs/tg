// src/core/calls/callSas.ts
//
// Чистые функции проверки звонка 1:1 (Б-1, этап 1): коммитмент ключа и отпечатков DTLS,
// SAS-эмодзи от DH и обещанных отпечатков, сверка SDP с обещанным. Состояния нет — им владеет
// callEngine.
//
// Зачем отпечатки DTLS в SAS. В tweb сигналинг (SDP с a=fingerprint) шифруется ключом звонка
// (lib/calls/callInstance.ts:715-735), поэтому подмена отпечатка без ключа невозможна. У нас
// сигналинг до порта протокола tweb (этап 2) идёт открытым через сервер, и сервер мог бы
// подменить отпечатки в SDP — медиа, зашифрованное DTLS, ушло бы посреднику. Эмодзи, посчитанные
// и от DH, и от отпечатков обеих сторон, сводят подмену к несовпадению эмодзи у собеседников.
//
// Зачем коммитмент (tweb g_a_hash, callInstance.ts:554-563, проверка до SAS —
// callsController.ts:233-240). Отпечаток, выбранный ПОСЛЕ того, как стал известен чужой вклад,
// позволил бы посреднику перебрать сертификаты под нужные 4 эмодзи (24 бита, меньше секунды).
// Звонящий поэтому обещает пару «ключ + отпечатки» хешем до ответа, отвечающий свой набор
// называет в call_accept, а раскрытие звонящего проверяется по хешу.
import { b64FromBytes } from '../secret/crypto'

const enc = new TextEncoder()

export interface RawFingerprint { algorithm: string; value: string }

/** Канонический набор: `sha-256 AB:CD:…`, без повторов, по возрастанию. */
export function canonicalFingerprints(fps: RawFingerprint[]): string[] {
  const set = new Set(fps.map((f) => `${f.algorithm.toLowerCase()} ${f.value.toUpperCase()}`))
  return [...set].sort()
}

/** Набор из SDP (`a=fingerprint:` всех уровней), канонический. */
export function extractDtlsFingerprints(sdp: string): string[] {
  const out: RawFingerprint[] = []
  for (const m of sdp.matchAll(/^a=fingerprint:(\S+)\s+(\S+)\s*$/gim)) out.push({ algorithm: m[1], value: m[2] })
  return canonicalFingerprints(out)
}

const FP_LINE = /^[a-z0-9-]+ [0-9A-F]{2}(?::[0-9A-F]{2})*$/
const MAX_FPS = 8

/**
 * Набор отпечатков из чужого кадра. Только канонический вид (строки по формату SDP, по
 * возрастанию, без повторов): границы строк в склейке для хеша тогда однозначны, и посредник
 * не сдвинет их, подсунув в строку перевод строки или нулевой байт. Иначе `null`.
 */
export function parsePeerFingerprints(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FPS) return null
  for (const s of v) if (typeof s !== 'string' || !FP_LINE.test(s)) return null
  const fps = v as string[]
  for (let i = 1; i < fps.length; i++) if (fps[i - 1] >= fps[i]) return null
  return fps
}

export function sameFingerprints(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((s, i) => s === b[i])
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

/** base64(SHA-256(pub ‖ utf8(fps.join('\n')))) — коммитмент звонящего (tweb g_a_hash). */
export async function dhCommitment(pubRaw: Uint8Array, fps: string[]): Promise<string> {
  return b64FromBytes(await sha256(concat(pubRaw, enc.encode(fps.join('\n')))))
}

/** SAS: SHA-256(dhFp ‖ "call-sas-v1" ‖ fpsCaller ‖ 0x00 ‖ fpsCallee). */
export async function computeCallSas(dhFp: Uint8Array, callerFps: string[], calleeFps: string[]): Promise<Uint8Array> {
  return sha256(concat(
    dhFp, enc.encode('call-sas-v1'), enc.encode(callerFps.join('\n')), new Uint8Array([0]), enc.encode(calleeFps.join('\n')),
  ))
}

/**
 * Сертификат DTLS и его канонические отпечатки — всегда из SDP временного pc с этим
 * сертификатом (getFingerprints() не используется: он может вернуть отпечатки нескольких
 * алгоритмов, а браузер пишет в SDP один — точное сравнение со своим SDP падало бы на каждом
 * звонке). createOffer без setLocalDescription: кандидаты не собираются.
 */
export async function createDtlsIdentity(): Promise<{ cert: RTCCertificate; fps: string[] }> {
  const cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams)
  const tmp = new RTCPeerConnection({ certificates: [cert] })
  try {
    tmp.createDataChannel('x')
    const offer = await tmp.createOffer()
    const fps = extractDtlsFingerprints(offer.sdp ?? '')
    if (fps.length === 0) throw new Error('no DTLS fingerprint in SDP')
    return { cert, fps }
  } finally {
    tmp.close()
  }
}
