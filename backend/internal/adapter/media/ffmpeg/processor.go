// Package ffmpeg implements the media usecase's MediaProcessor port by shelling
// out to ffprobe (dimensions/duration) and ffmpeg (thumbnail/poster generation).
// It degrades gracefully: if the binaries are missing or a file can't be probed,
// Process returns an error and the caller simply skips processing.
package ffmpeg

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"

	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

const (
	// thumbMaxSide caps the longest side of generated thumbnails/posters (px).
	thumbMaxSide = 1280
	// strippedMaxSide/strippedQuality — параметры stripped-превью (LQIP) уровня
	// Telegram: крошечный JPEG с максимальной стороной ~40px и низким качеством
	// (DQT-таблица телеграмного stripped-заголовка в tweb
	// src/helpers/bytes/getPreviewURLFromBytes.ts соответствует libjpeg q≈20;
	// -q:v 28 у mjpeg даёт сопоставимую степень сжатия — сотни байт на кадр).
	strippedMaxSide = 40
	strippedQuality = 28
	// thumbQuality — качество больших превью (как было: -q:v 3).
	thumbQuality = 3
)

// Processor shells out to ffmpeg/ffprobe. The zero value is usable.
type Processor struct{}

var _ usecasemedia.MediaProcessor = (*Processor)(nil)

func New() *Processor { return &Processor{} }

// Process writes the source to a temp file, probes it, and (for images/videos)
// renders a downscaled jpeg thumbnail/poster.
func (p *Processor) Process(ctx context.Context, src io.Reader, mime string) (usecasemedia.ProcessResult, error) {
	tmp, err := os.CreateTemp("", "media-*")
	if err != nil {
		return usecasemedia.ProcessResult{}, err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return usecasemedia.ProcessResult{}, err
	}
	tmp.Close()

	meta := probe(ctx, tmp.Name())
	res := usecasemedia.ProcessResult{Width: meta.Width, Height: meta.Height, Duration: meta.Duration}

	// Lottie-стикер (.tgs/json) для ffprobe — просто текстовый файл, размеров он
	// не даёт. Достаём их из хедера анимации: без w/h фронт не может вписать
	// стикер в бокс (tweb makeMediaSize(doc.w, doc.h).aspectFitted). Растеризации
	// нет — превью первого кадра клиент делает сам и кэширует.
	if res.Width == 0 && isLottieMime(mime) {
		if w, h, ok := lottieDims(tmp.Name()); ok {
			res.Width, res.Height = w, h
			return res, nil
		}
	}

	isImage := strings.HasPrefix(mime, "image/")
	isVideo := strings.HasPrefix(mime, "video/")
	res.Animated = isAnimated(mime, meta)
	// Теги трека — только для аудио (у Telegram они живут в
	// documentAttributeAudio): у видео/картинок контейнерный title/artist от
	// кодировщика к подписи бабла отношения не имеет.
	if strings.HasPrefix(mime, "audio/") {
		res.Title, res.Performer = meta.Title, meta.Performer
	}
	if isImage || isVideo {
		if thumb, err := frameJPEG(ctx, tmp.Name(), isVideo, thumbMaxSide, thumbQuality); err == nil && len(thumb) > 0 {
			res.Thumb = thumb
		}
		if stripped, err := frameJPEG(ctx, tmp.Name(), isVideo, strippedMaxSide, strippedQuality); err == nil && len(stripped) > 0 {
			res.Stripped = stripped
		}
	}
	return res, nil
}

// isAnimated решает, гифка ли это (telegram documentAttributeAnimated, из
// которого tweb выводит doc.type === 'gif', appDocsManager.ts:219-226):
// настоящий image/gif либо видео БЕЗ аудиодорожки — ровно та семантика, по
// которой Telegram помечает такие файлы nosound_video и относит их к гифкам.
//
// meta.HasVideo в условии обязателен: провалившийся ffprobe отдаёт нулевой
// probeMeta, и без него КАЖДОЕ видео с непрочитанного файла стало бы гифкой.
func isAnimated(mime string, meta probeMeta) bool {
	if mime == "image/gif" {
		return true
	}
	return strings.HasPrefix(mime, "video/") && meta.HasVideo && !meta.HasAudio
}

// probeMeta is everything a successful ffprobe run tells us about an original.
// Zero values mean "unknown" — nothing is written over existing metadata then.
type probeMeta struct {
	Width, Height, Duration int
	// Title/Performer — теги трека (ID3 title/artist), пустые если тегов нет.
	Title, Performer string
	// HasVideo/HasAudio — наличие дорожек соответствующего типа. HasVideo=false
	// у нулевого probeMeta (ffprobe не отработал) и служит признаком «probe не
	// дал ничего»: без него «нет аудио» неотличимо от «файл не прочитан».
	HasVideo, HasAudio bool
}

// probe reads width/height (first video stream), duration (seconds) and the
// container tags via ffprobe. A failed run yields the zero probeMeta.
func probe(ctx context.Context, path string) probeMeta {
	out, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "error", "-of", "json", "-show_format", "-show_streams", path,
	).Output()
	if err != nil {
		return probeMeta{}
	}
	return parseProbe(out)
}

// probeOutput mirrors the subset of `ffprobe -of json` we consume. Tag values are
// decoded as `any` (not string) so an exotic non-string tag can't fail the whole
// unmarshal and cost us the dimensions.
type probeOutput struct {
	Streams []struct {
		CodecType string         `json:"codec_type"`
		Width     int            `json:"width"`
		Height    int            `json:"height"`
		Tags      map[string]any `json:"tags"`
	} `json:"streams"`
	Format struct {
		Duration string         `json:"duration"`
		Tags     map[string]any `json:"tags"`
	} `json:"format"`
}

// parseProbe extracts dims/duration/tags from ffprobe json output.
func parseProbe(out []byte) probeMeta {
	var p probeOutput
	if err := json.Unmarshal(out, &p); err != nil {
		return probeMeta{}
	}
	var meta probeMeta
	for _, s := range p.Streams {
		switch s.CodecType {
		case "video":
			meta.HasVideo = true
			if s.Width > 0 && meta.Width == 0 {
				meta.Width, meta.Height = s.Width, s.Height
			}
		case "audio":
			meta.HasAudio = true
		}
	}
	if f, err := strconv.ParseFloat(p.Format.Duration, 64); err == nil {
		meta.Duration = int(f + 0.5)
	}
	// Теги обычно лежат на контейнере (mp3/m4a/flac), но у ogg/opus ffprobe
	// кладёт их на аудиопоток — добираем оттуда то, чего нет в format.
	meta.Title, meta.Performer = tag(p.Format.Tags, "title"), tag(p.Format.Tags, "artist")
	for _, s := range p.Streams {
		if s.CodecType != "audio" || len(s.Tags) == 0 {
			continue
		}
		if meta.Title == "" {
			meta.Title = tag(s.Tags, "title")
		}
		if meta.Performer == "" {
			meta.Performer = tag(s.Tags, "artist")
		}
	}
	return meta
}

// tag looks a tag up case-insensitively (ffprobe reports TITLE/Title/title
// depending on the container) and trims it; a blank value reads as absent.
func tag(tags map[string]any, name string) string {
	for k, v := range tags {
		if !strings.EqualFold(k, name) {
			continue
		}
		if s, ok := v.(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// frameJPEG renders a single downscaled jpeg frame (poster for video, the image
// itself otherwise), longest side capped at maxSide, without upscaling.
func frameJPEG(ctx context.Context, path string, isVideo bool, maxSide, quality int) ([]byte, error) {
	// keep aspect, cap the longest side, never upscale (min() guards)
	vf := fmt.Sprintf(
		"scale='if(gt(iw,ih),min(%d,iw),-2)':'if(gt(iw,ih),-2,min(%d,ih))'",
		maxSide, maxSide)
	args := []string{"-y", "-i", path}
	if isVideo {
		args = append(args, "-ss", "0")
	}
	args = append(args, "-frames:v", "1", "-vf", vf, "-q:v", strconv.Itoa(quality), "-f", "mjpeg", "pipe:1")
	var buf bytes.Buffer
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.Stdout = &buf
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
