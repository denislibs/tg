package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePhotoAdder captures AddProfilePhoto calls (the accept side effect).
type fakePhotoAdder struct {
	calls []struct {
		userID  int64
		mediaID int64
	}
}

func (f *fakePhotoAdder) AddProfilePhoto(_ context.Context, userID, mediaID int64, _ *int64) (domain.ProfilePhoto, error) {
	f.calls = append(f.calls, struct {
		userID  int64
		mediaID int64
	}{userID, mediaID})
	return domain.ProfilePhoto{ID: int64(len(f.calls)), MediaID: mediaID}, nil
}

func TestSuggestAndAcceptProfilePhoto(t *testing.T) {
	ctx := context.Background()
	in, s := newInteractor()
	adder := &fakePhotoAdder{}
	in.SetProfilePhotos(adder)

	const suggester, recipient = int64(1), int64(2)
	s.seedMedia(99, suggester) // the suggested photo belongs to the suggester
	msg, err := in.SuggestProfilePhoto(ctx, suggester, recipient, 99)
	if err != nil {
		t.Fatalf("SuggestProfilePhoto: %v", err)
	}
	if msg.Type != "service" || msg.MediaID == nil || *msg.MediaID != 99 {
		t.Fatalf("suggest message: type=%q media=%v", msg.Type, msg.MediaID)
	}

	// The suggester may not accept their own suggestion.
	if err := in.AcceptProfilePhotoSuggestion(ctx, suggester, msg.ID); err != domain.ErrForbidden {
		t.Fatalf("suggester accept = %v; want ErrForbidden", err)
	}

	// The recipient accepts → photo lands in their gallery.
	if err := in.AcceptProfilePhotoSuggestion(ctx, recipient, msg.ID); err != nil {
		t.Fatalf("recipient accept: %v", err)
	}
	if len(adder.calls) != 1 || adder.calls[0].userID != recipient || adder.calls[0].mediaID != 99 {
		t.Fatalf("AddProfilePhoto calls = %+v", adder.calls)
	}

	// Accepting twice is rejected (idempotent guard).
	if err := in.AcceptProfilePhotoSuggestion(ctx, recipient, msg.ID); err != domain.ErrConflict {
		t.Fatalf("second accept = %v; want ErrConflict", err)
	}
	if len(adder.calls) != 1 {
		t.Fatalf("photo added twice: %+v", adder.calls)
	}
}

func TestAcceptProfilePhoto_NotWired(t *testing.T) {
	ctx := context.Background()
	in, _ := newInteractor() // no SetProfilePhotos
	if err := in.AcceptProfilePhotoSuggestion(ctx, 2, 1); err != domain.ErrNotFound {
		t.Fatalf("accept without gallery = %v; want ErrNotFound", err)
	}
}
