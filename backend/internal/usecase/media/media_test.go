package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRepo struct {
	rows   map[int64]domain.Media
	nextID int64
	// m, when set, is returned by GetByID for any id (single-row convenience for
	// content tests).
	m     domain.Media
	parts map[int64]map[int]partRow
	// processed, when set, receives what background processing persisted (the
	// test awaits it instead of sleeping on the detached goroutine).
	processed chan ProcessedMeta
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[int64]domain.Media{}} }

func (r *fakeRepo) Create(_ context.Context, m domain.Media) (domain.Media, error) {
	if r.rows == nil {
		r.rows = map[int64]domain.Media{}
	}
	r.nextID++
	m.ID = r.nextID
	m.CreatedAt = time.Now()
	r.rows[m.ID] = m
	return m, nil
}

func (r *fakeRepo) GetByID(_ context.Context, id int64) (domain.Media, error) {
	if r.rows != nil {
		if m, ok := r.rows[id]; ok {
			return m, nil
		}
	}
	if r.m.ID != 0 {
		return r.m, nil
	}
	return domain.Media{}, domain.ErrNotFound
}

func (r *fakeRepo) UpdateProcessed(_ context.Context, _ int64, res ProcessedMeta) error {
	if r.processed != nil {
		r.processed <- res
	}
	return nil
}

func (r *fakeRepo) get(id int64) domain.Media {
	if m, ok := r.rows[id]; ok {
		return m
	}
	return r.m
}
func (r *fakeRepo) put(id int64, m domain.Media) {
	if r.rows != nil {
		if _, ok := r.rows[id]; ok {
			r.rows[id] = m
			return
		}
	}
	r.m = m
}

func (r *fakeRepo) SetUploadID(_ context.Context, id int64, uploadID string) (string, error) {
	m := r.get(id)
	if m.UploadID == "" {
		m.UploadID = uploadID
		r.put(id, m)
	}
	return m.UploadID, nil
}
func (r *fakeRepo) SetUploadTotal(_ context.Context, id int64, total int) error {
	m := r.get(id)
	m.UploadTotal = total
	r.put(id, m)
	return nil
}

type partRow struct {
	etag string
	size int64
}

func (r *fakeRepo) SavePart(_ context.Context, mediaID int64, partIndex int, etag string, size int64) error {
	if r.parts == nil {
		r.parts = map[int64]map[int]partRow{}
	}
	if r.parts[mediaID] == nil {
		r.parts[mediaID] = map[int]partRow{}
	}
	r.parts[mediaID][partIndex] = partRow{etag: etag, size: size}
	return nil
}
func (r *fakeRepo) ReceivedParts(_ context.Context, mediaID int64) ([]int, error) {
	var idx []int
	for i := range r.parts[mediaID] {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	return idx, nil
}
func (r *fakeRepo) PartsForComplete(_ context.Context, mediaID int64) ([]UploadedPart, error) {
	idx, _ := r.ReceivedParts(nil, mediaID)
	out := make([]UploadedPart, 0, len(idx))
	for _, i := range idx {
		out = append(out, UploadedPart{PartNumber: i, ETag: r.parts[mediaID][i].etag})
	}
	return out, nil
}
func (r *fakeRepo) UpdateFinalized(_ context.Context, id int64, size int64, width, height, duration int, fileName, mime string) error {
	m := r.get(id)
	if size > 0 {
		m.Size = size
	}
	if mime != "" {
		m.Mime = mime
	}
	r.put(id, m)
	return nil
}
func (r *fakeRepo) ClearUpload(_ context.Context, id int64) error {
	m := r.get(id)
	m.UploadID, m.UploadTotal = "", 0
	r.put(id, m)
	delete(r.parts, id)
	return nil
}

type fakeStorage struct {
	blobs   map[string][]byte
	parts   map[string]map[int][]byte // uploadID -> partNumber -> bytes
	nextUp  int
	aborted map[string]bool
}

func newFakeStorage() *fakeStorage { return &fakeStorage{blobs: map[string][]byte{}} }

func (*fakeStorage) Bucket() string { return "media" }
func (*fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://put/" + key, nil
}
func (*fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://get/" + key, nil
}
func (f *fakeStorage) PutObject(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	b, _ := io.ReadAll(r)
	if f.blobs == nil {
		f.blobs = map[string][]byte{}
	}
	f.blobs[key] = b
	return nil
}
func (f *fakeStorage) GetObject(_ context.Context, key string) (io.ReadSeekCloser, ObjectInfo, error) {
	b, ok := f.blobs[key]
	if !ok {
		return nil, ObjectInfo{}, domain.ErrNotFound
	}
	return nopSeekCloser{bytes.NewReader(b)}, ObjectInfo{Size: int64(len(b)), ContentType: "application/octet-stream"}, nil
}
func (f *fakeStorage) StartMultipart(_ context.Context, _, _ string) (string, error) {
	if f.parts == nil {
		f.parts = map[string]map[int][]byte{}
	}
	f.nextUp++
	up := fmt.Sprintf("up-%d", f.nextUp)
	f.parts[up] = map[int][]byte{}
	return up, nil
}
func (f *fakeStorage) PutPart(_ context.Context, _, uploadID string, partNumber int, r io.Reader, _ int64) (string, error) {
	b, _ := io.ReadAll(r)
	if f.parts[uploadID] == nil {
		f.parts[uploadID] = map[int][]byte{}
	}
	f.parts[uploadID][partNumber] = b
	return fmt.Sprintf("etag-%s-%d", uploadID, partNumber), nil
}
func (f *fakeStorage) CompleteMultipart(_ context.Context, objectKey, uploadID string, parts []UploadedPart) error {
	var buf bytes.Buffer
	for _, p := range parts {
		buf.Write(f.parts[uploadID][p.PartNumber])
	}
	if f.blobs == nil {
		f.blobs = map[string][]byte{}
	}
	f.blobs[objectKey] = buf.Bytes()
	delete(f.parts, uploadID)
	return nil
}
func (f *fakeStorage) AbortMultipart(_ context.Context, _, uploadID string) error {
	if f.aborted == nil {
		f.aborted = map[string]bool{}
	}
	f.aborted[uploadID] = true
	delete(f.parts, uploadID)
	return nil
}

type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

func TestInteractor_CreateUploadAndGet(t *testing.T) {
	s := New(newFakeRepo(), newFakeStorage(), nil)
	ctx := context.Background()

	m, uploadURL, err := s.CreateUpload(ctx, UploadInput{OwnerID: 7, Mime: "image/jpeg", Size: 2048, Width: 100, Height: 100})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	if m.ID == 0 || uploadURL == "" {
		t.Fatalf("bad result: %+v url=%q", m, uploadURL)
	}
	if m.Bucket != "media" {
		t.Fatalf("bucket = %q, want media", m.Bucket)
	}

	got, downloadURL, err := s.GetMedia(ctx, m.ID)
	if err != nil || got.ID != m.ID || downloadURL == "" {
		t.Fatalf("GetMedia = %+v, %q, %v", got, downloadURL, err)
	}
	if got.Mime != "image/jpeg" || got.Width != 100 {
		t.Fatalf("GetMedia metadata = %+v", got)
	}
}

func TestInteractor_GetMediaNotFound(t *testing.T) {
	s := New(newFakeRepo(), newFakeStorage(), nil)
	if _, _, err := s.GetMedia(context.Background(), 999999); err != domain.ErrNotFound {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}
}

func TestInteractor_RejectsBadSize(t *testing.T) {
	s := New(newFakeRepo(), newFakeStorage(), nil)
	ctx := context.Background()
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: maxChunkedSize + 1}); err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
	if _, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 1, Size: 0}); err != ErrBadSize {
		t.Fatalf("expected ErrBadSize, got %v", err)
	}
}

func TestPutContent_OwnerOnly(t *testing.T) {
	repo := &fakeRepo{m: domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "image/png", Size: 5}}
	st := newFakeStorage()
	s := New(repo, st, nil)
	if err := s.PutContent(context.Background(), 1, 7, bytes.NewReader([]byte("12345")), 5); err != nil {
		t.Fatalf("owner put: %v", err)
	}
	if err := s.PutContent(context.Background(), 1, 99, bytes.NewReader([]byte("12345")), 5); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner = %v, want ErrForbidden", err)
	}
}

// fakeProcessor отдаёт заранее заданный результат «разбора» файла — как ffprobe
// после чтения ID3-тегов.
type fakeProcessor struct{ res ProcessResult }

func (p fakeProcessor) Process(context.Context, io.Reader, string) (ProcessResult, error) {
	return p.res, nil
}

// Теги трека, вычитанные процессором, доезжают до репозитория вместе с
// размерами/длительностью и ключом превью (фоновая обработка после PutContent).
func TestProcess_PersistsAudioTags(t *testing.T) {
	repo := &fakeRepo{
		m:         domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "audio/mpeg", Size: 5},
		processed: make(chan ProcessedMeta, 1),
	}
	s := New(repo, newFakeStorage(), fakeProcessor{res: ProcessResult{
		Duration: 139, Title: "Track One", Performer: "denis1488",
	}})
	if err := s.PutContent(context.Background(), 1, 7, bytes.NewReader([]byte("12345")), 5); err != nil {
		t.Fatalf("PutContent: %v", err)
	}
	select {
	case got := <-repo.processed:
		want := ProcessedMeta{Duration: 139, Title: "Track One", Performer: "denis1488"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("UpdateProcessed = %+v, want %+v", got, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("background processing did not persist anything")
	}
}

// Файл без тегов: в репозиторий уезжают пустые title/performer — репозиторий по
// ним ничего не перетирает, колонки остаются NULL.
func TestProcess_NoTags(t *testing.T) {
	repo := &fakeRepo{
		m:         domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "audio/mpeg", Size: 5},
		processed: make(chan ProcessedMeta, 1),
	}
	s := New(repo, newFakeStorage(), fakeProcessor{res: ProcessResult{Duration: 12}})
	if err := s.PutContent(context.Background(), 1, 7, bytes.NewReader([]byte("12345")), 5); err != nil {
		t.Fatalf("PutContent: %v", err)
	}
	select {
	case got := <-repo.processed:
		if got.Title != "" || got.Performer != "" {
			t.Fatalf("tags = %q/%q, want empty", got.Title, got.Performer)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("background processing did not persist anything")
	}
}

// Stripped-превью (blur_preview) из процессора доезжает до репозитория при
// фоновой обработке — вместе с размерами.
func TestProcess_PersistsStripped(t *testing.T) {
	stripped := []byte{0xff, 0xd8, 0xff, 0xe0, 7}
	repo := &fakeRepo{
		m:         domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "image/jpeg", Size: 5},
		processed: make(chan ProcessedMeta, 1),
	}
	s := New(repo, newFakeStorage(), fakeProcessor{res: ProcessResult{
		Width: 800, Height: 600, Stripped: stripped,
	}})
	if err := s.PutContent(context.Background(), 1, 7, bytes.NewReader([]byte("12345")), 5); err != nil {
		t.Fatalf("PutContent: %v", err)
	}
	select {
	case got := <-repo.processed:
		if !bytes.Equal(got.BlurPreview, stripped) {
			t.Fatalf("BlurPreview = %v, want %v", got.BlurPreview, stripped)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("background processing did not persist anything")
	}
}

// StrippedPreview: уже записанное превью отдаётся из строки без обращения к
// хранилищу; пустое — генерируется синхронно и сохраняется; без процессора —
// мягкая деградация в nil (без ошибки).
func TestStrippedPreview(t *testing.T) {
	ctx := context.Background()
	stripped := []byte{0xff, 0xd8, 9}

	// 1) превью уже в строке — процессор и хранилище не нужны вовсе.
	repo := newFakeRepo()
	repo.put(1, domain.Media{ID: 1, ObjectKey: "7/x", Mime: "image/jpeg", BlurPreview: stripped})
	s := New(repo, newFakeStorage(), nil)
	got, err := s.StrippedPreview(ctx, 1)
	if err != nil || !bytes.Equal(got, stripped) {
		t.Fatalf("cached StrippedPreview = %v, %v", got, err)
	}

	// 2) превью нет — генерируется из оригинала и уезжает в UpdateProcessed.
	repo = newFakeRepo()
	repo.processed = make(chan ProcessedMeta, 1)
	repo.put(2, domain.Media{ID: 2, ObjectKey: "7/y", Mime: "image/jpeg"})
	st := newFakeStorage()
	st.blobs["7/y"] = []byte("jpegbytes")
	s = New(repo, st, fakeProcessor{res: ProcessResult{Width: 40, Stripped: stripped}})
	got, err = s.StrippedPreview(ctx, 2)
	if err != nil || !bytes.Equal(got, stripped) {
		t.Fatalf("generated StrippedPreview = %v, %v", got, err)
	}
	select {
	case meta := <-repo.processed:
		if !bytes.Equal(meta.BlurPreview, stripped) {
			t.Fatalf("persisted BlurPreview = %v, want %v", meta.BlurPreview, stripped)
		}
	default:
		t.Fatal("generated preview was not persisted")
	}

	// 3) процессора нет — nil без ошибки (аватарка ставится без превью).
	repo = newFakeRepo()
	repo.put(3, domain.Media{ID: 3, ObjectKey: "7/z", Mime: "image/jpeg"})
	s = New(repo, newFakeStorage(), nil)
	got, err = s.StrippedPreview(ctx, 3)
	if err != nil || got != nil {
		t.Fatalf("no-processor StrippedPreview = %v, %v (want nil, nil)", got, err)
	}
}

func TestChunkedUpload_Roundtrip(t *testing.T) {
	repo := newFakeRepo()
	st := newFakeStorage()
	s := New(repo, st, nil)
	ctx := context.Background()

	m, _, err := s.CreateUpload(ctx, UploadInput{OwnerID: 7, Mime: "video/mp4", Size: 9})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}

	// Three parts, uploaded out of order; re-upload part 2 (idempotent).
	if err := s.SavePart(ctx, m.ID, 7, 2, 3, bytes.NewReader([]byte("def")), 3); err != nil {
		t.Fatalf("part 2: %v", err)
	}
	if err := s.SavePart(ctx, m.ID, 7, 1, 3, bytes.NewReader([]byte("abc")), 3); err != nil {
		t.Fatalf("part 1: %v", err)
	}
	if err := s.SavePart(ctx, m.ID, 7, 2, 3, bytes.NewReader([]byte("def")), 3); err != nil {
		t.Fatalf("part 2 re-upload: %v", err)
	}

	// Non-owner cannot add a part.
	if err := s.SavePart(ctx, m.ID, 99, 3, 3, bytes.NewReader([]byte("ghi")), 3); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner part = %v, want ErrForbidden", err)
	}

	// Resume: parts 1,2 received; finalize before part 3 must fail (missing part).
	got, total, err := s.ReceivedParts(ctx, m.ID, 7)
	if err != nil || total != 3 || len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("ReceivedParts = %v total=%d err=%v", got, total, err)
	}
	if err := s.FinalizeUpload(ctx, m.ID, 7, FinalizeInput{Size: 9, Total: 3}); !errors.Is(err, ErrMissingParts) {
		t.Fatalf("finalize with gap = %v, want ErrMissingParts", err)
	}

	// Send the last part, then finalize.
	if err := s.SavePart(ctx, m.ID, 7, 3, 3, bytes.NewReader([]byte("ghi")), 3); err != nil {
		t.Fatalf("part 3: %v", err)
	}
	if err := s.FinalizeUpload(ctx, m.ID, 7, FinalizeInput{Size: 9, Total: 3}); err != nil {
		t.Fatalf("finalize: %v", err)
	}

	// The assembled object downloads exactly like a single-PUT upload.
	rc, _, _, err := s.GetContent(ctx, m.ID)
	if err != nil {
		t.Fatalf("GetContent: %v", err)
	}
	defer rc.Close()
	b, _ := io.ReadAll(rc)
	if string(b) != "abcdefghi" {
		t.Fatalf("assembled = %q, want abcdefghi", b)
	}
}

func TestGetContent(t *testing.T) {
	repo := &fakeRepo{m: domain.Media{ID: 1, OwnerID: 7, ObjectKey: "7/x", Mime: "image/png", Size: 3}}
	st := newFakeStorage()
	_ = st.PutObject(context.Background(), "7/x", bytes.NewReader([]byte("abc")), 3, "image/png")
	s := New(repo, st, nil)
	rc, info, m, err := s.GetContent(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	if m.Mime != "image/png" || info.Size != 3 {
		t.Fatalf("meta wrong: %+v %+v", m, info)
	}
	got, _ := io.ReadAll(rc)
	if string(got) != "abc" {
		t.Fatalf("body=%q", got)
	}
}
