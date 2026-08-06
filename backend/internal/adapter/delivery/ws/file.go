package ws

import (
	"context"
	"encoding/binary"
	"encoding/json"
)

// fileMaxConcurrent ограничивает число одновременных file_req на соединение
// (как rpcMaxConcurrent): чтение чанка держит горутину + байты в памяти.
const fileMaxConcurrent = 16

// FileDispatcher отдаёт кусок медиа по offset/limit с проверкой прав юзера
// канала (реализуется в пакете http через FileStreamer). Несёт userID, чтобы ws
// не зависел от media/chat usecase напрямую.
type FileDispatcher interface {
	// ReadPart возвращает до limit байт с offset и total (полный размер файла).
	// Ошибка доступа → domain.ErrForbidden (маппится в file_err "forbidden").
	ReadPart(ctx context.Context, userID, mediaID, offset, limit int64) (data []byte, total int64, err error)
}

// UploadDispatcher пишет один part медиа (реализуется в http через MediaUploader).
// Права (владелец медиа) проверяются внутри реализации; ошибка → domain.ErrForbidden.
type UploadDispatcher interface {
	SavePart(ctx context.Context, userID, mediaID int64, index, total int, data []byte) error
}

type fileReqData struct {
	ReqID   uint32 `json:"req_id"`
	MediaID int64  `json:"media_id"`
	Offset  int64  `json:"offset"`
	Limit   int64  `json:"limit"`
}

// fileChunkFrame сериализует бинарный media-чанк (payload ПОСЛЕ kind-байта 0x01,
// его клеит codec). Layout Big-Endian: req_id(u32)│offset(u64)│total(u64)│len(u32)│data.
func fileChunkFrame(reqID uint32, offset, total int64, data []byte) []byte {
	out := make([]byte, 24+len(data))
	binary.BigEndian.PutUint32(out[0:4], reqID)
	binary.BigEndian.PutUint64(out[4:12], uint64(offset))
	binary.BigEndian.PutUint64(out[12:20], uint64(total))
	binary.BigEndian.PutUint32(out[20:24], uint32(len(data)))
	copy(out[24:], data)
	return out
}

// fileErrFrame — JSON-кадр ошибки чанк-запроса (kind 0x00): клиент реджектит
// fetchFilePart по req_id.
func fileErrFrame(reqID uint32, msg string) []byte {
	b, _ := json.Marshal(map[string]any{
		"t": "file_err",
		"d": map[string]any{"req_id": reqID, "error": msg},
	})
	return b
}
