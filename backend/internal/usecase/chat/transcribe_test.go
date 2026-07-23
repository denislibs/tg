package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestTranscribeMessage_VoiceCachesStub(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2

	chatID, err := fakeChats{s}.CreatePrivate(ctx, a, b)
	if err != nil {
		t.Fatalf("CreatePrivate: %v", err)
	}
	voice, err := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: chatID, SenderID: b, Type: "voice"})
	if err != nil {
		t.Fatalf("insert voice: %v", err)
	}

	// участник получает детерминированный стаб
	text, err := in.TranscribeMessage(ctx, chatID, voice.ID, a)
	if err != nil {
		t.Fatalf("transcribe: %v", err)
	}
	if text != transcriptionStub {
		t.Fatalf("text = %q; want stub %q", text, transcriptionStub)
	}

	// стаб закэширован на сообщении
	got, _ := in.msgs.GetByID(ctx, voice.ID)
	if got.Transcription == nil || *got.Transcription != transcriptionStub {
		t.Fatalf("transcription not cached: %+v", got.Transcription)
	}

	// повторный запрос отдаёт тот же кэш
	again, err := in.TranscribeMessage(ctx, chatID, voice.ID, a)
	if err != nil || again != transcriptionStub {
		t.Fatalf("second transcribe = %q, %v", again, err)
	}
}

func TestTranscribeMessage_NonVoiceAndNonMember(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b, outsider int64 = 1, 2, 9

	chatID, _ := fakeChats{s}.CreatePrivate(ctx, a, b)
	txt, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: chatID, SenderID: b, Type: "text", Text: "hi"})

	// не-голосовое/не-кружок → ErrInvalid
	if _, err := in.TranscribeMessage(ctx, chatID, txt.ID, a); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("text transcribe = %v; want ErrInvalid", err)
	}

	// не-участник → ErrForbidden
	voice, _ := fakeMsgs{s}.Insert(ctx, domain.Message{ChatID: chatID, SenderID: b, Type: "voice"})
	if _, err := in.TranscribeMessage(ctx, chatID, voice.ID, outsider); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("outsider transcribe = %v; want ErrForbidden", err)
	}
}
