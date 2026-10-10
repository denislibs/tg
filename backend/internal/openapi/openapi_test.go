package openapi

import (
	"strings"
	"testing"
)

// Удалённые ручки в спеке не описываются: GET /members, /bans, /restrictions
// сняты (в tweb их нет, участники — /participants), ревью #411 п. 3.
func TestSpec_NoRemovedParticipantGETs(t *testing.T) {
	lines := strings.Split(string(spec), "\n")
	for k, line := range lines {
		for _, path := range []string{"/members:", "/bans:", "/restrictions:"} {
			if strings.HasPrefix(line, "  /chats/{chatID}") && strings.HasSuffix(line, path) {
				for _, next := range lines[k+1:] {
					if strings.HasPrefix(next, "  /") {
						break
					}
					if next == "    get:" {
						t.Errorf("в спеке остался GET %s", strings.TrimSpace(line))
					}
				}
			}
		}
	}
}
