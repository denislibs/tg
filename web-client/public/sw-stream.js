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

  // Конкат Uint8Array'ов (порт bufferConcats).
  function concatBytes(parts) {
    var len = 0
    for (var i = 0; i < parts.length; i++) len += parts[i].length
    var out = new Uint8Array(len)
    var at = 0
    for (var j = 0; j < parts.length; j++) { out.set(parts[j], at); at += parts[j].length }
    return out
  }

  // createStreamHandler(requestPart) → { handleStreamFetch(request) }. requestPart —
  // мост PR-2a: (mediaId, offset, limit) → Promise<{bytes, total}>.
  function createStreamHandler(requestPart) {
    async function handleStreamFetch(request) {
      var url = new URL(request.url)
      var mediaId = +url.pathname.split('/').pop()
      var size = +url.searchParams.get('size') || 0
      var mime = url.searchParams.get('mime') || ''

      var range = parseRange(request.headers.get('Range'))
      var safari = responseForSafariFirstRange(range, mime, size)
      if (safari) return safari

      var offset = range[0]
      var end = range[1]
      var limitPart = size > 75 * 1024 * 1024 ? STREAM_CHUNK_UPPER_LIMIT : STREAM_CHUNK_MIDDLE_LIMIT
      var limit = end && end < limitPart
        ? Math.max(SMALLEST_CHUNK_LIMIT, alignLimit(end - offset + 1))
        : limitPart
      var alignedOffset = alignOffset(offset, limit)
      if (!end) end = Math.min(offset + limit, size - 1)

      var misaligned = offset !== alignedOffset || end !== alignedOffset + limit
      var overflow = misaligned ? end - alignedOffset - limit + 1 : 0

      var results = await Promise.all([
        requestPart(mediaId, alignedOffset, limit),
        overflow > 0 ? requestPart(mediaId, alignedOffset + limit, limit) : null,
      ])
      var parts = []
      for (var i = 0; i < results.length; i++) if (results[i]) parts.push(results[i].bytes)
      var ab = concatBytes(parts)

      if (misaligned) ab = ab.slice(offset - alignedOffset, end - alignedOffset + 1)

      var headers = {
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes ' + offset + '-' + (offset + ab.byteLength - 1) + '/' + (size || '*'),
        'Content-Length': '' + ab.byteLength,
      }
      if (mime) headers['Content-Type'] = mime
      return new self.Response(ab, { status: 206, statusText: 'Partial Content', headers })
    }
    return { handleStreamFetch: handleStreamFetch }
  }

  self.dnpStream = {
    parseRange: parseRange,
    alignOffset: alignOffset,
    alignLimit: alignLimit,
    responseForSafariFirstRange: responseForSafariFirstRange,
    createStreamHandler: createStreamHandler,
    _consts: { MIDDLE: STREAM_CHUNK_MIDDLE_LIMIT, UPPER: STREAM_CHUNK_UPPER_LIMIT, SMALLEST: SMALLEST_CHUNK_LIMIT },
  }
})()
