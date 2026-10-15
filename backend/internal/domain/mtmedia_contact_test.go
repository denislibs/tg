package domain

import (
	"encoding/json"
	"testing"
)

// f6-contact: на проводе визитка несёт имя, фамилию, телефон и vcard
// отправителя раздельно, а user_id — только выведенный сервером.
func TestMessageMediaContact_Fields(t *testing.T) {
	first, last, phone, vcard := "Боб", "Иванов", "+70000000000", "BEGIN:VCARD"
	m := Message{Type: "contact", ContactName: &first, ContactLastName: &last, ContactPhone: &phone, ContactVcard: &vcard}
	raw, err := json.Marshal(m.WireMedia())
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"_": MessageMediaContactTag, "first_name": first, "last_name": last,
		"phone_number": phone, "vcard": vcard, "user_id": float64(0),
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}
	if len(got) != len(want) {
		t.Errorf("лишние ключи: %v", got)
	}
}

// Визитка определяется по first_name, а не по user_id: аккаунта у неё может не
// быть (номер не найден или скрыт).
func TestMessage_IsContactWithoutAccount(t *testing.T) {
	empty := ""
	m := Message{Type: "contact", ContactName: &empty}
	if !m.IsContact() || m.ContactInput() == nil {
		t.Fatal("визитка с пустым именем и без аккаунта не распознана")
	}
	if (Message{Type: "text"}).IsContact() || (Message{}).ContactInput() != nil {
		t.Fatal("обычное сообщение принято за визитку")
	}
}

// Ключ `media` тела отправки: inputMediaContact → визитка, inputMediaWebPage →
// превью; user_id в inputMediaContact схемы нет и не принимается.
func TestSendMedia_Unmarshal(t *testing.T) {
	var c SendMedia
	if err := json.Unmarshal([]byte(`{"_":"inputMediaContact","first_name":"Боб","last_name":"Иванов","phone_number":"+7","vcard":"v","user_id":5}`), &c); err != nil {
		t.Fatal(err)
	}
	if c.WebPage != nil || c.Contact == nil || c.Contact.FirstName != "Боб" || c.Contact.LastName != "Иванов" ||
		c.Contact.PhoneNumber != "+7" || c.Contact.Vcard != "v" {
		t.Fatalf("визитка: %+v", c)
	}
	if out, _ := json.Marshal(c.Contact); string(out) == "" || containsKey(out, "user_id") {
		t.Fatalf("вход визитки несёт user_id: %s", out)
	}
	var w SendMedia
	if err := json.Unmarshal([]byte(`{"_":"inputMediaWebPage","url":"https://a.example"}`), &w); err != nil {
		t.Fatal(err)
	}
	if w.Contact != nil || w.WebPage == nil || w.WebPage.URL != "https://a.example" {
		t.Fatalf("превью: %+v", w)
	}
	var n SendMedia
	if err := json.Unmarshal([]byte(`null`), &n); err != nil || n.Contact != nil || n.WebPage != nil {
		t.Fatalf("null: %+v %v", n, err)
	}
}

func containsKey(raw []byte, key string) bool {
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	_, ok := m[key]
	return ok
}
