package ws

import (
	"encoding/json"
	"testing"
)

// typing несёт top_msg_id (серверный номер корня треда/темы) необязательным
// ключом: messages.setTyping{peer, action, top_msg_id?}.
func TestTypingData_TopMsgID(t *testing.T) {
	var in typingData
	if err := json.Unmarshal([]byte(`{"peer_id":-5,"top_msg_id":12,"action":{"_":"sendMessageTypingAction"}}`), &in); err != nil {
		t.Fatal(err)
	}
	if in.TopMsgID == nil || *in.TopMsgID != 12 || in.Action.Underscore != "sendMessageTypingAction" {
		t.Fatalf("typingData = %+v", in)
	}
	var none typingData
	if err := json.Unmarshal([]byte(`{"peer_id":-5,"action":{"_":"sendMessageTypingAction"}}`), &none); err != nil {
		t.Fatal(err)
	}
	if none.TopMsgID != nil {
		t.Fatalf("без ключа TopMsgID = %v", *none.TopMsgID)
	}
}

// Предел частоты: тот же (пир, тред, действие) чаще раза в секунду не проходит,
// другой тред или действие - проходят.
func TestConn_TypingAllowed(t *testing.T) {
	c := &Conn{}
	mk := func(top int64, action string) typingData {
		var d typingData
		d.PeerID = -5
		if top != 0 {
			d.TopMsgID = &top
		}
		d.Action.Underscore = action
		return d
	}
	if !c.typingAllowed(mk(12, "sendMessageTypingAction")) {
		t.Fatal("первый кадр должен пройти")
	}
	if c.typingAllowed(mk(12, "sendMessageTypingAction")) {
		t.Fatal("повтор в ту же секунду должен быть отброшен")
	}
	if !c.typingAllowed(mk(13, "sendMessageTypingAction")) {
		t.Fatal("другой тред - отдельный ключ")
	}
	if !c.typingAllowed(mk(12, "sendMessageUploadPhotoAction")) {
		t.Fatal("другое действие - отдельный ключ")
	}
	if !c.typingAllowed(mk(0, "sendMessageTypingAction")) {
		t.Fatal("вне треда - отдельный ключ")
	}
}
