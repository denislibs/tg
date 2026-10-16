package domain

import (
	"slices"
	"testing"
)

// Ключ privacyKeyPhoneP2P (tweb privacy/calls.tsx:19-27): «кто может звонить
// напрямую». Ручки адресуются конструктором схемы, а не нашей строкой.
func TestPrivacyPhoneP2P_Key(t *testing.T) {
	if !ValidPrivacyKey("phone_p2p") {
		t.Fatal("phone_p2p не принят как ключ")
	}
	if tag, ok := PrivacyKeyTag(PrivacyPhoneP2P); !ok || tag != "privacyKeyPhoneP2P" {
		t.Fatalf("PrivacyKeyTag(phone_p2p) = %q, %v; want privacyKeyPhoneP2P", tag, ok)
	}
	if key, ok := PrivacyKeyOf("privacyKeyPhoneP2P"); !ok || key != PrivacyPhoneP2P {
		t.Fatalf("PrivacyKeyOf(privacyKeyPhoneP2P) = %q, %v; want phone_p2p", key, ok)
	}
}

// Порядок секции tweb: «Звонки» и сразу за ними Peer-to-Peer.
func TestPrivacyPhoneP2P_OrderAfterCalls(t *testing.T) {
	calls := slices.Index(PrivacyKeys, PrivacyCalls)
	p2p := slices.Index(PrivacyKeys, PrivacyPhoneP2P)
	if calls < 0 || p2p != calls+1 {
		t.Fatalf("calls=%d phone_p2p=%d; want phone_p2p сразу после calls", calls, p2p)
	}
}

// Дефолт — «все» (В-S1): поведение звонков не меняется, пока пользователь
// сам не запретит прямое соединение.
func TestPrivacyPhoneP2P_DefaultEverybody(t *testing.T) {
	if got := DefaultPrivacyValue(PrivacyPhoneP2P); got != PrivacyEverybody {
		t.Fatalf("DefaultPrivacyValue(phone_p2p) = %q; want everybody", got)
	}
	if !ValidPrivacyValue(PrivacyPhoneP2P, PrivacyNobody) {
		t.Fatal("nobody для phone_p2p недопустим; в tweb допустимы все три значения")
	}
}
