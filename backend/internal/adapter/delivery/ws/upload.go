package ws

import (
	"encoding/binary"
	"encoding/json"
)

// uploadMaxConcurrent — предел одновременных file_up на соединение (как fileMaxConcurrent).
const uploadMaxConcurrent = 16

// maxFileUpChunk — потолок data одного file_up-кадра. sealed-кадр (24Б заголовок +
// 1Б kind + 16Б AEAD-tag + data) обязан влезать в maxMessageSize (1МБ). 512КБ — с запасом.
const maxFileUpChunk = 512 << 10

// fileUpFrame собирает бинарный file_up (payload ПОСЛЕ kind-байта 0x02, его клеит codec).
// Layout Big-Endian: req_id(u32)│media_id(u64)│index(u32)│total(u32)│len(u32)│data.
func fileUpFrame(reqID uint32, mediaID int64, index, total int, data []byte) []byte {
	out := make([]byte, 24+len(data))
	binary.BigEndian.PutUint32(out[0:4], reqID)
	binary.BigEndian.PutUint64(out[4:12], uint64(mediaID))
	binary.BigEndian.PutUint32(out[12:16], uint32(index))
	binary.BigEndian.PutUint32(out[16:20], uint32(total))
	binary.BigEndian.PutUint32(out[20:24], uint32(len(data)))
	copy(out[24:], data)
	return out
}

// parseFileUp разбирает payload file_up (без kind-байта). ok=false при коротком заголовке
// или несоответствии len/данных.
func parseFileUp(p []byte) (reqID uint32, mediaID int64, index, total int, data []byte, ok bool) {
	if len(p) < 24 {
		return 0, 0, 0, 0, nil, false
	}
	reqID = binary.BigEndian.Uint32(p[0:4])
	mediaID = int64(binary.BigEndian.Uint64(p[4:12]))
	index = int(binary.BigEndian.Uint32(p[12:16]))
	total = int(binary.BigEndian.Uint32(p[16:20]))
	length := int(binary.BigEndian.Uint32(p[20:24]))
	if length != len(p)-24 {
		return 0, 0, 0, 0, nil, false
	}
	return reqID, mediaID, index, total, p[24:], true
}

// fileUpOkFrame / fileUpErrFrame — JSON-ack (kind 0x00).
func fileUpOkFrame(reqID uint32) []byte {
	b, _ := json.Marshal(map[string]any{"t": "file_up_ok", "d": map[string]any{"req_id": reqID}})
	return b
}

func fileUpErrFrame(reqID uint32, msg string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "file_up_err", "d": map[string]any{"req_id": reqID, "error": msg}})
	return b
}
