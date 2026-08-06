package media

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// streamIdleTTL — if a session sees no chunks for longer than this, it is
// aborted (dropped channel / abandoned upload). Dual role: correctness (no
// leaks) + GC.
const streamIdleTTL = 60 * time.Second

type streamSession struct {
	pw     *io.PipeWriter
	next   int64      // expected next offset
	result chan error // PutObject outcome
	m      domain.Media
	timer  *time.Timer
}

// StreamUploads assembles a media object from offset-ordered chunks of a DNP
// channel: the first chunk opens an io.Pipe + a PutObject goroutine, later
// chunks write into the pipe in order, and the last one closes the pipe →
// object is complete → background processing kicks off. No S3-multipart.
type StreamUploads struct {
	svc      *Interactor
	mu       sync.Mutex
	sessions map[int64]*streamSession // key: mediaID
}

func NewStreamUploads(svc *Interactor) *StreamUploads {
	return &StreamUploads{svc: svc, sessions: make(map[int64]*streamSession)}
}

func (su *StreamUploads) abort(mediaID int64, s *streamSession, cause error) {
	_ = s.pw.CloseWithError(cause) // unblocks the PutObject reader
	su.mu.Lock()
	if su.sessions[mediaID] == s {
		delete(su.sessions, mediaID)
	}
	su.mu.Unlock()
	s.timer.Stop()
}

// WriteChunk writes one ordered chunk. done=true means the object is fully assembled.
func (su *StreamUploads) WriteChunk(ctx context.Context, ownerID, mediaID, offset, total int64, data []byte) (bool, error) {
	su.mu.Lock()
	s := su.sessions[mediaID]
	if s == nil {
		if offset != 0 {
			su.mu.Unlock()
			return false, ErrBadPart // no session yet, but offset isn't zero
		}
		m, err := su.svc.repo.GetByID(ctx, mediaID)
		if err != nil {
			su.mu.Unlock()
			return false, err
		}
		if m.OwnerID != ownerID {
			su.mu.Unlock()
			return false, ErrForbidden
		}
		pr, pw := io.Pipe()
		s = &streamSession{pw: pw, next: 0, result: make(chan error, 1), m: m}
		s.timer = time.AfterFunc(streamIdleTTL, func() { su.abort(mediaID, s, errors.New("upload idle timeout")) })
		su.sessions[mediaID] = s
		su.mu.Unlock()
		go func() { s.result <- su.svc.storage.PutObject(context.Background(), m.ObjectKey, pr, total, m.Mime) }()
	} else {
		su.mu.Unlock()
	}

	if offset != s.next {
		su.abort(mediaID, s, errors.New("out of order"))
		return false, ErrBadPart
	}
	s.timer.Reset(streamIdleTTL)
	if _, err := s.pw.Write(data); err != nil { // PutObject failed / session aborted
		su.abort(mediaID, s, err)
		return false, err
	}
	s.next += int64(len(data))

	if s.next >= total { // last chunk
		_ = s.pw.Close() // EOF → PutObject completes the object
		err := <-s.result
		su.mu.Lock()
		if su.sessions[mediaID] == s {
			delete(su.sessions, mediaID)
		}
		su.mu.Unlock()
		s.timer.Stop()
		if err != nil {
			return false, err
		}
		if su.svc.processor != nil {
			go su.svc.process(s.m) // dims/thumbnail in the background, like PutContent
		}
		return true, nil
	}
	return false, nil
}
