# Track 8: Apple macOS Private Frameworks for iMessage (IMCore, ChatKit)

**Research Date:** February 27, 2026  
**Topics:** IMCore.framework, ChatKit.framework, IMDPersistence, imagent daemon, XPC protocol, SIP/AMFI requirements, BlueBubbles, Barcelona, smserver, Frida instrumentation

---

## Executive Summary

Apple's iMessage on macOS relies on private frameworks (IMCore, ChatKit, IMDPersistence) and system daemons (imagent, IMDPersistenceAgent) that communicate via XPC. Accessing these APIs requires either:

1. **Injection into Messages.app** (BlueBubbles): dylib injection via `DYLD_INSERT_LIBRARIES` + SIP disabled
2. **Direct daemon communication** (Barcelona): XPC to imagent/IMDPersistenceAgent + AMFI/SIP disabled + custom XPC plist
3. **Jailbreak + IMDaemonController hook** (smserver): Hook `_capabilities`/`processCapabilities` to grant full permissions
4. **Database-only** (imsg-mcp, OpenClaw): Read `~/Library/Messages/chat.db`, send via AppleScript—no private APIs, SIP can stay enabled

---

## 1. IMCore.framework

### Location

```
/System/Library/PrivateFrameworks/IMCore.framework
```

On macOS and iOS. The framework bundle contains the **imagent** application:

```
/System/Library/PrivateFrameworks/IMCore.framework/imagent.app/Contents/MacOS/imagent
```

### Key Classes

| Class | Purpose |
|-------|---------|
| `IMChatRegistry` | Singleton; manages IMChat instances, `existingChatWithGUID:`, `chatForIMHandle:` |
| `IMChat` | Represents a conversation; `sendMessage:`, `markAllMessagesAsRead`, `sendMessageAcknowledgment:forChatItem:withAssociatedMessageInfo:` |
| `IMAccountController` | `sharedInstance`, `mostLoggedInAccount` |
| `IMHandle` | Represents a contact/address; `initWithAccount:ID:alreadyCanonical:` |
| `IMHandleRegistrar` | `getIMHandlesForID:` |
| `IMMessage` | Message object; `instantMessageWithText:flags:threadIdentifier:` |
| `IMMessageItem` | Internal message item; `_newChatItems`, `body`, `guid` |
| `IMChatHistoryController` | `loadMessageWithGUID:completionBlock:` |
| `IMDaemonController` | Connects to imagent; `sharedController`, `connectToDaemon`, `_capabilities` / `processCapabilities` |
| `IMPinnedConversationsController` | Pinned chats; `pinnedConversationIdentifierSet`, `setPinnedConversationIdentifiers:withUpdateReason:` |

### Daemon (imagent)

- **Path:** `/System/Library/PrivateFrameworks/IMCore.framework/imagent.app/Contents/MacOS/imagent`
- **Role:** Core engine for iMessage; manages data, server communication, and FaceTime/iMessage invitations
- **Behavior:** Runs as a system daemon; remains active even when Messages.app is closed
- **Architecture:** Part of a microservice chain: `Messages.app` → `imagent` → `identityservicesd` → `apsd` (Apple Push)

### XPC Services

IMCore and related frameworks expose XPC services. imagent registers mach services that clients connect to via `xpc_connection_create_mach_service()`. IMDPersistence.framework provides **IMDPersistenceAgent.xpc** for database-level access.

---

## 2. ChatKit.framework

### Location

```
/System/Library/PrivateFrameworks/ChatKit.framework
```

Available since iOS 3.0; present on macOS. Class prefix: **CK**.

### Key Classes

| Class | Purpose |
|-------|---------|
| `CKConversationList` | `sharedConversationList`; `conversationForExistingChatWithGroupID:`, `conversationForExistingChatWithPinningIdentifier:` |
| `CKConversation` | Conversation; `sendMessage:newComposition:`, `setLocalUserIsTyping:` |
| `CKComposition` | Message composition; `initWithText:subject:`, `compositionByAppendingMediaObject:` |
| `CKMessage` | `[conversation messageWithComposition:]` |
| `CKMediaObjectManager` | `sharedInstance`, `mediaObjectWithFileURL:filename:transcoderUserInfo:attributionInfo:hideAttachment:` |
| `CKSMSComposeController` | SMS compose UI (iOS) |
| `CKIMMessage` | Message object; `guid`, `address`, `subject`, `IMMessage`, `CKConversation` |

### Capabilities

ChatKit handles iMessage, SMS, and MMS messages and their UI. Access is controlled by **listener capabilities** enforced by imagent via `IMDaemonController._capabilities` (iOS 15 and earlier) or `processCapabilities` (iOS 16+).

---

## 3. IMDPersistence Framework

### Overview

**IMDPersistence** is a private subframework for message persistence and syncing.

- **Path:** `/System/Library/PrivateFrameworks/IMDPersistence.framework`
- **XPC Service:** `IMDPersistenceAgent.xpc` at  
  `/System/Library/PrivateFrameworks/IMDPersistence.framework/XPCServices/IMDPersistenceAgent.xpc/`

### Role

- Manages message-related data and syncing
- Used by iCloud message sync, Continuity, Handoff
- Provides more efficient message querying than imagent’s higher-level APIs
- Barcelona uses IMDPersistenceAgent for direct database-style access

### Database

The user-facing SQLite database is at `~/Library/Messages/chat.db`. IMDPersistenceAgent and other system components read/write this (and related DBs). See `docs/IMESSAGE_DB_SCHEMA.md` for schema details.

---

## 4. The imagent Daemon

### What It Does

- Listens for FaceTime and iMessage invitations
- Manages iMessage data and server communication
- Handles protocol-specific logic (unlike Messages.app, which is mostly UI)
- Maintains user login state
- Enforces **listener capabilities** per connecting process

### Communication Flow

```
Messages.app  →  imagent  →  identityservicesd  →  apsd (Apple Push)
```

When a user sends an iMessage, the flow goes through this chain. imagent is the central routing and protocol layer.

### Listener Capabilities

imagent grants capabilities per process. Known capability bits include:

| Capability | Description |
|------------|-------------|
| **Status** | User/device status |
| **Notifications** | Push/notification access |
| **Chats** | Chat list and conversation access |
| **Transfers** | File transfer operations |
| **Accounts** | Account/identity access |
| **IDQueries** | Identity/address resolution |
| **SendMessages** | Send messages (bit 12) |
| **MessageHistory** | Access message history (bit 13) |
| **ChatObserver** | Observe chat changes |
| **ChatCounts** | Chat count queries |
| **Modify Read State** | Mark read/unread |

### Default Process Permissions

- **com.apple.springboard:** Status, Notifications, Accounts, Modify Read State, Chat Counts
- **com.apple.MobileSMS:** Status, Notifications, Chats, Transfers, Accounts, ID Queries

SendMessages and MessageHistory are **not** granted by default; they require elevated capabilities (e.g., via IMDaemonController hook or privileged process).

### Capability Override (Jailbreak / Research)

smserver documents hooking `IMDaemonController` to return full capabilities:

```objectivec
// iOS 15 and earlier
- (unsigned)_capabilities {
    return 17159;
}

// iOS 16+
- (unsigned long long)processCapabilities {
    return 4485895;
}
```

This allows arbitrary processes to use IMCore/ChatKit as if they were MobileSMS/SpringBoard.

---

## 5. XPC Protocol Surface

### Basics

XPC is Apple’s IPC mechanism. Typical flow:

1. `xpc_connection_create_mach_service("service-name", ...)`
2. `xpc_connection_set_event_handler(...)`
3. `xpc_connection_resume(...)`
4. Send/receive via `xpc_dictionary` structures

### imagent XPC

- imagent registers mach services used by Messages.app and other system clients
- The exact message dictionary keys and formats are undocumented
- Reverse engineering is required to discover the protocol

### IMDPersistenceAgent XPC

- Barcelona connects to IMDPersistenceAgent for efficient message queries
- Requires `com.apple.security.xpc.plist` at `/Library/Preferences/com.apple.security.xpc.plist` to allow non-Apple clients
- Barcelona provides a sample plist; it relaxes XPC service restrictions

### Tools for XPC Analysis

- **xpcspy** (hot3eed/xpcspy): Frida-based bidirectional XPC interception
- **gxpc** (ReverseApple/gxpc): XPC sniffing with Frida + Go
- **Frida**: Can hook `xpc_connection_create_mach_service`, `xpc_session_send_message`, etc. (see 8ksec.io Advanced Frida Part 3)

---

## 6. Required Entitlements

### ChatKit/IMCore

- No public entitlements exist for third-party apps
- Only Apple-signed processes (Messages.app, imagent, etc.) have the necessary entitlements
- Third-party access requires:
  - Injection into an entitled process (Messages.app), or
  - Bypassing capability checks (jailbreak hook), or
  - Relaxing XPC security (Barcelona’s plist + AMFI/SIP disabled)

### Practical Implications

- App Store apps cannot use these frameworks
- Use breaks with macOS updates
- Apple can change or remove APIs at any time

---

## 7. SIP Requirements

### When SIP Must Be Disabled

| Approach | SIP | Notes |
|----------|-----|-------|
| **BlueBubbles (dylib injection)** | Disabled | `DYLD_INSERT_LIBRARIES` requires SIP off |
| **Barcelona (direct XPC)** | Disabled | AMFI + SIP disabled for daemon communication |
| **smserver (jailbreak)** | N/A (iOS) | Jailbreak environment |
| **chat.db + AppleScript** | Enabled | No injection; read DB, send via AppleScript |

### What Can Work With SIP Enabled

- Reading `~/Library/Messages/chat.db` (with Full Disk Access)
- Sending via AppleScript to Messages.app (with Automation permission)
- No private framework or daemon access

### Library Validation

- Hardened Runtime enables Library Validation by default when SIP is on
- Disabling SIP also disables Hardened Runtime, which removes Library Validation
- To allow framework injection with SIP disabled, some setups use:
  ```bash
  sudo defaults write /Library/Preferences/com.apple.security.libraryvalidation.plist DisableLibraryValidation -bool true
  ```
- Reboot required after changes

---

## 8. BlueBubbles Private API Approach

### Architecture

- **Server:** Node.js backend; reads `chat.db` via TypeORM, sends via AppleScript for basic mode
- **Private API:** Helper bundle (Objective-C dylib) injected into Messages.app for full IMCore/ChatKit access

### Injection Method (v1.8.0+)

- **No MacForge:** Server manages injection directly
- **Mechanism:** Start Messages.app with `DYLD_INSERT_LIBRARIES` pointing at the helper dylib
- **Lifecycle:** Server injects, monitors Messages.app, restarts on crash
- **Requirement:** SIP disabled

### Key Techniques

1. **ZKSwizzle:** Method swizzling to hook `IMMessageItem` (e.g., `isCancelTypingMessage`, `isIncomingTypingMessage`) for typing indicators
2. **IMChatRegistry:** `existingChatWithGUID:` for chat lookup
3. **IMMessage construction:** `initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:balloonBundleID:payloadData:expressiveSendStyleID:` for sending
4. **Thread identifiers:** `IMCreateThreadIdentifierForMessagePartChatItem` for replies (Big Sur+)
5. **Tapbacks:** `sendMessageAcknowledgment:forChatItem:withAssociatedMessageInfo:` with reaction IDs (2000–3006)

### Supported Features

- Send/receive messages, replies, mentions, subjects, effects
- Typing indicators
- Tapbacks (reactions)
- Edit/unsend (macOS 13+)
- Group chat management (rename, add/remove participants)
- Mark read/unread
- Pinned chats (Big Sur; may crash on Monterey+)
- Delete chats

### Compatibility

- macOS 10.13–13 (High Sierra through Ventura)
- Intel and Apple Silicon

---

## 9. Barcelona Approach (Beeper)

### Overview

Barcelona is a Swift framework for iMessage, developed by Beeper. It talks directly to imagent and IMDPersistenceAgent via XPC.

### Key Characteristics

- **Language:** Swift
- **Dependencies:** GRDB (SQLite), AnyCodable
- **Frameworks used:** “IM family of frameworks”
- **Build:** Xcode 12.4+, macOS Big Sur+, xcodegen

### Requirements (from RUNNING.md)

1. **AMFI disabled:** `nvram boot-args='amfi_get_out_of_my_way=1'`
2. **SIP disabled:** `csrutil disable` (Intel) or permissive security policy (Apple Silicon)
3. **XPC plist:** `com.apple.security.xpc.plist` at `/Library/Preferences/com.apple.security.xpc.plist` to allow non-Apple clients to connect to IMDPersistenceAgent

### Architecture

- Connects to **IMDPersistenceAgent** for message querying (more efficient than imagent)
- Connects to **imagent** for send/receive and other operations
- No injection into Messages.app

### Products

- **barcelona-mautrix:** Matrix bridge driver (matrix-imessage)
- **grapple:** Debugging/inspection tool
- **grudge:** YAML-based test suite

### Quote from README

> "Barcelona requires you to disable AMFI, SIP, and weaken security around what processes can communicate with system services. This is inherently unsafe... Barcelona is designed from the start to run on weakened systems, and there are no plans to attempt to support factory-default macOS."

---

## 10. smserver (Jailbreak)

### Platform

- **Target:** Jailbroken iPhone (iOS)
- **IPC:** libmryipc for IPC; originally targeted MobileSMS.app, later switched to direct imagent connection

### Key Insight

- MobileSMS.app is suspended in the background on iOS 14+, so IPC to it fails when the app is not foregrounded
- **Solution:** Connect directly to imagent and hook `IMDaemonController._capabilities` (or `processCapabilities` on iOS 16+) to return full capabilities

### Techniques

1. **IMDaemonController** hook for capabilities
2. **CKConversationList** + **CKConversation** for sending (ChatKit path)
3. **IMChatRegistry** + **IMHandle** + **IMMessage** for sending (IMCore-only path)
4. **IMMessageItem** hooks for typing indicators
5. **NSNotificationCenter** for `__kIMChatMessageReceivedNotification` to receive messages
6. Tapbacks via `sendMessageAcknowledgment:forChatItem:withAssociatedMessageInfo:`

### Documentation

- `docs/IMCore_and_ChatKit.md` in the smserver repo has detailed Logos code examples

---

## 11. Headless macOS and imagent

### Can Headless macOS Run imagent?

- **imagent** is a system daemon and runs regardless of GUI
- **Messages.app** is typically needed for initial iMessage sign-in and some UI-driven flows
- **Practical limitation:** iMessage usually requires a signed-in Apple ID, which is done through Messages.app

### Headless Use Cases

- **OpenClaw / imsg-mcp:** Poll `chat.db`, send via AppleScript; Mac must be on and awake
- **Barcelona:** Can run headless once AMFI/SIP are disabled and XPC is configured
- **BlueBubbles:** Server has “Headless Mode” (v1.8.0+); closes UI, keeps backend running

### Constraints

- Mac must stay powered on and awake for 24/7 operation
- No official “headless iMessage server” from Apple
- Cloud/VM setups often use a macOS VM with a display (real or virtual)

---

## 12. Frida Instrumentation

### Feasibility

- **Frida** can attach to processes and hook functions
- **macOS:** Needs `task_for_pid` access; SIP typically must be disabled for system daemons
- **Reports:** Some users cannot attach to imagent/apsd even with SIP disabled (Frida issue #1829)

### Use Cases

1. **XPC interception:** Hook `xpc_connection_create_mach_service`, `xpc_session_send_message`, etc.
2. **xpcspy:** Bidirectional XPC message capture
3. **IMDaemonController:** Hook `_capabilities`/`processCapabilities` to observe or alter behavior
4. **Protocol reverse engineering:** Inspect message dictionaries and response formats

### Tools

- **xpcspy** (hot3eed/xpcspy): Frida-based XPC spy
- **8ksec.io Advanced Frida Part 3:** Inspecting XPC calls on iOS
- **Hopper:** Static analysis (Barcelona credits it for reverse engineering)

---

## 13. Runtime Headers and References

### Header Repositories

- **nst/iOS-Runtime-Headers:** Objective-C headers from runtime introspection; includes ChatKit (CKSMSComposeController, etc.)
- **ichitaso/iOS-iphoneheaders:** IMDaemon.h, IMDPersistenceAgent symbols
- **udevsharold/iOS-14.3-Headers:** IMDNotificationsController and related

### Documentation

- **theapplewiki.com:** Dev:ChatKit.framework
- **iPhoneDevWiki:** ChatKit.framework (historical)
- **BlueBubbles:** docs.bluebubbles.app/private-api, imcore-documentation.md

---

## 14. Comparison Matrix

| Aspect | BlueBubbles | Barcelona | smserver | chat.db + AppleScript |
|--------|-------------|-----------|----------|------------------------|
| **Platform** | macOS | macOS | iOS (jailbreak) | macOS |
| **SIP** | Disabled | Disabled | N/A | Can stay enabled |
| **Injection** | dylib into Messages.app | None | Tweak into SpringBoard/MobileSMS | None |
| **Primary API** | IMCore/ChatKit in-process | XPC to imagent/IMDPersistenceAgent | IMCore/ChatKit via imagent | chat.db + AppleScript |
| **Send** | IMChat.sendMessage | XPC | CKConversation/IMChat | AppleScript |
| **Receive** | DB + notifications | XPC/DB | NSNotification | DB poll |
| **Typing** | Yes (swizzle) | Unknown | Yes (hook) | No |
| **Tapbacks** | Yes | Yes | Yes | No |
| **Headless** | Yes (server mode) | Yes | N/A | Yes |

---

## 15. References

### Repositories

- [BlueBubblesApp/bluebubbles-server](https://github.com/BlueBubblesApp/bluebubbles-server) – Node.js server, chat.db access, AppleScript
- [BlueBubblesApp/bluebubbles-helper](https://github.com/BlueBubblesApp/bluebubbles-helper) – Private API bundle (Messages + FaceTime)
- [BlueBubblesApp/bluebubbles-docs](https://github.com/BlueBubblesApp/bluebubbles-docs) – Docs, imcore-documentation.md
- [beeper/barcelona](https://github.com/beeper/barcelona) – Swift IMCore framework
- [itsjunetime/smserver](https://github.com/itsjunetime/smserver) – Jailbreak SMS server, IMCore_and_ChatKit.md
- [hot3eed/xpcspy](https://github.com/hot3eed/xpcspy) – Frida XPC interception
- [nst/iOS-Runtime-Headers](https://github.com/nst/iOS-Runtime-Headers) – ChatKit headers

### Documentation

- [docs.bluebubbles.app/private-api](https://docs.bluebubbles.app/private-api)
- [theapplewiki.com/wiki/Dev:ChatKit.framework](https://theapplewiki.com/wiki/Dev:ChatKit.framework)
- [NowSecure – Reverse Engineering iMessage](https://www.nowsecure.com/blog/2021/01/27/reverse-engineering-imessage-leveraging-the-hardware-to-protect-the-software/)
- [Apple – Disabling and Enabling SIP](https://developer.apple.com/documentation/security/disabling-and-enabling-system-integrity-protection)
- [macEnhance – SIP and Library Validation](https://www.macenhance.com/docs/general/sip-library-validation.html)

---

*Document generated from research on Apple private frameworks, BlueBubbles, Barcelona, smserver, and related projects.*
