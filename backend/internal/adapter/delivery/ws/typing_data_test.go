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
