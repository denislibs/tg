package domain

import "time"

type Media struct {
	ID        int64
	OwnerID   int64
	Bucket    string
	ObjectKey string
	Mime      string
	Size      int64
	Width     int
	Height    int
	Duration  int
	// BlurPreview — серверное stripped-превью (LQIP): крошечный JPEG, максимальная
	// сторона ~40px, байты уровня сотен — параметры tweb/Telegram stripped-thumb.
	// Осознанное отступление от tweb по формату: у Telegram по TL едет обрезанный
	// JPEG без стандартного заголовка (клиент восстанавливает его сам,
	// tweb getPreviewURLFromBytes.ts), у нас транспорт JSON, а не TL — едет полный
	// JPEG base64-строкой, фронту восстанавливать нечего. Генерируется фоновой
	// обработкой (ffmpeg), клиент не присылает. nil у невизуального медиа и у
	// загрузок до появления генерации.
	BlurPreview []byte
	// Waveform — 5-битно упакованные пики голосового (посчитаны клиентом при записи,
	// ~63 байта; 1:1 tweb documentAttributeAudio.waveform). nil для не-голосовых.
	Waveform []byte
	// FileName is the original upload name (shown for documents/music).
	FileName string
	// ThumbKey is the object key of a server-generated thumbnail/poster (jpeg),
	// empty until processing completes (or for non-visual media).
	ThumbKey string
	// UploadID is the in-flight MinIO multipart upload id for a chunked/resumable
	// upload (empty when none is in progress or after finalize). UploadTotal is the
	// declared number of parts, surfaced by the resume query.
	UploadID    string
	UploadTotal int
	CreatedAt   time.Time
}
