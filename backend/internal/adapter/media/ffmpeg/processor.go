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

// thumbMaxSide caps the longest side of generated thumbnails/posters (px).
const thumbMaxSide = 1280

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

	isImage := strings.HasPrefix(mime, "image/")
	isVideo := strings.HasPrefix(mime, "video/")
	// Теги трека — только для аудио (у Telegram они живут в
	// documentAttributeAudio): у видео/картинок контейнерный title/artist от
	// кодировщика к подписи бабла отношения не имеет.
	if strings.HasPrefix(mime, "audio/") {
		res.Title, res.Performer = meta.Title, meta.Performer
	}
	if isImage || isVideo {
		if thumb, err := thumbnail(ctx, tmp.Name(), isVideo); err == nil && len(thumb) > 0 {
			res.Thumb = thumb
		}
	}
	return res, nil
}

// probeMeta is everything a successful ffprobe run tells us about an original.
// Zero values mean "unknown" — nothing is written over existing metadata then.
type probeMeta struct {
	Width, Height, Duration int
	// Title/Performer — теги трека (ID3 title/artist), пустые если тегов нет.
	Title, Performer string
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
		if s.CodecType == "video" && s.Width > 0 {
			meta.Width, meta.Height = s.Width, s.Height
			break
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

// thumbnail renders a single downscaled jpeg frame (poster for video, the image
// itself otherwise), longest side capped at thumbMaxSide, without upscaling.
func thumbnail(ctx context.Context, path string, isVideo bool) ([]byte, error) {
	// keep aspect, cap the longest side, never upscale (min() guards)
	vf := fmt.Sprintf(
		"scale='if(gt(iw,ih),min(%d,iw),-2)':'if(gt(iw,ih),-2,min(%d,ih))'",
		thumbMaxSide, thumbMaxSide)
	args := []string{"-y", "-i", path}
	if isVideo {
		args = append(args, "-ss", "0")
	}
	args = append(args, "-frames:v", "1", "-vf", vf, "-q:v", "3", "-f", "mjpeg", "pipe:1")
	var buf bytes.Buffer
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.Stdout = &buf
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
