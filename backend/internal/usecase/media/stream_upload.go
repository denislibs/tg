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
	mu sync.Mutex // guards next/pw/timer for THIS session only — sessions never block each other

	pw     *io.PipeWriter
	next   int64      // expected next offset
	total  int64      // authoritative size (copied from m.Size at creation) — never trust a later client-supplied total over this
	owner  int64      // media owner — checked on EVERY chunk, not just the first
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
	_ = s.pw.CloseWithError(cause) // unblocks the PutObject reader (and any pending/future Write)
	su.mu.Lock()
	if su.sessions[mediaID] == s {
		delete(su.sessions, mediaID)
	}
	su.mu.Unlock()
	s.timer.Stop()
}

// getOrCreateSession returns the session for mediaID, creating it on the first
// chunk (offset==0). repo.GetByID runs OUTSIDE su.mu so a slow DB stalls only
// the caller, not every other in-flight session; the map is re-checked under
// lock afterwards (double-check) in case a concurrent first chunk already won.
func (su *StreamUploads) getOrCreateSession(ctx context.Context, ownerID, mediaID, offset, total int64) (*streamSession, error) {
	su.mu.Lock()
	s := su.sessions[mediaID]
	su.mu.Unlock()
	if s != nil {
		return s, nil
	}
	if offset != 0 {
		return nil, ErrBadPart // no session yet, but offset isn't zero
	}

	m, err := su.svc.repo.GetByID(ctx, mediaID)
	if err != nil {
		return nil, err
	}
	if m.OwnerID != ownerID {
		return nil, ErrForbidden
	}
	// total is client-supplied on the wire — trust only the media row's
	// declared size, otherwise a client could CreateUpload a small object and
	// then stream far more than the declared (size-capped) Size into it.
	if total != m.Size {
		return nil, ErrBadPart
	}

	su.mu.Lock()
	if existing := su.sessions[mediaID]; existing != nil {
		su.mu.Unlock()
		return existing, nil // lost the race to a concurrent first chunk
	}
	pr, pw := io.Pipe()
	s = &streamSession{pw: pw, next: 0, total: m.Size, owner: ownerID, result: make(chan error, 1), m: m}
	s.timer = time.AfterFunc(streamIdleTTL, func() { su.abort(mediaID, s, errors.New("upload idle timeout")) })
	su.sessions[mediaID] = s
	su.mu.Unlock()

	go func() {
		err := su.svc.storage.PutObject(context.Background(), m.ObjectKey, pr, m.Size, m.Mime)
		if err != nil {
			// Fail fast: without this, a WriteChunk blocked on pw.Write would
			// hang until the idle timer fires instead of surfacing the error.
			_ = pr.CloseWithError(err)
		}
		s.result <- err
	}()
	return s, nil
}

// WriteChunk writes one ordered chunk. done=true means the object is fully assembled.
func (su *StreamUploads) WriteChunk(ctx context.Context, ownerID, mediaID, offset, total int64, data []byte) (bool, error) {
	s, err := su.getOrCreateSession(ctx, ownerID, mediaID, offset, total)
	if err != nil {
		return false, err
	}

	s.mu.Lock()
	if s.owner != ownerID {
		s.mu.Unlock()
		return false, ErrForbidden // session belongs to a different owner — reject every chunk, not just the first
	}
	if total != s.total {
		s.mu.Unlock()
		su.abort(mediaID, s, errors.New("declared total changed mid-stream"))
		return false, ErrBadPart
	}
	if offset != s.next {
		s.mu.Unlock()
		su.abort(mediaID, s, errors.New("out of order"))
		return false, ErrBadPart
	}
	if offset+int64(len(data)) > s.total {
		s.mu.Unlock()
		su.abort(mediaID, s, errors.New("chunk exceeds declared total"))
		return false, ErrBadPart
	}
	s.timer.Reset(streamIdleTTL)
	if _, err := s.pw.Write(data); err != nil { // PutObject failed / session aborted
		s.mu.Unlock()
		su.abort(mediaID, s, err)
		return false, err
	}
	s.next += int64(len(data))
	done := s.next >= s.total
	s.mu.Unlock()

	if !done {
		return false, nil
	}

	// Last chunk: close the pipe (EOF) so PutObject completes, then wait for
	// its result. Nothing else legitimately touches this session again.
	_ = s.pw.Close()
	err = <-s.result
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
