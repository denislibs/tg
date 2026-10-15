package ws

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф7-Г (MC-06): NACK платной отправки называется кодами TG.
func TestSendNackReason_Paid(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{domain.ErrAllowPaymentRequired{Stars: 5}, "ALLOW_PAYMENT_REQUIRED_5"},
		{fmt.Errorf("send: %w", domain.ErrAllowPaymentRequired{Stars: 15}), "ALLOW_PAYMENT_REQUIRED_15"},
		{domain.ErrBalanceTooLow, "BALANCE_TOO_LOW"},
		{domain.ErrSlowmodeWait{Seconds: 30}, "SLOWMODE_WAIT_30"},
		{fmt.Errorf("send: %w", domain.ErrSlowmodeWait{Seconds: 7}), "SLOWMODE_WAIT_7"},
		{errors.New("boom"), "failed"},
	}
	for _, c := range cases {
		if got := sendNackReason(c.err); got != c.want {
			t.Errorf("sendNackReason(%v) = %q, want %q", c.err, got, c.want)
		}
	}
}

func TestSendMessageData_AllowPaidStars(t *testing.T) {
	var d sendMessageData
	if err := json.Unmarshal([]byte(`{"peer_id":5,"text":"x","allow_paid_stars":7}`), &d); err != nil {
		t.Fatal(err)
	}
	if d.AllowPaidStars != 7 {
		t.Fatalf("AllowPaidStars = %d, want 7", d.AllowPaidStars)
	}
}
