// Worker-сторона SW↔SharedWorker моста (§ PR-2a). SW шлёт file_part по MessagePort —
// отвечаем байтами из DNP-канала (fileDownload) + total для Content-Range. Окно (PR-2c)
// раздаёт концы MessageChannel; после handoff окно вне пути данных.

export interface PartSource {
  fetchFilePartWithTotal(mediaId: number, offset: number, limit: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; total: number }>
}

// Минимальная форма MessagePort (postMessage с transfer + onmessage).
export interface BridgePort {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent) => void) | null
}

interface FilePartReq { t: 'file_part'; reqId: number; mediaId: number; offset: number; limit: number }
interface FilePartCancel { t: 'file_part_cancel'; reqId: number }

// attachStreamBridge — вешает обработчик file_part/file_part_cancel на порт: тянет чанк
// из канала и отвечает file_part_ok (buffer передаётся transferable) либо file_part_err.
// file_part_cancel абортит AbortController, заведённый для reqId при file_part (SW снял
// диапазон / читатель Response отменён) — снимает in-flight file_req на worker-стороне.
export function attachStreamBridge(port: BridgePort, src: PartSource): void {
  const inflight = new Map<number, AbortController>()
  port.onmessage = async (ev: MessageEvent) => {
    const d = ev.data as (Partial<FilePartReq> & Partial<FilePartCancel>) | null
    if (!d || typeof d.reqId !== 'number') return
    if (d.t === 'file_part_cancel') {
      const ac = inflight.get(d.reqId)
      if (ac) { ac.abort(); inflight.delete(d.reqId) }
      return
    }
    if (d.t !== 'file_part') return
    const { reqId, mediaId, offset, limit } = d as FilePartReq
    const ac = new AbortController()
    inflight.set(reqId, ac)
    try {
      const { bytes, total } = await src.fetchFilePartWithTotal(mediaId, offset, limit, ac.signal)
      // .slice() → отдельный ArrayBuffer (bytes может быть subarray-вью канала);
      // его и передаём transferable, чтобы не копировать при переходе SW-границы.
      const copy = bytes.slice()
      port.postMessage({ t: 'file_part_ok', reqId, bytes: copy, total }, [copy.buffer])
    } catch (e) {
      port.postMessage({ t: 'file_part_err', reqId, error: e instanceof Error ? e.message : String(e) })
    } finally {
      inflight.delete(reqId)
    }
  }
}
