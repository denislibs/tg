/**
 * Отказ отправки — медленный режим (`SLOWMODE_WAIT_<N>`). Его уже объявил воркер
 * событием `rt:message_send_error` (попап «Медленный режим», tweb
 * `appImManager.ts:551-565`), поэтому общий тост ошибки поверх него не нужен:
 * tweb при пересылке и опросе его не показывает (`input.ts:4638-4649`).
 * Через границу worker-RPC `HttpError` доходит сообщением, а не классом.
 */
export default function isSlowModeWaitError(e: unknown): boolean {
  const text = (e as { type?: unknown, message?: unknown } | null)?.type ?? (e as { message?: unknown } | null)?.message
  return typeof text === 'string' && text.includes('SLOWMODE_WAIT')
}
