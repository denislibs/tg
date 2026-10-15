package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePhoneResolver — порт PhoneResolver: номер → аккаунт; hidden — номера,
// которые правило added_by_phone прячет от отправителя.
type fakePhoneResolver struct {
	byPhone map[string]int64
	hidden  map[string]bool
	err     error
	calls   int
}

func (f *fakePhoneResolver) ResolvePhone(_ context.Context, _ int64, phone string) (int64, bool, error) {
	f.calls++
	if f.err != nil {
		return 0, false, f.err
	}
	id, ok := f.byPhone[phone]
	if !ok || f.hidden[phone] {
		return 0, false, nil
	}
	return id, true, nil
}

const (
	cmAlice int64 = 1
	cmBob   int64 = 2
	cmCarol int64 = 3
)

// contactEnv — личка Алисы и Боба; у Кэрол номер, который знает резолвер.
func contactEnv(t *testing.T) (*Interactor, *store, *fakePhoneResolver, int64) {
	t.Helper()
	in, s := newInteractor()
	in.SetPublisher(&fakePublisher{})
	res := &fakePhoneResolver{byPhone: map[string]int64{"+79990000003": cmCarol}, hidden: map[string]bool{}}
	in.SetPhoneResolver(res)
	chat, err := in.CreatePrivateChat(context.Background(), cmAlice, cmBob)
	if err != nil {
		t.Fatal(err)
	}
	return in, s, res, chat
}

func sendContact(in *Interactor, chat int64, c domain.InputMediaContact) (domain.Message, error) {
	return in.Send(context.Background(), SendInput{ChatID: chat, SenderID: cmAlice, Type: "contact", Contact: &c})
}

// В-10: имя, фамилия, телефон и vcard доходят до сообщения РАЗДЕЛЬНО и ровно
// такими, какими их прислал отправитель.
func TestSendContact_FieldsArriveSeparately(t *testing.T) {
	in, _, _, chat := contactEnv(t)
	msg, err := sendContact(in, chat, domain.InputMediaContact{
		FirstName: "Кэрол", LastName: "Данверс", PhoneNumber: "+79990000003", Vcard: "BEGIN:VCARD\nEND:VCARD"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	m, ok := msg.WireMedia().(*domain.MessageMediaContact)
	if !ok {
		t.Fatalf("медиа = %T, want *MessageMediaContact", msg.WireMedia())
	}
	if m.FirstName != "Кэрол" || m.LastName != "Данверс" || m.PhoneNumber != "+79990000003" ||
		m.Vcard != "BEGIN:VCARD\nEND:VCARD" || m.UserID != cmCarol {
		t.Fatalf("визитка = %+v", *m)
	}
}

// Телефон сервер не подставляет: без номера от отправителя его нет, даже если
// у найденного по другому пути аккаунта номер есть.
func TestSendContact_ServerNeverFillsPhone(t *testing.T) {
	in, _, res, chat := contactEnv(t)
	msg, err := sendContact(in, chat, domain.InputMediaContact{FirstName: "Кэрол"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	m := msg.WireMedia().(*domain.MessageMediaContact)
	if m.PhoneNumber != "" || m.UserID != 0 {
		t.Fatalf("сервер подставил данные: %+v", *m)
	}
	if res.calls != 0 {
		t.Fatalf("резолвер вызван без номера: %d", res.calls)
	}
}

// user_id выводится по номеру правилом added_by_phone: найден — id, скрыт или
// незнаком — 0.
func TestSendContact_UserIDFromPhone(t *testing.T) {
	in, _, res, chat := contactEnv(t)
	res.hidden["+79990000003"] = true
	res.byPhone["+79990000004"] = 4
	for name, tc := range map[string]struct {
		phone string
		want  int64
	}{
		"найден":            {"+79990000004", 4},
		"скрыт правилом":    {"+79990000003", 0},
		"несуществующий":    {"+79990000099", 0},
		"пустой":            {"", 0},
		"не номер, а текст": {"hello", 0},
	} {
		msg, err := sendContact(in, chat, domain.InputMediaContact{FirstName: "Х", PhoneNumber: tc.phone})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got := msg.WireMedia().(*domain.MessageMediaContact).UserID; got != tc.want {
			t.Errorf("%s: user_id=%d, want %d", name, got, tc.want)
		}
		if msg.IsContact() != true {
			t.Errorf("%s: сообщение без аккаунта перестало быть визиткой", name)
		}
	}
}

// Без резолвера (порт не подключён) визитка уходит с user_id=0.
func TestSendContact_NoResolver(t *testing.T) {
	in, _, _, chat := contactEnv(t)
	in.SetPhoneResolver(nil)
	msg, err := sendContact(in, chat, domain.InputMediaContact{FirstName: "Кэрол", PhoneNumber: "+79990000003"})
	if err != nil {
		t.Fatal(err)
	}
	if got := msg.WireMedia().(*domain.MessageMediaContact).UserID; got != 0 {
		t.Fatalf("user_id=%d без резолвера", got)
	}
}

// Сбой хранилища при поиске — отказ отправки, а не молчаливый user_id=0.
func TestSendContact_ResolverFailureFailsSend(t *testing.T) {
	in, s, res, chat := contactEnv(t)
	res.err = errors.New("db down")
	if _, err := sendContact(in, chat, domain.InputMediaContact{FirstName: "К", PhoneNumber: "+79990000003"}); err == nil {
		t.Fatal("сбой резолвера проглочен")
	}
	if n := len(messagesOf(s, chat)); n != 0 {
		t.Fatalf("в чате %d сообщений после отказа", n)
	}
}

// type=contact без поля media — отказ; media-визитка у не-визитки игнорируется.
func TestSendContact_TypeAndMediaMustAgree(t *testing.T) {
	in, _, res, chat := contactEnv(t)
	ctx := context.Background()
	if _, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: cmAlice, Type: "contact"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("contact без media: %v, want ErrForbidden", err)
	}
	msg, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: cmAlice, Text: "привет",
		Contact: &domain.InputMediaContact{FirstName: "Х"}})
	if err != nil {
		t.Fatal(err)
	}
	if msg.IsContact() || msg.ContactName != nil {
		t.Fatalf("визитка прилипла к текстовому сообщению: %+v", msg)
	}
	if res.calls != 0 {
		t.Fatalf("поиск по номеру на отправке не-визитки: %d вызовов", res.calls)
	}
}

// Отказанная гейтами отправка поиск по номеру не тратит.
func TestSendContact_RejectedSendDoesNotResolve(t *testing.T) {
	in, _, res, chat := contactEnv(t)
	in.SetPrivacy(blockedBy{owner: cmBob})
	_, err := sendContact(in, chat, domain.InputMediaContact{FirstName: "К", PhoneNumber: "+79990000003"})
	if !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("err=%v, want ErrPrivacy", err)
	}
	if res.calls != 0 {
		t.Fatalf("поиск по номеру после отказа: %d вызовов", res.calls)
	}
}

// Строка очереди, поставленная до деплоя (contact_user_id + полное имя в
// contact_name, без фамилии и vcard), публикуется: имя уходит как first_name.
func TestScheduledContact_LegacyRow(t *testing.T) {
	var p domain.ScheduledParams
	if err := json.Unmarshal([]byte(`{"contact_user_id":3,"contact_name":"Кэрол Данверс","contact_phone":"+79990000003"}`), &p); err != nil {
		t.Fatal(err)
	}
	in := sendInputOf(domain.ScheduledMessage{Type: "contact", Params: p})
	want := domain.InputMediaContact{FirstName: "Кэрол Данверс", PhoneNumber: "+79990000003"}
	if in.Contact == nil || *in.Contact != want {
		t.Fatalf("Contact = %+v, want %+v", in.Contact, want)
	}
}

// Поля визитки приходят от клиента: длина ограничена, управляющий NUL
// (Postgres его не хранит) и битый UTF-8 отвергаются, а не роняют вставку.
func TestSendContact_FieldLimits(t *testing.T) {
	in, _, _, chat := contactEnv(t)
	long := strings.Repeat("я", maxContactNameRunes+1)
	for name, tc := range map[string]struct {
		c    domain.InputMediaContact
		want error
	}{
		"длинное имя":       {domain.InputMediaContact{FirstName: long}, domain.ErrTooLong},
		"длинная фамилия":   {domain.InputMediaContact{FirstName: "К", LastName: long}, domain.ErrTooLong},
		"длинный телефон":   {domain.InputMediaContact{FirstName: "К", PhoneNumber: strings.Repeat("1", maxContactPhoneRunes+1)}, domain.ErrTooLong},
		"длинный vcard":     {domain.InputMediaContact{FirstName: "К", Vcard: strings.Repeat("v", maxContactVcardRunes+1)}, domain.ErrTooLong},
		"NUL в имени":       {domain.InputMediaContact{FirstName: "К\x00"}, domain.ErrInvalid},
		"битый UTF-8":       {domain.InputMediaContact{FirstName: "К\xff"}, domain.ErrInvalid},
		"границы допустимы": {domain.InputMediaContact{FirstName: strings.Repeat("я", maxContactNameRunes), Vcard: strings.Repeat("v", maxContactVcardRunes)}, nil},
	} {
		_, err := sendContact(in, chat, tc.c)
		if !errors.Is(err, tc.want) && !(tc.want == nil && err == nil) {
			t.Errorf("%s: err=%v, want %v", name, err, tc.want)
		}
	}
}

// Отложенная визитка публикуется с теми же полями; user_id выводится заново.
func TestScheduledContact_PublishesSameFields(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	res := &fakePhoneResolver{byPhone: map[string]int64{"+79990000003": cmCarol}}
	in.SetPhoneResolver(res)
	chat, _ := fakeChats{s}.CreatePrivate(ctx, cmAlice, cmBob)
	c := domain.InputMediaContact{FirstName: "Кэрол", LastName: "Данверс", PhoneNumber: "+79990000003", Vcard: "BEGIN:VCARD"}
	queued, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: cmAlice, Type: "contact", Contact: &c, ScheduleDate: future()})
	if err != nil {
		t.Fatalf("постановка: %v", err)
	}
	// Лента отложенных отдаёт бабл с теми же полями.
	if m, ok := queued.WireMedia().(*domain.MessageMediaContact); !ok || m.LastName != "Данверс" || m.Vcard != "BEGIN:VCARD" || m.UserID != cmCarol {
		t.Fatalf("бабл отложенного = %+v", queued.WireMedia())
	}
	if _, err := in.SendScheduledNow(ctx, chat, cmAlice, []int64{queued.Seq}); err != nil {
		t.Fatalf("send_now: %v", err)
	}
	got := messagesOf(s, chat)
	if len(got) != 1 {
		t.Fatalf("опубликовано %d", len(got))
	}
	m := got[0].WireMedia().(*domain.MessageMediaContact)
	if m.FirstName != "Кэрол" || m.LastName != "Данверс" || m.PhoneNumber != "+79990000003" || m.Vcard != "BEGIN:VCARD" || m.UserID != cmCarol {
		t.Fatalf("опубликованная визитка = %+v", *m)
	}
	if fs.count() != 0 {
		t.Fatalf("строка очереди не снята: %d", fs.count())
	}
}

// Пересылка и копия сохраняют все поля визитки (и «аккаунта нет»).
func TestForwardContact_KeepsFields(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	in.SetPublisher(&fakePublisher{})
	src, _ := in.CreatePrivateChat(ctx, cmAlice, cmBob)
	dst, _ := in.CreatePrivateChat(ctx, cmAlice, cmCarol)
	msg, err := in.Send(ctx, SendInput{ChatID: src, SenderID: cmBob, Type: "contact",
		Contact: &domain.InputMediaContact{FirstName: "Д", LastName: "Ж", PhoneNumber: "+7000", Vcard: "vc"}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, SenderID: cmAlice, MsgIDs: []int64{msg.ID}})
	if err != nil || len(out) != 1 {
		t.Fatalf("ForwardMessages: %v (%d)", err, len(out))
	}
	m, ok := out[0].WireMedia().(*domain.MessageMediaContact)
	if !ok || m.FirstName != "Д" || m.LastName != "Ж" || m.PhoneNumber != "+7000" || m.Vcard != "vc" || m.UserID != 0 {
		t.Fatalf("копия = %+v", out[0].WireMedia())
	}
	_ = s
}

// Визитка — «медиа» для запрета send_media и неправимый контент, как раньше.
func TestContact_CarriesMediaAndIsNotEditable(t *testing.T) {
	if !(SendInput{Contact: &domain.InputMediaContact{}}).carriesMedia() {
		t.Fatal("визитка не считается медиа для send_media")
	}
	empty := ""
	if editableContent(domain.Message{Type: "text", ContactName: &empty}) {
		t.Fatal("визитку можно править")
	}
}
