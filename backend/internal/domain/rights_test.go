package domain

import "testing"

func TestHasRight(t *testing.T) {
	if !HasRight(RoleCreator, 0, RightBanUsers) {
		t.Fatal("creator must have every right")
	}
	if !HasRight(RoleAdmin, RightPostMessages|RightPinMessages, RightPinMessages) {
		t.Fatal("admin with the bit set must pass")
	}
	if HasRight(RoleAdmin, RightPostMessages, RightBanUsers) {
		t.Fatal("admin without the bit must fail")
	}
	if HasRight(RoleMember, AllRights, RightPostMessages) {
		t.Fatal("plain member has no admin rights")
	}
}
