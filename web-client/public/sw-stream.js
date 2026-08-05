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

  // --- Chromium mp4-патч (порт helpers/fixChromiumMp4.ts 1:1) ------------------
  // Chromium (crbug 1250841) не проигрывает некоторые mp4 с определённым AAC-esds;
  // чиним DecoderSpecificInfo на рабочий. Патчим по чанкам — успех лишь в чанке с esds.
  function bytesFromHex(h) {
    var len = h.length, bytes = new Uint8Array(Math.ceil(len / 2)), start = 0
    if (len % 2) bytes[start++] = parseInt(h.charAt(0), 16)
    for (var i = start; i < len; i += 2) bytes[start++] = parseInt(h.substr(i, 2), 16)
    return bytes
  }
  function bytesCmp(a, b) {
    if (a.length !== b.length) return false
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  var BROKEN_DSCI = [0x13, 0x88]
  var FIXED_ESDS = bytesFromHex('0327000100041940150000000001f4000000bb750507138856e5a5')
  var ESDS = new TextEncoder().encode('esds')
  var MP4A = new TextEncoder().encode('mp4a')

  function readLengthField(buf, offset) {
    var length = 0, size = 0
    for (var i = 0; i < 4; i++) {
      var byte = buf[offset + i]
      length = (length << 7) + (byte & 0x7f)
      size++
      if ((byte & 0x80) === 0) break
    }
    return [size, length]
  }
  function parseDecoderSpecificInfo(buf) {
    if (buf[0] !== 0x05) throw new Error('Invalid DecoderSpecificInfo tag')
    var lf = readLengthField(buf, 1)
    var offset = 1 + lf[0]
    return buf.subarray(offset, offset + lf[1])
  }
  function parseDecoderConfigDescriptor(buf) {
    if (buf[0] !== 0x04) throw new Error('Invalid DecoderConfigDescriptor tag')
    var lf = readLengthField(buf, 1)
    var offset = 1 + lf[0]
    offset += 1 + 1 + 3 + 4 + 4 // oti + flags + bufferSizeDB + maxBitRate + avgBitRate
    return parseDecoderSpecificInfo(buf.subarray(offset))
  }
  function parseES_Descriptor(buf) {
    if (buf[0] !== 0x03) throw new Error('Invalid ES_Descriptor tag')
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    var lf = readLengthField(buf, 1)
    var offset = 1 + lf[0]
    offset += 2 // ES_ID
    var flags = dv.getUint8(offset)
    offset += 1
    if (flags & 0x80) offset += 2               // streamDependenceFlag
    if (flags & 0x40) {                          // URL_Flag
      var ul = readLengthField(buf, offset)
      offset += 1 + ul[0] + ul[1]
    }
    return { decoderConfigDescriptor: parseDecoderConfigDescriptor(buf.subarray(offset)) }
  }
  function findUint8ArrayBack(buf, needle, start) {
    if (start === undefined) start = buf.length
    for (var i = start - needle.length; i >= 0; i--) {
      var found = true
      for (var j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { found = false; break }
      if (found) return i
    }
    return -1
  }
  function fixMp4ForChromium(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    var pos = u8.length, found = null
    while (true) {
      var esdsOffset = findUint8ArrayBack(u8, ESDS, pos)
      if (esdsOffset === -1) break
      pos = esdsOffset
      var esdsSize = dv.getUint32(esdsOffset - 4)
      if (esdsSize < 0 || esdsOffset + esdsSize > u8.length) continue
      var mp4aOffset = findUint8ArrayBack(u8, MP4A, esdsOffset)
      if (mp4aOffset === -1 || esdsOffset - mp4aOffset > 100) continue
      found = { offset: esdsOffset + 8, size: esdsSize - 12 }
    }
    if (!found) throw new Error('No ESDS found')
    var esds = u8.subarray(found.offset, found.offset + found.size)
    var parsed = parseES_Descriptor(esds)
    if (!parsed) throw new Error('Invalid ESDS')
    if (!bytesCmp(parsed.decoderConfigDescriptor, BROKEN_DSCI)) throw new Error('Not a broken DSCI')
    if (found.size < FIXED_ESDS.length) throw new Error('ESDS Size not enough')
    u8.set(FIXED_ESDS, found.offset)
  }
  function tryPatchMp4(u8) {
    try { fixMp4ForChromium(u8); return true } catch (e) { return false }
  }

  // createStreamHandler(requestPart) → { handleStreamFetch(request) }. requestPart —
  // мост PR-2a: (mediaId, offset, limit) → Promise<{bytes, total}>.
  function createStreamHandler(requestPart) {
    async function handleStreamFetch(request) {
      var url = new URL(request.url)
      var mediaId = +url.pathname.split('/').pop()
      var size = +url.searchParams.get('size') || 0
      var mime = url.searchParams.get('mime') || ''
      var armMp4 = url.searchParams.get('mp4fix') === '1'

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

      if (armMp4) {
        // ab может быть вью-срезом чанка; tryPatchMp4 мутирует на месте — по копии,
        // чтобы не портить исходный буфер/чужие вью (в tweb буфер уже свой; у нас defensive).
        ab = ab.slice()
        tryPatchMp4(ab)
      }

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
    tryPatchMp4: tryPatchMp4,
    _consts: { MIDDLE: STREAM_CHUNK_MIDDLE_LIMIT, UPPER: STREAM_CHUNK_UPPER_LIMIT, SMALLEST: SMALLEST_CHUNK_LIMIT },
  }
})()
