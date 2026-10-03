// Порт tweb `src/components/forumTab/register.ts` (812502980, 24 строки) — 1:1:
// реестр «пир → класс форум-таба» (`ForumTab.register`, `fillRegister.ts`).
type RegisterEntry<ToCheck, Payload> = {
  check: (value: ToCheck) => boolean,
  payload: Payload,
}

export class Register<ToCheck, Payload> {
  private entries: RegisterEntry<ToCheck, Payload>[] = []

  addEntry(entry: RegisterEntry<ToCheck, Payload>): void {
    this.entries.push(entry)
  }

  hasEntryFor(value: ToCheck): boolean {
    return this.entries.some((entry) => entry.check(value))
  }

  getEntry(value: ToCheck): Payload | undefined {
    for(const entry of this.entries) {
      if(entry.check(value)) {
        return entry.payload
      }
    }
  }
}
