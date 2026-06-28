import type { RestClient } from '../net/restClient'

// One address-book entry as the UI uses it (camelCase). The saved name is the
// owner's name for this contact; the profile fields (username/avatar/phone) are
// the peer's own, joined by the backend for display.
export interface Contact {
  userId: number
  firstName: string
  lastName: string
  note: string
  sharePhone: boolean
  username?: string
  avatarUrl: string
  phone: string
  displayName: string
  createdAt: string
}

interface RawContact {
  user_id: number
  first_name: string
  last_name: string
  note: string
  share_phone: boolean
  username?: string | null
  avatar_url: string
  phone: string
  display_name: string
  created_at: string
}

const mapContact = (c: RawContact): Contact => ({
  userId: c.user_id,
  firstName: c.first_name,
  lastName: c.last_name,
  note: c.note,
  sharePhone: c.share_phone,
  username: c.username ?? undefined,
  avatarUrl: c.avatar_url,
  phone: c.phone,
  displayName: c.display_name,
  createdAt: c.created_at,
})

export interface AddContactInput {
  contactId: number
  firstName: string
  lastName?: string
  note?: string
  sharePhone?: boolean
}

export interface ContactsDeps {
  rest: RestClient
}

export function newContactsManager({ rest }: ContactsDeps) {
  return {
    async add(input: AddContactInput): Promise<Contact> {
      return mapContact(
        await rest.post<RawContact>('/contacts', {
          contact_id: input.contactId,
          first_name: input.firstName,
          last_name: input.lastName ?? '',
          note: input.note ?? '',
          share_phone: input.sharePhone ?? false,
        }),
      )
    },

    async list(): Promise<Contact[]> {
      const r = await rest.get<{ contacts: RawContact[] }>('/contacts')
      return r.contacts.map(mapContact)
    },

    async del(contactId: number): Promise<void> {
      await rest.del(`/contacts/${contactId}`)
    },
  }
}

export type ContactsManager = ReturnType<typeof newContactsManager>
