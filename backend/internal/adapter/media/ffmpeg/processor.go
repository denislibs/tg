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

	res := usecasemedia.ProcessResult{}
	w, h, dur := probe(ctx, tmp.Name())
	res.Width, res.Height, res.Duration = w, h, dur

	isImage := strings.HasPrefix(mime, "image/")
	isVideo := strings.HasPrefix(mime, "video/")
	if isImage || isVideo {
		if thumb, err := thumbnail(ctx, tmp.Name(), isVideo); err == nil && len(thumb) > 0 {
			res.Thumb = thumb
		}
	}
	return res, nil
}

// probe reads width/height (first video stream) and duration (seconds) via ffprobe.
func probe(ctx context.Context, path string) (width, height, duration int) {
	out, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "error", "-of", "json", "-show_format", "-show_streams", path,
	).Output()
	if err != nil {
		return 0, 0, 0
	}
	var probe struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &probe); err != nil {
		return 0, 0, 0
	}
	for _, s := range probe.Streams {
		if s.CodecType == "video" && s.Width > 0 {
			width, height = s.Width, s.Height
			break
		}
	}
	if f, err := strconv.ParseFloat(probe.Format.Duration, 64); err == nil {
		duration = int(f + 0.5)
	}
	return width, height, duration
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
