# iMessage Protocol & Open-Source Implementation Research

**Research Date:** February 27, 2025  
**Topics:** (A) iMessage Wire Format & Message Protocol, (B) Open-Source Implementation Survey

---

# TOPIC A: iMessage Wire Format and Message Protocol

## 1. Message Payload Structure (Before Encryption)

### Binary Plist & Serialization
- **Format:** iMessage uses **binary plist** encoding for message data
- **Storage:** Message body stored in `attributedBody` BLOB as `NSMutableAttributedString` in **typedstream** format (Apple's proprietary binary serialization, version 4, little endian, system 1000)
- **NSKeyedArchiver:** Used for some payload structures; BlastDoor (iOS 14+) parses untrusted iMessage data including NSKeyedArchiver payloads in a sandboxed Swift component
- **Routing:** APNs topic `com.apple.madrid`; pseudo-HTTP layer on top of APNs for IDS queries/responses

**References:**
- [jjtech.dev - iMessage, explained](https://jjtech.dev/reverse-engineering/imessage-explained/)
- [Project Zero - A Look at iMessage in iOS 14](https://projectzero.google/2021/01/a-look-at-imessage-in-ios-14.html)
- [Christopher Sardegna - Reverse Engineering Apple's typedstream Format](https://chrissardegna.com/blog/reverse-engineering-apples-typedstream-format/)
- [Apple Security - How iMessage sends and receives messages securely](https://support.apple.com/guide/security/how-imessage-sends-and-receives-messages-sec70e68c949/web)

---

## 2. Message Types Catalog

| Type | Meaning |
|------|---------|
| `0` | Normal message (text, attachment, reply) |
| `2`, `3` | Business extension (Apple Business Chat) |
| `1000` | Sticker reaction |
| `2000` | ❤️ Love (tapback add) |
| `2001` | 👍 Like |
| `2002` | 👎 Dislike |
| `2003` | 😂 Laugh |
| `2004` | ‼️ Emphasize |
| `2005` | ❓ Question |
| `2006` | Custom emoji (iOS 18+) |
| `3000`–`3006` | Tapback remove (corresponding to 2000–2006) |

**Other protocol-level types (not in DB):**
- Read receipt
- Typing indicator
- Delivered receipt
- Group add/remove
- Group name change
- Edit (iOS 16+)
- Retract/unsend (iOS 16+)

**References:**
- [docs/IMESSAGE_DB_SCHEMA.md](/workspace/docs/IMESSAGE_DB_SCHEMA.md) (this repo)
- [Apple Messages for Business REST API](https://register.apple.com/resources/messages/msp-rest-api/)

---

## 3. Legacy "Pair" Encryption Format

**Cryptanalysis of the iMessage Protocol** (plzh4x.me, Garman et al.):

- **Key generation:** 1280-bit RSA key pair + ECDSA P-256
- **Encryption flow:**
  1. 88-bit HMAC key (L) generated per message
  2. 40-bit integrity: `h ← HMAC(L, pk_s || pk_r || M)[1..40]`
  3. AES key: `K ← L || h` (128-bit)
  4. Message encrypted with **AES-CTR**
  5. AES key encrypted with **RSA-OAEP** (recipient's RSA public key)
  6. **ECDSA** (P-256, SHA-1) over encrypted message + encrypted key

**Security:** Vulnerable to chosen ciphertext attacks; Apple deployed mitigations in later iOS/OS X.

**References:**
- [Cryptanalysis of the iMessage Protocol](https://plzh4x.me/2018/04/07/cryptanalysis-of-the-imessage-protocol/)
- [ISI/JHU iMessage paper](https://isi.jhu.edu/~mgreen/imessage.pdf) (Garman, Green, Kaptchuk, Miers, Rushanan)
- [UMD iMessage paper](https://www.cs.umd.edu/~imiers/pdf/imessage.pdf)

---

## 4. pair-ec Encryption Format

- **Key establishment:** Ephemeral **ECDH** + **HKDF**
- **Encryption:** **AES-CTR** with non-standard 64-bit counter (documented in reverse-engineering; Apple does not publish specs)
- **Deployment:** Replaced RSA-based scheme; Apple moved to ECC in 2019

**References:**
- [Security analysis of the iMessage PQ3 protocol](https://eprint.iacr.org/2024/357)
- [Cryptanalysis of the iMessage Protocol](https://plzh4x.me/2018/04/07/cryptanalysis-of-the-imessage-protocol/)

---

## 5. EMDK & HMAC Key Tagging (Bellare–Stepanovs)

**Paper:** "Security under Message-Derived Keys: Signcryption in iMessage" (EUROCRYPT 2020)  
**URL:** https://iacr.org/cryptodb/data/paper.php?pubkey=30251 | https://eprint.iacr.org/2020/224.pdf

**EMDK (Encryption under Message-Derived Keys):**
- Symmetric encryption uses a key **derived from the message itself**
- **iMsg1 (iOS 9.0):** Random 128-bit K, encrypt under K
- **iMsg2 (iOS 9.3+):** After attacks, revised to HMAC-based derivation:
  - L = random 88-bit value
  - `h ← HMAC(L, pk_s || pk_r || M)[1..40]`
  - `K ← L || h`

**HMAC key tagging:** The HMAC key L is **not fully random** in the sense that the derived key K is tied to message content and public keys. Bellare–Stepanovs formalized this and proved security in the random-oracle model.

**References:**
- [IACR - Security under Message-Derived Keys](https://iacr.org/cryptodb/data/paper.php?pubkey=30251)
- [eprint.iacr.org/2020/224](https://eprint.iacr.org/2020/224.pdf)

---

## 6. Multi-Device Delivery & APNs

- **Per-device encryption:** Message encrypted **once per recipient device**
- **IDS:** Maps identifiers to public keys per device; sender queries IDS for recipient device keys
- **APNs:** Each device gets a unique push token; separate APNs payload per device
- **Topic:** `com.apple.madrid`
- **Flow:** Sender encrypts per device → bundles for APNs → APNs delivers to each device's push token

**References:**
- [jjtech.dev - iMessage, explained](https://jjtech.dev/reverse-engineering/imessage-explained/)
- [Apple Security - How iMessage sends and receives messages securely](https://support.apple.com/guide/security/how-imessage-sends-and-receives-messages-sec70e68c949/web)

---

## 7. PQ3 Post-Quantum Protocol (2024)

**Announcement:** February 21, 2024  
**Deployment:** iOS 17.4, iPadOS 17.4, macOS 14.4, watchOS 10.4 (March 2024)

**Design:**
- **Level 3 security** (first at-scale messaging protocol)
- **Kyber/ML-KEM** for post-quantum key encapsulation
- **Hybrid:** Classical ECC + post-quantum KEM; attacker must break both
- **Components:**
  1. Initial authenticated key exchange (ECDH + PQ KEM)
  2. Per-message key derivation (adapted Signal double ratchet + PQ KEM)
  3. Continuous rekeying for forward secrecy and post-compromise security

**Legacy compatibility:** PQ3 runs alongside classical crypto; gradual transition; older clients continue to work.

**Formal analysis:**
- [eprint.iacr.org/2024/357](https://eprint.iacr.org/2024/357) – Stebila security analysis
- [eprint.iacr.org/2024/1395](https://eprint.iacr.org/2024/1395) – Linker, Sasse, Basin TAMARIN proofs

**References:**
- [Apple - iMessage with PQ3](https://security.apple.com/blog/imessage-pq3/)
- [eprint.iacr.org/2024/357](https://eprint.iacr.org/2024/357)
- [eprint.iacr.org/2024/1395](https://eprint.iacr.org/2024/1395)

---

## 8. MMCS (Multimedia Message Content Server)

**Status:** No public documentation found for "MMCS" as a named protocol. Apple's attachment handling is largely undocumented.

**Known behavior:**
- Attachments stored in iCloud when Messages in iCloud is enabled
- `typedstream` format in `attributedBody` for inline content
- Madrid/APNs used for routing; attachment transfer likely uses separate endpoints
- Reverse-engineering sources (jjtech, NowSecure) describe daemon flow: Messages.app → imagent → identityservicesd → apsd

**References:**
- [jjtech.dev - iMessage, explained](https://jjtech.dev/reverse-engineering/imessage-explained/)
- [NowSecure - Reverse Engineering iMessage](https://www.nowsecure.com/blog/2021/01/27/reverse-engineering-imessage-leveraging-the-hardware-to-protect-the-software/)

---

## 9. Read Receipt, Typing Indicator, Reaction/Tapback

**Tapback (reactions):**
- Stored as `associated_message_type` 2000–3006 in `message` table
- `associated_message_guid`: `p:PART_INDEX/MESSAGE_GUID`
- `associated_message_emoji`: custom emoji for type 2006/3006 (iOS 18+)

**Read receipt / typing indicator:** Proprietary protocol; no public wire format. Apple Messages for Business REST API uses different semantics (JSON, capability-list headers).

**References:**
- [docs/IMESSAGE_DB_SCHEMA.md](/workspace/docs/IMESSAGE_DB_SCHEMA.md)
- [Apple - React with Tapbacks](https://support.apple.com/guide/messages/react-with-tapbacks-icht504f698a/mac)
- [Apple Messages for Business - Common Specs](https://register.apple.com/resources/messages/msp-rest-api/common-specs)

---

## 10. Group Chat Protocol

- **Encryption:** Per-participant; each device gets its own encrypted copy
- **IDS:** Maps group participants to device keys
- **Limits:** 32 participants for iMessage groups; SMS/MMS fallback if any non-Apple device
- **Add/remove:** Requires 3+ (add) or 4+ (remove) participants; all must use iMessage
- **Group metadata:** Display name, participants; stored in `chat` and `chat_handle_join`

**References:**
- [Apple Security - How iMessage sends and receives messages securely](https://support.apple.com/guide/security/how-imessage-sends-and-receives-messages-sec70e68c949/web)
- [Apple - iMessage Contact Key Verification](https://security.apple.com/blog/imessage-contact-key-verification/)

---

# TOPIC B: Open-Source Implementation Survey

## 1. pypush (JJTech0130/pypush)

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/JJTech0130/pypush |
| **Language** | Python |
| **License** | SSPL (Server Side Public License); owned by Beeper |
| **Stars** | ~3,710 |
| **Status** | Active; **undergoing major rewrite**; not stable until 3.0.0 |

**Protocol layers:** APNs (client), IDS, Albert (activation), GrandSlam, iMessage, CloudKit

**Platform:** Cross-platform (Mac-free); may need device identifiers for some APIs

**Key source files:**
- `pypush/apns/` – APNs client
- `pypush/ids/` – Identity Services
- `pypush/imessage/` – iMessage API
- `pypush/grandslam/` – GrandSlam
- `pypush/cloudkit/` – CloudKit

**Notes:** Rewrite focuses on APNs client; iMessage API being brought back. Requires emulator (e.g. Unicorn) for initial registration; config can be transferred afterward.

**References:**
- [README](https://github.com/JJTech0130/pypush)
- [jjtech.dev - iMessage explained](https://jjtech.dev/reverse-engineering/imessage-explained/)
- [Beeper - How Beeper Mini Works](https://blog.beeper.com/2023/12/05/how-beeper-mini-works/)

---

## 2. beeper/imessage

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/beeper/imessage |
| **Language** | Go |
| **License** | AGPL-3.0 |
| **Stars** | ~1,033 |
| **Status** | **Archived** (April 19, 2025) |

**Protocol layers:** Matrix bridge; no direct APNs/IDS/encryption—relies on registration provider + relay

**Platform:** Requires Mac or jailbroken iPhone for registration provider; bridge runs anywhere

**Key components:**
- Matrix-iMessage puppeting bridge
- Needs: [mac-registration-provider](https://github.com/beeper/mac-registration-provider) or [phone-registration-provider](https://github.com/beeper/phone-registration-provider), [registration-relay](https://github.com/beeper/registration-relay)

**References:**
- [README](https://github.com/beeper/imessage)
- [mautrix docs](https://docs.mau.fi/bridges/go/setup.html)

---

## 3. beeper/barcelona

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/beeper/barcelona |
| **Language** | Swift |
| **License** | Apache-2.0 |
| **Stars** | ~70 |
| **Status** | Active; Barcelona (mac-nosip) no longer maintained per mautrix |

**Protocol layers:** IMCore wrapper; uses IM frameworks, IMDPersistenceAgent, GRDB for SQLite

**Platform:** **macOS only** (Xcode 12.4+, Big Sur+)

**Key source files:**
- `Core/` – Core framework
- `Beeper/` – Beeper-specific code
- `vendor/` – Dependencies
- Builds: `barcelona-mautrix` (Matrix driver), `grapple` (debugging)

**Dependencies:** Swift Package Manager, GRDB, AnyCodable, IM frameworks

**Notes:** Requires `com.apple.security.xpc.plist` for IMDPersistenceAgent; uses undocumented IM APIs.

**References:**
- [README](https://github.com/beeper/barcelona)
- [BarcelonaIPC](https://github.com/open-imcore/BarcelonaIPC) (open-imcore)

---

## 4. beeper/mac-registration-provider

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/beeper/mac-registration-provider |
| **Language** | Go |
| **License** | AGPL-3.0 |
| **Stars** | ~151 |
| **Status** | Active |

**Protocol layers:** NAC (registration data) generation only

**Platform:** **macOS only**; version-specific (Intel: 10.14.6–14.3, Apple Silicon: 12.7.1–14.3)

**Modes:** Relay (default), Submit, Once

**References:**
- [README](https://github.com/beeper/mac-registration-provider)

---

## 5. mautrix/imessage

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/mautrix/imessage |
| **Language** | Go |
| **License** | AGPL-3.0 |
| **Stars** | ~420 |
| **Status** | Active (community fork of beeper/imessage) |

**Protocol layers:** Matrix bridge; supports Mac native, mac-nosip (Barcelona), BlueBubbles

**Platform:** Mac (native or Barcelona) or BlueBubbles server; Android SMS connector (deprecated)

**Features (see ROADMAP.md):**
- Text, media, replies, reactions, read receipts, typing (varies by connector)
- Edits/unsends: BlueBubbles only (macOS 13+)
- mac connector: no replies, reactions, read receipts, typing (AppleScript limits)

**References:**
- [README](https://github.com/mautrix/imessage)
- [ROADMAP](https://github.com/mautrix/imessage/blob/master/ROADMAP.md)
- [docs.mau.fi](https://docs.mau.fi/bridges/go/imessage/index.html)

---

## 6. open-imcore/valencia

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/open-imcore/valencia |
| **Language** | C++ (49.5%), Swift (46.7%), C, Objective-C |
| **License** | AGPL-3.0 |
| **Stars** | ~5 |
| **Status** | Low activity; last updated Jan 2023 |

**Protocol layers:** APNs, ESS (Apple services)

**Platform:** Likely macOS/iOS (Swift/C++)

**Structure:** Plugins, SPM, Targets, Tuist, docs

**References:**
- [GitHub](https://github.com/open-imcore/valencia)
- [OpenIMCore](https://github.com/open-imcore)

---

## 7. ReagentX/imessage-exporter

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/ReagentX/imessage-exporter |
| **Language** | Rust |
| **License** | GPL-3.0 |
| **Stars** | ~4,922 |
| **Status** | Active |

**Protocol layers:** **Read-only** – chat.db parsing, export, diagnostics; no send/receive/APNs/IDS

**Platform:** macOS, Linux, Windows

**Features:** Export to txt/html, diagnostics, `imessage_database` library, typedstream parsing, payload_data plist

**Key source files:**
- `imessage-exporter/` – CLI
- `imessage-database/` – Library

**References:**
- [README](https://github.com/ReagentX/imessage-exporter) (develop branch)
- [docs.rs/imessage-exporter](https://docs.rs/imessage-exporter)
- [crates.io](https://crates.io/crates/imessage-exporter)

---

## 8. BlueBubblesApp/bluebubbles-server

| Attribute | Value |
|-----------|-------|
| **URL** | https://github.com/BlueBubblesApp/bluebubbles-server |
| **Language** | TypeScript |
| **License** | Apache-2.0 |
| **Stars** | ~833 |
| **Status** | Active |

**Protocol layers:** AppleScript for send/create; chat.db polling for receive; **Private API** bundle (Objective-C) for advanced features

**Platform:** **macOS only** (Sierra+)

**Private API (BlueBubblesHelper):**
- Typing indicators, reactions, read receipts
- Create/delete messages and chats
- Message effects, replies, mentions
- Edit/unsend (macOS 13+)
- Group management (add/remove, rename, photo)
- Digital Touch, Handwritten previews (macOS 11+)

**Key paths:**
- `src/server/` – Server, types, API
- `src/server/api/imessage/` – chat.db access (TypeORM)
- `src/fileSystem/scripts.ts` – AppleScript
- BlueBubblesHelper – Private API bundle (separate repo)

**References:**
- [README](https://github.com/BlueBubblesApp/bluebubbles-server)
- [Private API docs](https://docs.bluebubbles.app/private-api)
- [BlueBubbles Helper](https://github.com/BlueBubblesApp/bluebubbles-helper)

---

# Cross-Reference Matrix: Repos × Protocol Layers

| Repo | Auth | Albert | APNs | IDS | Encryption | Send | Receive | SMS | Attachments | Groups |
|------|------|--------|------|-----|------------|------|---------|-----|-------------|--------|
| **pypush** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓* | ✓* | - | - | - |
| **beeper/imessage** | - | - | - | - | - | ✓ | ✓ | - | ✓ | ✓ |
| **beeper/barcelona** | - | - | - | - | - | ✓ | ✓ | - | ✓ | ✓ |
| **mac-registration-provider** | ✓ | ✓ | - | ✓ | - | - | - | - | - | - |
| **mautrix/imessage** | - | - | - | - | - | ✓ | ✓ | ✓† | ✓ | ✓ |
| **open-imcore/valencia** | - | - | ✓ | - | - | - | - | - | - | - |
| **imessage-exporter** | - | - | - | - | - | - | ✓‡ | - | ✓ | ✓ |
| **bluebubbles-server** | - | - | - | - | - | ✓ | ✓ | - | ✓ | ✓ |

**Legend:**
- ✓ = Implemented
- ✓* = In pypush rewrite; iMessage API being restored
- ✓† = Android SMS connector (deprecated; use mautrix-gmessages)
- ✓‡ = Read-only from chat.db
- `-` = Not applicable or not implemented

**Protocol layer definitions:**
- **Auth:** Apple ID / 2FA authentication
- **Albert:** Activation server / push certificate
- **APNs:** Apple Push Notification service client
- **IDS:** Identity Services (keyserver)
- **Encryption:** End-to-end encryption (pair/pair-ec/PQ3)
- **Send:** Sending iMessages
- **Receive:** Receiving iMessages
- **SMS:** SMS/MMS support
- **Attachments:** Attachment send/receive
- **Groups:** Group chat support

---

# Reference URL Summary

## Topic A – Protocol & Cryptography
- https://www.cs.umd.edu/~imiers/pdf/imessage.pdf
- https://isi.jhu.edu/~mgreen/imessage.pdf
- https://eprint.iacr.org/2020/224.pdf (EMDK)
- https://iacr.org/cryptodb/data/paper.php?pubkey=30251 (EMDK)
- https://eprint.iacr.org/2024/357 (PQ3 analysis)
- https://eprint.iacr.org/2024/1395 (PQ3 formal)
- https://security.apple.com/blog/imessage-pq3/
- https://support.apple.com/guide/security/how-imessage-sends-and-receives-messages-sec70e68c949/web
- https://jjtech.dev/reverse-engineering/imessage-explained/
- https://projectzero.google/2021/01/a-look-at-imessage-in-ios-14.html
- https://plzh4x.me/2018/04/07/cryptanalysis-of-the-imessage-protocol/
- https://chrissardegna.com/blog/reverse-engineering-apples-typedstream-format/
- https://www.nowsecure.com/blog/2021/01/27/reverse-engineering-imessage-leveraging-the-hardware-to-protect-the-software/

## Topic B – Repositories
- https://github.com/JJTech0130/pypush
- https://github.com/beeper/imessage
- https://github.com/beeper/barcelona
- https://github.com/beeper/mac-registration-provider
- https://github.com/mautrix/imessage
- https://github.com/open-imcore/valencia
- https://github.com/ReagentX/imessage-exporter
- https://github.com/BlueBubblesApp/bluebubbles-server
- https://github.com/BlueBubblesApp/bluebubbles-helper
- https://docs.bluebubbles.app/private-api
- https://docs.mau.fi/bridges/go/imessage/
