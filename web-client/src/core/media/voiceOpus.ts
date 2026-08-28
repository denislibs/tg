// Чтение голосового на платформе, которая ogg не играет: байты файла → wav.
//
// Порт гейта tweb `apiFileManager.ts:670`:
//
//     } else if(mimeType === 'audio/ogg' && !getEnvironment().IS_OPUS_SUPPORTED) {
//       process = this.convertOpus;
//       mimeType = 'audio/wav';
//     }
//
// — то есть решение принимается ПО MIME СКАЧАННОГО ФАЙЛА, а не по типу бабла, и
// принимается ОДИН раз на скачивании, до того как байты попадут в `<audio>`.
// Здесь так же: единственный вход — `voicePlaybackUrl`, его зовёт
// `core/audio/mediaPlaybackController.ts::ensureSrc` вместо обычного URL.
//
// ── Где это отличается от оригинала ─────────────────────────────────────────
//  • У tweb гейт стоит в САМОМ скачивании (`apiFileManager.download`), поэтому
//    конвертированные байты получает любой потребитель файла. У нас `<audio>`
//    обычно СТРИМИТ медиа с сервера (`resolveStreamUrl`) и байтов не трогает
//    вовсе, так что общей точки «файл скачан» для него нет — гейт живёт у
//    единственного потребителя, которому конвертация нужна, у плеера.
//  • Байты берём воркерным конвейером `downloadMediaURL` — это и есть наш
//    аналог `apiFileManager.download`: кэш-контекст → корзина `cachedFiles` →
//    objectURL, он же знает про DNP-канал и не качает файл второй раз, когда
//    бабл уже мелькал в ленте. Ходим через ЕДИНСТВЕННУЮ ванильную точку входа
//    (`ensureMediaUrl`), а не к менеджеру напрямую: прямой вызов не пишет
//    полученный URL в зеркало и теряет снимок владельца для остальных
//    потребителей того же id (пин — `core/noDuplicateMediaUrl.test.ts`).
import { startClient } from '../../client/bootstrap'
import opusDecodeController from '../audio/opusDecodeController'
import { ensureMediaUrl } from './ensureMediaUrl'

/** Контейнер голосового (`core/media/messageMedia.ts::MIME_OGG`, порт
 *  `appDocsManager.saveDoc:157`): ровно он делает документ голосовым и ровно он
 *  же не играется в WebKit ниже 18.4. */
const MIME_OGG = 'audio/ogg'

/** Только контейнер: сервер хранит mime отправителя, а тот может нести
 *  `;codecs=opus`. Тот же сброс параметров, что при отправке
 *  (`core/hooks/useVoiceRecorder.ts::containerMime`, порт `nativeVideoRecorder.ts:258-261`). */
const containerMime = (mime: string | undefined): string => (mime ?? '').split(';')[0].trim()

/** ФОРМАТНАЯ половина условия оригинала (`mimeType === 'audio/ogg'`). Вторая,
 *  платформенная (`!IS_OPUS_SUPPORTED`), стоит У ВЫЗЫВАЮЩЕГО и ровно в одном
 *  месте — `mediaPlaybackController.ensureSrc`: проверять её здесь означало бы
 *  спрашивать у воркера mime КАЖДОГО трека и там, где конвертация не нужна
 *  никогда, то есть терять синхронную подачу src у 97% пользователей. */
export function isOggContainer(mime: string | undefined): boolean {
  return containerMime(mime) === MIME_OGG
}

// Один и тот же файл открывают несколько баблов (лента + плашка плеера + поиск),
// а декодирование стоит воркера с libopus — держим готовый URL по id.
// Отзываются они не здесь, а сменой сессии (`resetPlayback`): бабл может
// перемонтироваться, и revoke на его размонтировании отдал бы следующему
// потребителю мёртвый URL.
const wavUrls = new Map<number, string>()
const inflight = new Map<number, Promise<string | undefined>>()

/** Расшифрованные байты секретного голосового (E2E) — файла на сервере нет, его
 *  плейнтекст уже на руках у вызывающего. */
export async function oggBytesToWavUrl(bytes: Uint8Array): Promise<string> {
  const { url } = await opusDecodeController.decode(bytes)
  return url
}

/**
 * URL для `<audio>`, если файл — ogg, а платформа его не играет; `undefined`,
 * если конвертировать нечего (обычный путь остаётся за вызывающим).
 */
export function voicePlaybackUrl(mediaId: number): Promise<string | undefined> {
  const ready = wavUrls.get(mediaId)
  if (ready) return Promise.resolve(ready)

  const running = inflight.get(mediaId)
  if (running) return running

  const job = (async () => {
    const meta = await startClient().managers.media.meta(mediaId)
    if (!isOggContainer(meta.mime)) return undefined

    const src = await ensureMediaUrl(mediaId)
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer())
    const url = await oggBytesToWavUrl(bytes)
    wavUrls.set(mediaId, url)
    return url
  })()

  inflight.set(mediaId, job)
  void job.catch(() => {}).finally(() => { inflight.delete(mediaId) })
  return job
}

/** Смена сессии (`mediaPlaybackController.resetPlayback`) — блобы прошлой
 *  сессии отзываем вместе с остальными. */
export function resetVoiceOpusCache(): void {
  wavUrls.forEach((url) => URL.revokeObjectURL(url))
  wavUrls.clear()
  // Склейку снимаем вместе с кэшем: летящая конвертация запрошена ПРОШЛОЙ
  // сессией, и отдавать её результат новой нельзя — иначе следующий потребитель
  // того же id получит уже отозванный URL вместо свежего.
  inflight.clear()
}
