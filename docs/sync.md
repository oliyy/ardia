# Sync

End-to-end-encrypted sync with no server, no account and no Apple entitlement. Every Mac reads
and writes sealed files in a folder the user picks; any service that syncs a folder carries them
between Macs. The default is `iCloud Drive › Ardia Sync`
(`~/Library/Mobile Documents/com~apple~CloudDocs/Ardia Sync`: iCloud Drive syncs any folder
under it, with no CloudKit container and no entitlement). Dropbox, a NAS or a USB drive work
the same way. A Mac that turned sync on before the rename keeps `Netnyahoo Sync`, and one setting up after it is
offered that folder while it holds the data (`SyncModule.defaultFolder`).

The UX follows Dia's sync (Settings › Account › Sync in Dia 1.50.1; its strings are quoted from
its binary below). Dia's data sits on its servers and devices pair with a 6-character code; here
the folder takes the servers' place and devices pair by entering the recovery phrase.

Code:
- `packages/sync/ios/Core`: plain Swift, also built by `packages/sync/Package.swift`.
  - `RecoveryPhrase.swift`: the phrase (BIP-39).
  - `SyncCrypto.swift`: keys, the file format and names.
  - `SyncVault.swift`: the folder, with file coordination and partial files.
  - `SyncKeyStore.swift`: Keychain.
  - `RecoveryKit.swift`: PDF, text sheet and QR code.
- `packages/sync/ios/SyncModule.swift`: the Expo module (`ArdiaSync`). It also reads this app's saved passwords.
- `packages/sync/src`: the merge, in TypeScript with no dependencies.
  - `scope.ts`: replica, logs, snapshots, compaction.
  - `hlc.ts`: hybrid logical clocks.
  - `order.ts`: fractional positions.
- `apps/browser/src/sync`:
  - `adapters.ts`: store ↔ records.
  - `engine.ts`: state, setup flows, the cycle.
  - `menu.ts`: the overflow menu's synced devices.
- `apps/browser/src/components/settings/panes/Sync.tsx` and `SyncSheets.tsx`: Settings › Sync.

## Threat model

Protected against anyone who can read or write the sync folder but doesn't have the phrase:
Apple, Dropbox, whoever has the NAS or finds the USB drive, malware that reads cloud files.

- They can't read anything. File contents are AES-256-GCM. Folder and file names are keyed
  (HMAC) or random, and say nothing about profiles, sites or data kinds.
- They can't change anything undetected. Every file is authenticated. The associated data binds a
  file to its folder and name, so a file can't be renamed, moved or truncated without failing to
  open. Files that fail are never applied.
- Contents are padded to 1 KiB steps and not compressed. The size of a file says little, and
  attacker-chosen page titles can't be used to probe passwords through compression
  (CRIME-style).

What they do see (metadata): how many profiles sync (one folder each) and how many devices; when
and how much each writes (file count, times, sizes to 1 KiB); and that it's Ardia sync data
(the `NNS1` magic and `.nns` extension).

What they can do: delete or withhold files (denial of service). Withheld files show as
"waiting for N files to download". They can also replay an old file under its own name, which is
harmless: files are immutable, a replayed op merges as a no-op, and an old snapshot can't bring back
a record whose deletion was already applied (see Compaction). They can't forge, reorder
within a file, or move data between profiles.

Not protected against:
- Someone with the phrase. The phrase is the key, like Dia's.
- Someone with the unlocked Mac. They have the data in the clear anyway.
- A compromised Ardia binary.

The phrase's entropy is in each Mac's login Keychain (`Ardia Sync Key`, this device only,
never iCloud Keychain). Losing every Mac and the Recovery Kit loses the synced data. There's no
reset by email, because there's no one to email.

## Recovery phrase and keys

- 24 BIP-39 English words encode 256 bits from `SecRandomCopyBytes` plus an 8-bit checksum (the
  first byte of their SHA-256). The same format as Dia's (its errors: "Recovery phrase must be
  exactly 24 words.", "This recovery phrase is not valid. Please check for typos.", "“%@” is not
  a valid recovery phrase word.").
- Input is lenient: case, punctuation, the kit's numbering ("1. abandon") and 4-letter prefixes
  are all accepted.
- The wordlist is the standard one; a test checks its SHA-256
  (`2f5eed53…dbda`) and Trezor's reference vectors.
- Keys: HKDF-SHA256 over the entropy, salt `netnyahoo-sync/v1`. The magic and the salt keep the app's old name
  for good: every Mac on any version reads the same files (`LegacyName` in `packages/sync/ios/Core/LegacyMigration.swift`).
  - `file-key` (AES-256-GCM) seals every file.
  - `name-key` (HMAC-SHA256) names folders: the chain tag is `HMAC("chain")` and a scope's tag
    is `HMAC("scope/<scope id>")`, each cut to 128 bits and written in base32.
  - The phrase already has 256 bits of entropy, so no password stretching is needed.
- Where the entropy is kept: the login Keychain, as a generic password (`Ardia Sync Key`,
  account = this device's sync id, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not
  synchronizable).
  - Test instances (`ARDIA_DATA_DIR`) keep it in a 0600 file in their data folder instead,
    as Chrome's mock keychain does for them.
  - A Debug build can't read an item an earlier build saved (no prompt, by design). Sync then
    shows "not syncing" with Enter Recovery Phrase…, and the same device carries on.
- The key never crosses to JS. The words do, only for the Recovery Kit and Connect Another Device
  sheets, or when the user types them.

A wrong phrase is caught in one of two ways. A typo fails the checksum. A valid but different
phrase derives a chain tag that isn't in the folder: "This recovery phrase doesn’t match the
synced data in this folder".

## Folder layout and file format

```
<sync folder>/
  <chain tag>/                 one per phrase (several people can share one folder)
    <scope tag>/               "app" (settings, profiles, devices) or "p:<profile sync id>"
      <file id>.nns            128 random bits, base32
```

A file is `"NNS1" | nonce (12) | AES-GCM ciphertext | tag (16)`.
- AAD: `"NNS1" + "<chain>/<scope>/<file>"`.
- Plaintext: `length (u32 BE) | UTF-8 JSON | zero padding` to the next 1024 bytes.

The JSON is one of:

```jsonc
// A log: a batch of one device's changes. seq counts up per device and scope.
{ "v": 1, "kind": "log", "device": "<id>", "seq": 7, "at": 1790000000000,
  "ops": [{ "k": "bm:<uuid>", "h": "<hlc>", "v": { … } }, { "k": "h:https://…", "h": "…", "v": null }] }
// A snapshot: a device's whole merged replica, and the seqs it covers per device.
{ "v": 1, "kind": "snapshot", "device": "<id>", "at": …, "vv": { "<device>": 41, … },
  "seen": { "<device>": <ms> }, "records": { "<key>": { "h": "<hlc>", "v": …, "o": ["<device>", <seq>] } } }
```

Writing:
- A device only ever creates files, each under a fresh random name, and never changes one. Two
  Macs never write the same file, so the sync service never sees a conflict.
- A file is written whole in a same-volume temporary folder, then moved in inside a coordinated
  write (`NSFileCoordinator`, `.forReplacing`). The sync client never sees half a file under a
  real name.
- A log's seq is never reused. A batch gets its seq and is saved, sealed, to `sync-v2-journal.nns` in
  the app's data folder before it's written (`persist`); a batch whose write fails stays queued
  with its seq. After a crash, `restoreJournal` puts the journalled batches back into the last
  saved state and the next cycle writes them again, byte for byte, before anything new. If the
  first write did land, the folder has the same batch twice, which reads as a no-op on every
  version. The journal is local only (no format change) and is emptied once the saved state
  has its batches.

Reading (`SyncVault.read`) handles files that aren't there in full yet:
- iCloud placeholders (`.<id>.nns.icloud` stubs, or dataless files whose
  `ubiquitousItemDownloadingStatus` isn't current) are reported as pending, and
  `startDownloadingUbiquitousItem` is asked for them.
- Files mid-copy (Dropbox, SMB) and empty files fail to open. They're reported as damaged, with
  their age, and retried next cycle; a file that still fails after a day is given up on.
- Everything else is read in a coordinated read.
- Nothing half-arrived is ever applied.

## Merge

Each scope holds a replica: `key → { h: HLC, v: value | null, o: [device, seq] }`.

- **Last writer wins per record** by hybrid logical clock. The HLC is
  `wall(ms, base 36, 9 digits).counter(4).device`, fixed width, so string comparison is clock
  comparison and the device id breaks ties.
- A deletion is a record with `v: null`, a tombstone.
- Merging is a join: commutative, associative and idempotent. Devices converge whatever order
  files arrive in, and a file read twice changes nothing.
- **Clock skew.** A clock never goes below the newest timestamp it has seen, so an edit made
  after seeing another device's edit is newer even if this Mac's clock is behind. Only truly
  concurrent edits are ordered by the (possibly skewed) wall clocks. A Mac whose clock is days
  ahead wins edits concurrent with it, but the next edit anywhere after it syncs wins again (tested).
- **Base, three-way.** Each scope keeps `base`: what the local store held after the last publish
  or apply. A local value different from base is a local edit and becomes an op. A key in base
  but gone locally is a local deletion. Remote changes are applied only over keys with no
  unpublished edits. Each adapter publishes and then applies, with no wait in between, so an
  edit made while files were being read wins and isn't overwritten (tested).
- **Joining.** Local data is published before remote data is applied, so joining is a union: no
  local bookmark, visit or password is lost. Settings and profile names are the exception
  (`adoptRemoteOnJoin`): a joining Mac takes the synced values and doesn't publish its defaults
  until it has read another device's file (`awaitRemote`). Data that existed before sync was
  turned on (passwords, history) is published with its own creation time
  (`Clock.at(editedAt)`), so it doesn't beat a later edit made elsewhere.
- **Version vectors.** `vv[device]` is the highest seq such that every file of that device up to
  it is in the replica. Seqs that arrive out of order wait in `extra` until the gap fills
  (tested).

### Compaction

- **When.** A device writes a snapshot of its replica when a scope has more than 40 files and no
  snapshot has been written in 10 minutes.
- **What it leaves out.** Tombstones older than 45 days are dropped from the snapshot, and so are
  history records older than 90 days.
- **What it removes.** Then it removes, once they're an hour old, the files the snapshot covers:
  logs `(d, s)` with `s ≤ vv[d]`, and snapshots whose `vv` it dominates.
- **Why that's safe.** A snapshot is self-contained, so any device can start from it, and
  concurrent compactions only remove files covered by their own snapshot.
- **Missing logs keep tombstones.** While a replica is missing a log that a later one from the
  same device skipped past (its version vector has a gap), compaction keeps tombstones up to
  90 days instead of 45, since that log could hold an older write that would otherwise come
  back. A log that never shows up holds them for 90 days at most (tested).
- **Known residuals** (each pinned in a test):
  - A log delivered after the hold (45 days, or 90 while this replica sees a gap) can bring a
    deleted record back.
  - A snapshot doesn't carry its writer's gaps, so a Mac that joins from it while a log is still
    missing, and doesn't see a later log of that device itself, holds tombstones 45 days, not 90.
  - A log that never arrives keeps its gap open, and the later logs of its device that the gap
    keeps from being covered stay in the folder.
- **Not done: causal stability.** Dropping a tombstone only once every device has applied it and
  everything written before it would close these, but it's a separate project. An attempt
  (reverted in 7b334d07) showed what it has to get right: stability must count writers whose files
  haven't arrived yet; rebasing a device must not clear the base adapters rely on (the passwords
  adapter then republished an old password over a newer one); a device's incarnation and its
  journal must be saved together, or a restart drops a durable batch; and a restored backup
  must not reuse an incarnation and sequence numbers, or its edits are ignored. It also has to
  run its upkeep in small scopes (under 40 files) and not trust wall clocks for retirement.
- **Collected tombstones.** A device that missed a deletion whose tombstone has since been
  collected still learns of it. Applying a snapshot drops every local record whose origin file
  the snapshot covers but which the snapshot doesn't contain (`ingestSnapshot`). A log a snapshot
  covers is never replayed after it, so a collected deletion can't come back.
- **Old snapshots.** The same holds the other way round. A snapshot record whose origin this
  replica has already applied (its version vector, which is never collected), for a key the
  replica no longer has, is a deletion already applied and is skipped. So a snapshot put back in
  the folder after its tombstones were collected (a replay, a late backup restore) brings nothing
  back (tested). There's no format change. A 0.2.10 Mac still takes such records in, but the
  next snapshot from a newer Mac covers them and leaves them out, which removes them there again.
- **A device offline for weeks.** It reads the newest snapshot and whatever logs came after,
  applies them, and publishes its offline edits (tested). The one gap: an edit made offline to a
  record that was deleted elsewhere, whose tombstone was collected more than 45 days ago, comes
  back as a new record.

### Order

Bookmark folders and the pinned container are ordered by fractional positions (`order.ts`,
base 62, never ending in "0"). A move changes the moved item's position only. Positions are
assigned by keeping the longest increasing run of known positions, so two Macs reordering
different items merge. Equal positions (two inserts in the same place) sort by id and are
separated on the next publish.

## What syncs

Per profile: each synced profile is its own scope, with its own opt-in (Settings › Sync ›
Profiles).
- On joining, Personal pairs with the synced default profile and other profiles pair by name.
- A synced profile this Mac lacks is offered as "Add to This Mac".
- Profiles that share another's data (Dia's "Share data with another profile") sync their tabs;
  the shared data syncs with the profile that owns it.
- Which profile's data a profile shares travels as `share:<sync id>` (the owner's sync id), so "Add to This Mac" makes
  it share this Mac's own copy of that owner, adding the owners it leads to first when this Mac lacks them (the whole
  chain is worked out before anything is created). When an owner's `prof:` record hasn't arrived yet, the profile
  waits ("Waiting for the profile it shares data with to sync") rather than getting data of its own. Records from
  different Macs can disagree, even into a cycle; the lowest sync id in a cycle owns the data, so every Mac resolves it
  alike. A profile already here keeps the data it has.
- A profile's sharing is fixed for its life, so `share:` is written once: a Mac publishes it for a profile that shares a
  synced owner's data only while the scope has no record of that key (one a 0.2.38 Mac kept unapplied counts), and
  only once this session has pulled the app scope with no download and no damaged file still unresolved
  (`publishAfterPull`; either stops counting after a day, a download from when the scope first saw it pending, kept as
  `pendingSince`; a time ahead of the clock counts as now, so a file iCloud never brings down can't hold it back for good), so a Mac back on an older saved
  state sees what's out there first. A sharing profile's `prof:` goes out with its `share:`, in the same batch, so no
  Mac offers it without its sharing. Never as a tombstone, so a deleted profile offered again by "Add to This Mac"
  shares as before, and never over a value this Mac has. Known residual: a value another Mac published that this Mac
  hasn't pulled yet can lose to this Mac's, when a profile's owner starts syncing here mid-session (the cycle's first
  publish runs before its pull); both Macs then keep their own data.
- Limit: a profile that shares the data of an owner deleted on its Mac publishes no `share:`; on other Macs it gets
  data of its own, as before 0.2.39. That data group's bookmarks, history and passwords no longer sync from that Mac
  anyway: only a profile without `dataId` syncs data.

| Key | Scope | What | Notes |
|---|---|---|---|
| `set:<name>` | app | the settings that follow the user (`SYNCED_SETTINGS`: search engine and custom engines, appearance, address bar, tab layout and behaviour, bookmarks bar, full URL, muted sites, clean-up, keyboard shortcuts…) | not window sizes, battery saver, extension engines or the default profile id |
| `prof:<sync id>` | app | a profile's name, colour, icon (`d` for the default) | deleting a profile on one Mac doesn't delete it on another. A `th` field written by development builds of 0.2.40 is read once, as the profile's theme, when it has none |
| `pth:<sync id>` | app | a profile's custom theme `{ t }`, or `{ preset: true }` after going back to a preset colour | its own record, so a rename and a theme change on two Macs both survive, and Macs before 0.2.40, which rebuild `prof:` from what they know, never strip or republish it (tested with a 0.2.38 adapter). Written once a profile has had a custom theme. A profile paired on joining takes the synced theme (or a legacy `th`) before it can publish its own, and a legacy `th` never applies once a `pth:` record is known (tested). A profile paired on joining or added from sync is adopting (`themeAdopting` on its link in `sync-v2.json`, so a restart keeps it): its theme isn't published, with no time limit, until its `pth:` record is applied (also by an older build: a valid `pth:` already in the base ends it at launch and on each cycle), a pull with nothing downloading, damaged or given up as bad shows there is none, or the user edits its theme or picks a preset on this Mac. Turning the profile's sync off and on keeps it adopting. Other profiles, and links from before this flag, publish edits at once, whatever else is still downloading; none publishes over a `pth:` record that has arrived but isn't applied yet (tested). Older Macs keep showing the preset colour, which choosing a custom theme doesn't change |
| `share:<sync id>` | app | `{ o }`: the sync id of the profile whose data this one shares | its own key, not a field of `prof:`, so Macs before 0.2.39 keep it untouched instead of republishing `prof:` without it on every cycle; written once, while both sync; never deleted |
| `dev:<device id>` | app | a device's name | removed when it stops syncing |
| `bm:<sync key>` | profile | `{ k, p (parent: its sync key, "bar" or "other"), t, u, a (added), pos }` | Bookmarks are Chrome's (BookmarkModel). A node's sync key is its Chrome UUID, or, for a bookmark synced before 0.2.20, its old id (`bm-…`, kept on Chrome's node as meta info `ac_sync_key`); every Mac makes an old key the node `bookmarkUuidFor` gives it, so Macs on either version name a bookmark alike (no renames, no duplicates; tested). Favicons stay local. A node whose folder was deleted elsewhere lands in Other Bookmarks; a cycle from two concurrent moves is broken the same way on every Mac (tested). Nothing is published or applied until the tree has been read from Chrome |
| `h:<url>` | profile | `{ t, n (visits), vt (last 50 visit times) }` for pages visited in the last 90 days | History is Chrome's (HistoryService). Applying a record adds the visits Chrome lacks; a local edit is a visit the record doesn't have, so Macs settle on the union of their visits (tested). Not deletions: older history (it stays on the Mac that has it and is dropped from snapshots), Chrome's 90-day expiry, URLs past the newest 5,000 the app reads, and pages Chrome doesn't keep (`ardia://`) |
| `tabs:<device id>` | profile | `{ n (device name), tabs: [{ u, t }] }`: that device's 30 most recent open tabs | only its device writes it. It feeds the overflow menu's "Your Devices" |
| `pt:n:t:<pin key>`, `pt:n:g:<pin key>`, `pt:n:l:<live folder id>` | profile | one record per node of the profile's pinned hierarchy, `{ parent, pos, kind, … }`: `parent` is `"fav"` (Favorites), `null` (the root) or `g:<pin key>` (a folder); `pos` is its fractional position among that parent's children; a tab adds `{ kind: "tab", url, title, customTitle, customIcon }`, a folder `{ kind: "folder", name, icon, color }`, a live folder `{ kind: "live", liveKind, name, icon, sources, filters, groupStacks, showCompleted, createdAt }` | **Placement.** Each record is the authoritative placement from the profile's `pinPlace` table, so tiles, rows, folders, nested and empty folders and live folders share one mixed order at each level. Applying a record writes its parent and position exactly; a node whose parent is missing or would form a cycle is shown at the root (a cycle is cut at the smallest key), the same way on every Mac, and its stored parent is never rewritten. The window lists Favorites, then the tree depth first, then Today. Pinned folders are the app's own; only Today uses Chrome's native tab groups. A node a Mac has no copy of publishes nothing and deletes nothing. A key that is already another profile's tab or group here gets a new local id, with the key kept as `pinKey`. A tab or folder the user pins, places or moves is a pending choice (`pinChoices`) that republishes with a fresh timestamp until that batch is on disk, so a later choice outranks an older edit still in transit. **Tabs.** A tile's or root row's `url` is its pinned home. A tab inside a folder is a leaf: an ordinary tab (`pinned` false, no `pinnedUrl`) whose record carries its canonical page. Navigating the leaf, or its page's title changing, updates that canonical page on its own Mac, which then syncs it; a received page goes only to copies with no page loaded or pending, and a pending wake that would restore another page is dropped. A loaded copy keeps its page. A tile or root row moved into a folder on this Mac starts from the page it shows. A leaf shown at the root because its folder is gone takes its canonical page as its home. Records arrive as unloaded tabs in the frontmost window showing the profile, or in its parked pins when no window shows it. **Joining.** The apply that joins a scope (a Mac entering its phrase, or one adopting the winning creator's seed, see Protocol v2) treats the synced tree as complete: every local node missing from it is removed, including keys this Mac published under a losing claim, and nothing local is merged in. **Removals.** A removed tab keeps any copy that has a page, is selected or is its window's last tab as a regular tab, and closes its other copies; a removed folder whose children are still synced leaves them shown at the root; a removed live folder is deleted here. **Live folders.** The record carries the definition only: applying one creates or updates the live folder, and its accounts, items, read state and collapsed state stay on each Mac. A live folder syncs once it has a place in the hierarchy: one created and not yet moved has none, so it stays on its Mac. A record whose `liveKind` differs from the local folder's, or whose id is another profile's live folder, is ignored. A tile's or root row's record also carries its home page's title: it changes on a Mac only when a copy showing the home gets a new title, or the home itself changes; a received title goes to copies with no page loaded while a loaded copy keeps its own, and the pair moves with the pin between tiles and rows, so two Macs showing different titles settle on one record. Older builds use the v1 chain's `pin:`/`pinrow:` records and never see these |
| `tilefold:<tab id>`, `tilefold:n:<folder id>` | profile | `{ f }`: a Favorites tile folder membership; `{ n }`: its name | Favorites tile folders remain separate from sidebar folders. Names retain their own timestamped records so an older member copy cannot overwrite a newer rename. Membership follows pinned Favorites; unpinning or converting to a row removes it. |
| `pw:<origin>\n<username>` | profile | `{ o, u, p }` | see below |
| `ext:<id>`, `ext:v:<id>` | profile | an extension: `{ on, inc, pin }`, or `{ removed: true }` once the user removes it; and the newest version approved anywhere with its permissions, `{ v, fps }` | Chrome Web Store extensions only; see below |

### Extensions

What Chrome Sync does for extensions, through our folder (`packages/sync/src/extensions.ts`, the app's host in
`apps/browser/src/sync/extensions.ts`, Chrome's side in `engine/chromium/…/ardia/ac_extensions_sync.cc`).
- **What syncs.** Extensions from the Chrome Web Store that Chrome itself would sync (`sync_util::ShouldSync`:
  installed by the user from the store, not by default, policy or a component, not blocklisted, no other update
  URL), and not themes or apps. Unpacked extensions, Ardia Scripts and uBlock Origin (bundled) stay on their Mac. Per
  extension: on or off (the user's choice, Chrome's `DISABLE_USER_ACTION`), allowed in private windows, pinned to
  the toolbar (Chrome's saved pin, not whether it shows now). Not synced: its data and settings (`storage.sync`
  included), site access.
- **Installing.** A record for an extension this Mac lacks hands Chrome a sync install
  (`PendingExtensionManager::AddFromSync`, as `ExtensionSyncService` does); its updater fetches it from the Web
  Store with no prompt. Chrome 155's updater would grant the permissions of whatever version it fetched, so the
  install goes in with no version and Chrome installs it disabled whenever it has permission warnings. It is turned
  on only when the fetched version is the one approved on another Mac and its permissions (Chrome's permission ids
  and their hosts, `fps`) are among those approved for it (`ext:v:`); otherwise it stays off for its new permissions
  and the user turns it on with Chrome's prompt. A Mac publishes `ext:v:` only for a version whose permissions are
  granted there: a newer version replaces the record, the same version read with other permissions (another Chrome
  version) adds its reading to `fps`. The record is last-writer-wins, so two Macs approving different versions at
  once can briefly regress it; the newer Mac republishes its version on its next cycle. A record that arrives while
  an install is pending changes it before it lands, and an install isn't published until it has taken the synced
  state (its pin, which Chrome may have set by default). One that never lands is retried once per session, then
  hourly.
- **Removing.** Only the user's own removal (Settings › Extensions, the extension's menu, the Web Store, Chrome's
  extension page) is recorded, from the event Chrome reports (never from an extension going missing), with a
  revision Chrome's side mints so a quick remove and reinstall isn't lost. The record becomes `{ removed: true }`, a
  live value rather than a tombstone, so compaction and older Macs keep it. Sync never uninstalls anything: the
  other Macs keep their copy, stop installing it, cancel a sync install of it that's still waiting, and don't
  publish their copy back. An install of it that was already downloading still lands there, and isn't counted as
  the user's. Installing it again anywhere writes a newer record, which wins.
- **Joining** is a union: a joining Mac takes the synced state for extensions both have, keeps its own (and
  publishes them, also one the record says was removed). A Mac that was already syncing before this version
  doesn't publish an extension it holds a record for until it has applied that record.
- **Older Macs** (0.2.38, the 0.2.39 nightlies) keep `ext:` records in their replica and snapshots without
  applying them. A build whose engine lacks `ac_extensions_sync_*` publishes and applies nothing for extensions.
- Settings › Sync › What Syncs › Extensions turns it off; a profile that shares another's data has its owner's
  extensions.

### Passwords

Saved passwords are Chrome's (its password manager).
- **Reading.** Chrome's own API (`passwordsPrivate`) reveals a password only after device
  authentication, so sync reads the profile's `Login Data` with the importer's reader
  (`ChromiumSecrets`, `packages/import`). Chrome's key is its "Ardia Safe Storage" item, or
  the mock keychain's where ArdiaCoreHost uses that (test instances, ad hoc builds). No Touch ID prompt is needed each cycle, and no
  Chromium change.
- **Writing.** Writes go through Chrome's API (`savePassword`, `deletePassword` in
  `@ardia/ardiacore`), so Chrome's in-memory store and autofill see them at once. A changed
  password is a delete plus an add: the update API needs the device check.
- **Safety.**
  - A read that finds any row it can't decrypt is skipped (a partial list would read as
    deletions).
  - After applying, sync waits until Chrome's store on disk shows the change before reading it
    again.
  - A login changed here but not read yet isn't overwritten.
  - Turning sync off, or turning Passwords off, never removes a password. Only a password
    deleted on another Mac is deleted here.
- **Cadence.** Passwords are read at most every 30 s (and at once with Sync Now).

## UX (from Dia's binary)

Settings › Sync. Dia puts sync in Account › Sync, with the section icon
`arrow.triangle.2.circlepath`.

- **Off.** The row reads "Sync · Off", with **Turn On Sync** and **Enter Recovery Phrase…**. If
  the folder already has sync data, the primary button is **Enter Recovery Phrase…**, next to
  **Other Options** (Dia's menu: "Set Up Without Another Device", "Enter Recovery Phrase").
  Below is the sync folder, with Choose…. If iCloud Drive is off it says so, links to iCloud
  settings, and offers another folder; test instances never default to iCloud Drive.
- **Turn On Sync** makes a phrase and shows **Save Your Recovery Kit**, with Dia's copy:
  - "Your Recovery Kit contains all you need to recover your data should you lose access to
    this device."
  - "Save a copy of your Recovery Kit to another device or to the cloud. You'll need it if you
    lose access to this device.", with "another" underlined.
  - A preview of the page.
  - Buttons: Save…, Close, and Other Options (Copy, Share…, Save as Text…).
  - The PDF is "Ardia Recovery Kit.pdf", US Letter as Dia's, with the 24 words and a QR code.
- **Connect with Recovery Phrase.**
  - Dia's copy: "Enter your 24-word recovery phrase to sync with another device.", the
    placeholder "Enter your 24-word recovery phrase", the "%d/%d words" counter, "too many
    words", and Connect / "Connecting…" / Cancel.
  - It also shows the folder the phrase is checked against, with Change….
- **On.**
  - The status line uses Dia's words: "starting up", "updating", "updated just now", "not
    syncing · last synced %@" and "offline" (the folder isn't there: a drive is unplugged, or
    iCloud Drive is off). Downloads still to come add "· waiting for N files to download".
  - **Connect Another Device…** shows the steps for the other Mac and a QR code of the phrase:
    scan it with an iPhone and paste it on the Mac with Universal Clipboard. It also has Show
    Words and Copy Words. Dia's version is an OTP between signed-in devices, which needs its
    server.
  - **Advanced…** has Save Recovery Kit…, Copy Recovery Code (Dia's ⌥ item, copied as
    `org.nspasteboard.ConcealedType`), Sync Now, Show Sync Folder in Finder and Stop Syncing….
  - Then Profiles (toggles, and Add to This Mac), What Syncs (Bookmarks, History, Open Tabs,
    Pinned Tabs and Groups, Passwords, Extensions, Settings) and Devices (each with "last synced …").
- **Stop Syncing This Device?** Dia's copy, plus "Everything on this Mac stays as it is", with
  Save Recovery Kit / Cancel / Stop Syncing.
  - Then **Delete Sync Data?**: "Would you also like to permanently delete your synced data
    from the sync folder? …", the checkbox "I understand this cannot be undone", and Keep Sync
    Data / Delete My Sync Data.
  - Stopping removes this Mac's tabs and name from the other devices and forgets the key. It
    keeps all local data.
  - Deleting removes this phrase's chain folder. The other Macs then show Dia's "This device is
    out of sync. Sync may have been reset from another device." and stop, keeping their data.
- **Overflow menu.** One other device with open tabs shows "Your %@ Tabs" (the kind of Mac, from
  its name: "Your MacBook Pro Tabs"). Several roll up into **Your Devices**
  (`macbook.and.iphone`), a submenu per device. Each lists "Recent Tabs"; picking one opens it
  in a new tab. The fallback name is "Unknown Device".

## Cycle

The engine (`apps/browser/src/sync/engine.ts`) runs a cycle 15 s after the last one, 3 s after a
bookmark, settings, profile or group edit, and on Sync Now. A cycle:
1. Checks the chain folder: gone means reset elsewhere; the folder missing means offline.
2. Syncs the app scope and links profiles.
3. Syncs each synced profile's scope, publishing, flushing, pulling, and then publishing and
   applying per adapter.
4. Compacts when due.
5. Saves `sync-v2.json` (in the app's data folder): links, settings of sync and the last seq written
   per scope; and `sync-v2-state.nns`, sealed: the replica, base, version vectors and known files.

## Protocol v2 and two Macs creating the chain at once

Sync since the pinned-hierarchy change uses chain label `chain/v2` and local files `sync-v2.json`, `sync-v2-state.nns`, `sync-v2-journal.nns`. Older builds can't find, read, write or delete this chain. An upgrading Mac imports its `sync.json` settings once (on/off, folder, device id, clock, data types, profile links) and never its old replica state or journal. On its first sync it joins the new chain if it exists, creates it if only the old chain exists, or resets if neither exists. A fresh Mac entering its phrase while only the old chain exists waits until an upgraded Mac creates the new one.

Nothing publishes until the browser store calls `markLocalDataReady()`. On an upgraded Mac, every data type in a scope waits for an initial read with nothing pending, damaged or unreadable, and for its own changes to apply. A Mac joining a scope neither applies nor publishes a type until it knows the scope's creator and that creator has durably marked its seed complete for that type (or declared that it doesn't sync it), with nothing still downloading or unreadable. A type the creator doesn't sync is adopted as absent.

Two Macs can each believe they created a scope before either has seen the other's files. Each creator stamps its seed with a claim: its clock reading when it took the scope. Every Mac treats the earliest claim it has ever seen as authoritative, whatever order the files arrive in. Seed records under a later claim are refused or purged everywhere, and the winner never applies them. The losing Mac stops seeding. Its own seed records are dropped from sync, but nothing is deleted from its local data on the strength of a claim alone. Each affected type waits, unapplied, until the winner's seed for that type is complete and nothing is still downloading or unreadable. Then the losing Mac applies the winner's complete view once, as a joining Mac, even when that view is empty; that apply also lists every key the losing Mac had published, so the type learns which of them the winner doesn't have, and only then does the losing Mac adopt the winner's view. A type the winner doesn't sync keeps the loser's local data, which then syncs as ordinary edits. A Mac that briefly followed the loser re-joins the winner the same way. Edits made after seeding, on either Mac, merge normally. Edits that existed only in the loser's seed are lost. The election runs separately for the app scope and each profile scope. A Mac whose clock runs behind can win a race it lost in real time.

The barrier is strict, so it can wait indefinitely: a file in a scope that stays pending, damaged or unreadable blocks adoption there, and a creator that never finishes seeding a type it declared holds joiners back for that type.

## Tests

- `pnpm --filter @ardia/sync test`:
  - `swift test`: 5 tests. BIP39 reference vectors; tampering and truncation are detected; the
    wrong phrase opens nothing; the folder holds no plaintext in names or contents; deleting one
    chain leaves another.
  - `node --test`: 28 tests. Extensions (19): install with state and approval, no echo; on/off,
    incognito and pin both ways; a removal as a live record, never reinstalled, beaten by a reinstall; an uninstall and
    reinstall before publishing; union on joining; a joiner takes the synced state; no grant for a newer store version
    or other permissions; a grant for a Mac that already has the approved version; a missing or null record and an
    ineligible extension never remove anything; nothing before Chrome is ready; a lost pending install retried; a
    change while pending; a removal cancels a pending install; an older Mac keeps the records through its snapshots;
    an upgraded Mac doesn't republish a copy whose removal it held; another Chrome's reading of the same version's
    permissions is added without a loop; an install still settling isn't published; on a framework without the engine
    calls nothing is published or applied and the records wait. The rest (9): Concurrent edits converge in any order; deletes, re-adds and
    edit-after-delete; clock skew; late, out-of-order and half-copied files; an edit during a read;
    an old snapshot put back after its tombstones were collected; a tombstone kept past its age
    limit while an older log is missing, for twice the limit at most; a write that fails before or
    after the file lands; 40 randomized three-device runs with flaky delivery, compaction and crashes.
- `pnpm --filter @ardia/browser test` runs `src/sync/adapters.test.mjs` (4 tests against the real
  store: delete versus add, concurrent moves that would make a cycle, parked pinned tabs, passwords
  both ways) and `src/sync/engine.test.mjs` (the engine against a fake native module: a crash the
  moment a batch lands re-sends the journalled batches byte for byte and numbers the next one after
  them; nothing is published before its journal is on disk).
- End to end: `node packages/sync/scripts/e2e.mjs [Debug app] [work dir]` drives two hidden
  instances (then a third) with their own data folders through a temporary sync folder, never
  iCloud Drive, over the dev harness. It checks 54 things, and all 54 passed on 2026-10-21 (Debug
  build), including pinned rows, tiles and a pinned group, an unpin, and B quit and relaunched.
  - Extensions, with real Chrome Web Store extensions over the network (Picture-in-Picture by Google, Google
    Translate): A installs one through Chrome's updater with no prompt; it comes in off for its permissions until
    A's user accepts Chrome's prompt; then it reaches B approved and on (same version, same permissions). A's
    disable turns it off on B; B's enable and pin reach A. B quit while an install was pending installs it after
    relaunching. B's removal makes the record `{ removed: true }` on both; B doesn't install it again, and A keeps its
    copy without publishing it back.
  - B rejects four wrong phrases: someone else's valid phrase ("mismatch"), two words swapped
    (checksum), a word not on the list, and 23 words. Then it joins with the kit's numbered, upper-case lines.
  - After joining: A's bookmarks, history, pinned tab (unloaded) and password (in Chrome's password
    manager) are on B, and B's own bookmark and password are on A. B took the synced settings.
    The two converge.
  - B's rename, delete and new bookmark, history delete and new visit, settings (a null one
    included), and password change and delete all reach A. A's move out of a folder, folder
    delete, new bookmark in Other Bookmarks, new pinned tab and new password reach B.
  - Open tabs: A shows B's tabs but not its pinned ones. "Your … Tabs" with "Recent Tabs" for one
    device, "Your Devices" for two.
  - Concurrent edits to one bookmark, one setting and one password converge, and the later edit
    wins. Idle rounds write no files.
  - A half-copied file and an iCloud placeholder aren't applied ("waiting for 1 file"). Both apply
    once whole.
  - The folder: no plaintext in names or contents (13 strings searched: titles, URLs, the password,
    usernames, device and setting names), every file padded to 1 KiB. Each Mac's own sync state
    holds no plaintext password.
  - A third Mac joins from the folder as it is (logs and a snapshot) and converges.
  - Turning sync off on B keeps its bookmarks, history, settings, pinned tabs and passwords, and
    removes its key. A drops B's device and tabs, and what B does while off stays on B.
  - Delete My Sync Data on A empties the folder. C shows Dia's reset message and stops, and A and C
    keep all their data.

  The runs found and fixed:
  - Settings whose value is null bounced between Macs: a null record is a tombstone, so settings
    are now wrapped.
  - Two instances launched in the same millisecond made the same store ids: `newId` now has a
    random part.

## Left for a person

A real two-Mac run over iCloud Drive: turn on sync on one Mac, save the kit, enter the phrase on
the other, and watch bookmarks, history, pinned tabs, passwords and settings go both ways. Also
check the iCloud Drive permission prompt, if macOS shows one the first time. The tests use a
temporary folder, never iCloud Drive.
