/* 206-стриминг DNP (§ PR-2b) — порт tweb serviceWorker/stream.ts 1:1 на plain-JS.
 * Classic script (importScripts в sw.js; SW не module-type). Определяет self.dnpStream.
 * Байты чанков берёт через инъектированный requestPart (мост PR-2a к SharedWorker). */
(function () {
  // MTProto: limit кратен 4КБ и делит 1МБ. Мобильный Safari не стартует большие
  // видео с чанками 512КБ → для >75МБ берём 1МБ.
  var STREAM_CHUNK_MIDDLE_LIMIT = 512 * 1024
  var STREAM_CHUNK_UPPER_LIMIT = 1024 * 1024
  var SMALLEST_CHUNK_LIMIT = 4 * 1024

  function parseRange(header) {
    if (!header) return [0, 0]
    var chunks = header.split('=')[1]
    var ranges = chunks.split(', ')
    var pair = ranges[0].split('-')
    return [+pair[0], +pair[1] || 0]
  }

  function alignOffset(offset, base) {
    base = base || SMALLEST_CHUNK_LIMIT
    return offset - (offset % base)
  }

  // Наименьшая степень двойки >= limit (без ошибки Math.log).
  function alignLimit(limit) {
    return limit <= 1 ? 1 : Math.pow(2, 32 - Math.clz32(limit - 1))
  }

  // Хак Safari: на первый probe-запрос [0,1] отдаём сфабрикованный 2-байтный 206
  // без обращения к сети — иначе Safari не начинает воспроизведение.
  function responseForSafariFirstRange(range, mime, size) {
    if (range[0] === 0 && range[1] === 1) {
      return new self.Response(new Uint8Array(2).buffer, {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes 0-1/' + (size || '*'),
          'Content-Length': '2',
          'Content-Type': mime || 'video/mp4',
        },
      })
    }
    return null
  }

  self.dnpStream = {
    parseRange: parseRange,
    alignOffset: alignOffset,
    alignLimit: alignLimit,
    responseForSafariFirstRange: responseForSafariFirstRange,
    _consts: { MIDDLE: STREAM_CHUNK_MIDDLE_LIMIT, UPPER: STREAM_CHUNK_UPPER_LIMIT, SMALLEST: SMALLEST_CHUNK_LIMIT },
  }
})()
