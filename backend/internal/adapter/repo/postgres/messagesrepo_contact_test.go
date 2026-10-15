package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// f6-contact (0177): поля визитки — имя, фамилия, телефон, vcard — переживают
// запись и чтение раздельно; пустая строка остаётся значением, а визитка без
// аккаунта (contact_user_id NULL) остаётся визиткой.
func TestMessagesRepo_ContactFieldsRoundTrip(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7970")
	b := seedUser(t, pool, "+7971")
	chatID := createPrivate(t, pool, a, b)

	cases := map[string]domain.Message{
		"все поля и аккаунт": {ContactUserID: &b, ContactName: strp("Боб"), ContactLastName: strp("Иванов"),
			ContactPhone: strp("+79990000002"), ContactVcard: strp("BEGIN:VCARD\nEND:VCARD")},
		"аккаунта нет, пустая фамилия и vcard": {ContactName: strp("Кэрол"), ContactLastName: strp(""),
			ContactPhone: strp(""), ContactVcard: strp("")},
	}
	for name, m := range cases {
		seq, _ := msgs.NextSeq(ctx, chatID)
		m.ChatID, m.Seq, m.SenderID, m.Type = chatID, seq, a, "contact"
		ins, err := msgs.Insert(ctx, m)
		if err != nil {
			t.Fatalf("%s: Insert: %v", name, err)
		}
		got, err := msgs.GetByID(ctx, ins.ID)
		if err != nil {
			t.Fatalf("%s: GetByID: %v", name, err)
		}
		if !got.IsContact() {
			t.Errorf("%s: прочитанная строка не визитка: %+v", name, got)
		}
		if !eqPtr(got.ContactUserID, m.ContactUserID) || !eqPtr(got.ContactName, m.ContactName) ||
			!eqPtr(got.ContactLastName, m.ContactLastName) || !eqPtr(got.ContactPhone, m.ContactPhone) ||
			!eqPtr(got.ContactVcard, m.ContactVcard) {
			t.Errorf("%s: записано %+v, прочитано %+v", name, m, got)
		}
	}
	// Обычное сообщение визиткой не становится.
	seq, _ := msgs.NextSeq(ctx, chatID)
	txt, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if txt.IsContact() || txt.ContactLastName != nil || txt.ContactVcard != nil {
		t.Fatalf("текст стал визиткой: %+v", txt)
	}
}

func strp(s string) *string { return &s }

func eqPtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
