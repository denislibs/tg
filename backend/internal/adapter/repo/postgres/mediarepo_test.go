package postgres

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

func seedMediaOwner(t *testing.T, repo *MediaRepo, phone string) int64 {
	t.Helper()
	var id int64
	err := repo.pool.QueryRow(context.Background(),
		`INSERT INTO users (phone, display_name) VALUES ($1,$1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("seedMediaOwner: %v", err)
	}
	return id
}

func TestMediaRepo_CreateAndGet(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+700")

	m, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "k1", Mime: "image/jpeg",
		Size: 1024, Width: 800, Height: 600,
	})
	if err != nil || m.ID == 0 {
		t.Fatalf("Create = %+v, %v", m, err)
	}
	got, err := repo.GetByID(ctx, m.ID)
	if err != nil || got.ObjectKey != "k1" || got.Width != 800 {
		t.Fatalf("GetByID = %+v, %v", got, err)
	}
	// blur_preview при создании пуст (клиент его не присылает) — заполняется
	// фоновой обработкой через UpdateProcessed.
	if got.BlurPreview != nil {
		t.Fatalf("blur_preview after create = %v, want nil", got.BlurPreview)
	}
	if _, err := repo.GetByID(ctx, 999999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}
}

// Stripped-превью пишется UpdateProcessed; повторная обработка с пустым превью
// не затирает уже записанное (та же семантика, что у тегов/thumb_key).
func TestMediaRepo_BlurPreviewProcessed(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+792")

	m, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "pic1", Mime: "image/jpeg", Size: 10,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	stripped := []byte{0xff, 0xd8, 0xff, 0xe0, 42}
	if err := repo.UpdateProcessed(ctx, m.ID, usecasemedia.ProcessedMeta{
		Width: 800, Height: 600, BlurPreview: stripped,
	}); err != nil {
		t.Fatalf("UpdateProcessed: %v", err)
	}
	got, _ := repo.GetByID(ctx, m.ID)
	if !bytes.Equal(got.BlurPreview, stripped) {
		t.Fatalf("blur_preview = %v, want %v", got.BlurPreview, stripped)
	}
	// Повторная обработка без превью не затирает записанное.
	if err := repo.UpdateProcessed(ctx, m.ID, usecasemedia.ProcessedMeta{Width: 800}); err != nil {
		t.Fatalf("UpdateProcessed re-run: %v", err)
	}
	got, _ = repo.GetByID(ctx, m.ID)
	if !bytes.Equal(got.BlurPreview, stripped) {
		t.Fatalf("blur_preview clobbered by re-process: %v", got.BlurPreview)
	}
}

// Waveform (пики голосового) сохраняется и читается без искажений.
func TestMediaRepo_Waveform(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+790")

	wf := []byte{0, 31, 5, 200, 255, 1, 63}
	m, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "voice1", Mime: "audio/ogg",
		Duration: 3, Waveform: wf,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := repo.GetByID(ctx, m.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if len(got.Waveform) != len(wf) {
		t.Fatalf("waveform len = %d, want %d", len(got.Waveform), len(wf))
	}
	for i := range wf {
		if got.Waveform[i] != wf[i] {
			t.Fatalf("waveform[%d] = %d, want %d", i, got.Waveform[i], wf[i])
		}
	}

	// не-голосовое: waveform nil сохраняется как NULL и читается пустым.
	m2, err := repo.Create(ctx, domain.Media{OwnerID: owner, Bucket: "media", ObjectKey: "img1", Mime: "image/png"})
	if err != nil {
		t.Fatalf("Create img: %v", err)
	}
	got2, err := repo.GetByID(ctx, m2.ID)
	if err != nil {
		t.Fatalf("GetByID img: %v", err)
	}
	if len(got2.Waveform) != 0 {
		t.Fatalf("expected empty waveform for image, got %v", got2.Waveform)
	}
}

// Теги трека, найденные ffprobe, сохраняются через UpdateProcessed и читаются
// read-моделью сообщений (DimsByIDs). Файл без тегов оставляет колонки NULL —
// DimsByIDs отдаёт пустые строки, а не падает на scan.
func TestMediaRepo_AudioTags(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	access := NewMediaAccessRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+791")

	tagged, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "song1", Mime: "audio/mpeg",
		Size: 3300000, FileName: "track.mp3",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	bare, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "song2", Mime: "audio/mpeg",
		Size: 100500, FileName: "notags.mp3",
	})
	if err != nil {
		t.Fatalf("Create bare: %v", err)
	}

	if err := repo.UpdateProcessed(ctx, tagged.ID, usecasemedia.ProcessedMeta{
		Duration: 139, Title: "Track One", Performer: "denis1488",
	}); err != nil {
		t.Fatalf("UpdateProcessed tagged: %v", err)
	}
	if err := repo.UpdateProcessed(ctx, bare.ID, usecasemedia.ProcessedMeta{Duration: 12}); err != nil {
		t.Fatalf("UpdateProcessed bare: %v", err)
	}

	dims, err := access.DimsByIDs(ctx, []int64{tagged.ID, bare.ID})
	if err != nil {
		t.Fatalf("DimsByIDs: %v", err)
	}
	if d := dims[tagged.ID]; d.Title != "Track One" || d.Performer != "denis1488" || d.Duration != 139 {
		t.Fatalf("tagged dims = %+v", d)
	}
	if d := dims[bare.ID]; d.Title != "" || d.Performer != "" || d.Duration != 12 {
		t.Fatalf("bare dims = %+v", d)
	}

	// Повторная обработка без тегов не затирает уже найденные.
	if err := repo.UpdateProcessed(ctx, tagged.ID, usecasemedia.ProcessedMeta{Duration: 139}); err != nil {
		t.Fatalf("UpdateProcessed re-run: %v", err)
	}
	dims, _ = access.DimsByIDs(ctx, []int64{tagged.ID})
	if d := dims[tagged.ID]; d.Title != "Track One" || d.Performer != "denis1488" {
		t.Fatalf("tags clobbered by re-process: %+v", d)
	}
}

// Признак гифки (media.animated → tweb doc.type === 'gif') сохраняется
// UpdateProcessed и читается read-моделью сообщений (DimsByIDs). В отличие от
// остальных полей он пишется БЕЗУСЛОВНО — у bool нет «пустого» значения,
// отличимого от false; владелец один (обработка ffmpeg), оба её входа кладут
// один и тот же результат Process.
func TestMediaRepo_AnimatedProcessed(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	access := NewMediaAccessRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+793")

	gif, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "gif1", Mime: "video/mp4", Size: 400000,
	})
	if err != nil {
		t.Fatalf("Create gif: %v", err)
	}
	video, err := repo.Create(ctx, domain.Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "vid1", Mime: "video/mp4", Size: 9000000,
	})
	if err != nil {
		t.Fatalf("Create video: %v", err)
	}
	// До обработки колонка имеет DEFAULT FALSE — «обычное видео».
	if got, _ := repo.GetByID(ctx, gif.ID); got.Animated {
		t.Fatalf("animated must default to false before processing")
	}

	if err := repo.UpdateProcessed(ctx, gif.ID, usecasemedia.ProcessedMeta{
		Width: 320, Height: 240, Duration: 3, Animated: true,
	}); err != nil {
		t.Fatalf("UpdateProcessed gif: %v", err)
	}
	if err := repo.UpdateProcessed(ctx, video.ID, usecasemedia.ProcessedMeta{
		Width: 1280, Height: 720, Duration: 61,
	}); err != nil {
		t.Fatalf("UpdateProcessed video: %v", err)
	}

	if got, _ := repo.GetByID(ctx, gif.ID); !got.Animated {
		t.Fatalf("GetByID: animated not persisted")
	}
	dims, err := access.DimsByIDs(ctx, []int64{gif.ID, video.ID})
	if err != nil {
		t.Fatalf("DimsByIDs: %v", err)
	}
	if d := dims[gif.ID]; !d.Animated {
		t.Fatalf("gif dims = %+v, want Animated", d)
	}
	if d := dims[video.ID]; d.Animated {
		t.Fatalf("plain video dims = %+v, want !Animated", d)
	}
}

func TestMediaRepo_ChunkedUploadTracking(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaRepo(pool)
	ctx := context.Background()
	owner := seedMediaOwner(t, repo, "+701")

	m, err := repo.Create(ctx, domain.Media{OwnerID: owner, Bucket: "media", ObjectKey: "k2", Mime: "video/mp4", Size: 1})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// SetUploadID is set-once: a second call returns the first (winning) id.
	winner, err := repo.SetUploadID(ctx, m.ID, "up-A")
	if err != nil || winner != "up-A" {
		t.Fatalf("SetUploadID first = %q, %v", winner, err)
	}
	winner, err = repo.SetUploadID(ctx, m.ID, "up-B")
	if err != nil || winner != "up-A" {
		t.Fatalf("SetUploadID second = %q (want up-A), %v", winner, err)
	}
	if err := repo.SetUploadTotal(ctx, m.ID, 3); err != nil {
		t.Fatalf("SetUploadTotal: %v", err)
	}

	// SavePart upserts; re-saving a part overwrites its ETag.
	if err := repo.SavePart(ctx, m.ID, 2, "e2", 8); err != nil {
		t.Fatalf("SavePart 2: %v", err)
	}
	if err := repo.SavePart(ctx, m.ID, 1, "e1", 8); err != nil {
		t.Fatalf("SavePart 1: %v", err)
	}
	if err := repo.SavePart(ctx, m.ID, 1, "e1b", 8); err != nil {
		t.Fatalf("SavePart 1 re-upload: %v", err)
	}

	recv, err := repo.ReceivedParts(ctx, m.ID)
	if err != nil || len(recv) != 2 || recv[0] != 1 || recv[1] != 2 {
		t.Fatalf("ReceivedParts = %v, %v", recv, err)
	}
	parts, err := repo.PartsForComplete(ctx, m.ID)
	if err != nil || len(parts) != 2 || parts[0].PartNumber != 1 || parts[0].ETag != "e1b" {
		t.Fatalf("PartsForComplete = %+v, %v", parts, err)
	}

	// GetByID reflects the multipart bookkeeping.
	got, _ := repo.GetByID(ctx, m.ID)
	if got.UploadID != "up-A" || got.UploadTotal != 3 {
		t.Fatalf("GetByID upload state = %q/%d", got.UploadID, got.UploadTotal)
	}

	// ClearUpload wipes parts and resets the bookkeeping.
	if err := repo.ClearUpload(ctx, m.ID); err != nil {
		t.Fatalf("ClearUpload: %v", err)
	}
	recv, _ = repo.ReceivedParts(ctx, m.ID)
	got, _ = repo.GetByID(ctx, m.ID)
	if len(recv) != 0 || got.UploadID != "" || got.UploadTotal != 0 {
		t.Fatalf("after ClearUpload: recv=%v upload=%q/%d", recv, got.UploadID, got.UploadTotal)
	}
}
