// Worker-сторона SW↔SharedWorker моста (§ PR-2a). SW шлёт file_part по MessagePort —
// отвечаем байтами из DNP-канала (fileDownload) + total для Content-Range. Окно (PR-2c)
// раздаёт концы MessageChannel; после handoff окно вне пути данных.

export interface PartSource {
  fetchFilePartWithTotal(mediaId: number, offset: number, limit: number): Promise<{ bytes: Uint8Array; total: number }>
}

// Минимальная форма MessagePort (postMessage с transfer + onmessage).
export interface BridgePort {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent) => void) | null
}

interface FilePartReq { t: 'file_part'; reqId: number; mediaId: number; offset: number; limit: number }

// attachStreamBridge — вешает обработчик file_part на порт: тянет чанк из канала и
// отвечает file_part_ok (buffer передаётся transferable) либо file_part_err.
export function attachStreamBridge(port: BridgePort, src: PartSource): void {
  port.onmessage = async (ev: MessageEvent) => {
    const d = ev.data as Partial<FilePartReq> | null
    if (!d || d.t !== 'file_part' || typeof d.reqId !== 'number') return
    const { reqId, mediaId, offset, limit } = d as FilePartReq
    try {
      const { bytes, total } = await src.fetchFilePartWithTotal(mediaId, offset, limit)
      // .slice() → отдельный ArrayBuffer (bytes может быть subarray-вью канала);
      // его и передаём transferable, чтобы не копировать при переходе SW-границы.
      const copy = bytes.slice()
      port.postMessage({ t: 'file_part_ok', reqId, bytes: copy, total }, [copy.buffer])
    } catch (e) {
      port.postMessage({ t: 'file_part_err', reqId, error: e instanceof Error ? e.message : String(e) })
    }
  }
}
