package domain

// Admin rights bitmask for group/channel members (role 'admin'). The creator
// implicitly has all rights.
type Rights int

const (
	RightPostMessages   Rights = 1 << 0
	RightEditMessages   Rights = 1 << 1
	RightDeleteMessages Rights = 1 << 2
	RightBanUsers       Rights = 1 << 3
	RightInviteUsers    Rights = 1 << 4
	RightPinMessages    Rights = 1 << 5
	RightChangeInfo     Rights = 1 << 6
	RightManageAdmins   Rights = 1 << 7

	AllRights Rights = RightPostMessages | RightEditMessages | RightDeleteMessages |
		RightBanUsers | RightInviteUsers | RightPinMessages | RightChangeInfo | RightManageAdmins
)

// Roles stored in chat_members.role.
const (
	RoleCreator    = "creator"
	RoleAdmin      = "admin"
	RoleMember     = "member"     // group member (may post)
	RoleSubscriber = "subscriber" // channel subscriber (read-only)
)

// HasRight reports whether a (role, rights) pair grants r. Creator → always true.
func HasRight(role string, rights Rights, r Rights) bool {
	if role == RoleCreator {
		return true
	}
	if role == RoleAdmin {
		return rights&r == r
	}
	return false
}
