/* SW-сторона DNP-моста (§ PR-2a): корреляция file_part↔file_part_ok по reqId поверх
 * MessagePort к SharedWorker (где fileDownload тянет байты из Noise-канала). Classic
 * script — грузится в sw.js через importScripts (SW не module-type). Определяет
 * self.createDnpBridge. */
(function () {
  var BRIDGE_TIMEOUT_MS = 45000
  self.createDnpBridge = function () {
    var port = null
    var seq = 0
    var pending = new Map() // reqId → { resolve, reject, timer }

    function onMessage(ev) {
      var d = ev.data
      if (!d || typeof d.reqId !== 'number') return
      var p = pending.get(d.reqId)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(d.reqId)
      if (d.t === 'file_part_ok') p.resolve({ bytes: d.bytes, total: d.total })
      else if (d.t === 'file_part_err') p.reject(new Error(d.error || 'file_part error'))
    }

    return {
      setPort: function (p) {
        port = p
        port.onmessage = onMessage
      },
      // requestPart(mediaId, offset, limit) → Promise<{bytes, total}>.
      requestPart: function (mediaId, offset, limit) {
        var reqId = (seq = (seq + 1) >>> 0)
        return new Promise(function (resolve, reject) {
          if (!port) { reject(new Error('bridge: no port')); return }
          var timer = setTimeout(function () {
            pending.delete(reqId)
            reject(new Error('bridge timeout'))
          }, BRIDGE_TIMEOUT_MS)
          pending.set(reqId, { resolve: resolve, reject: reject, timer: timer })
          port.postMessage({ t: 'file_part', reqId: reqId, mediaId: mediaId, offset: offset, limit: limit })
        })
      },
    }
  }
})()
