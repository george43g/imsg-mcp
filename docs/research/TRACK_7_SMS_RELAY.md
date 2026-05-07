# Apple SMS Relay Mechanism Research

**Research Date:** February 27, 2026  
**Topic:** Text Message Forwarding, `com.apple.private.alloy.sms` sub-service, and related implementations

---

## 1. Executive Summary

Apple's **Text Message Forwarding** (also called **SMS Relay**) allows SMS, MMS, and RCS messages received on an iPhone to appear on a Mac, iPad, or Apple Vision Pro. At the protocol level, this is implemented via the **`com.apple.private.alloy.sms`** sub-service under Identity Services (IDS). The iPhone acts as a relay: it receives SMS/MMS over the cellular network, then forwards them to paired devices via Apple Push Notification service (APNs). Non-Apple devices cannot natively use SMS relay; third-party projects (pypush sms-registration, Beeper phone-registration-provider) attempt to replicate phone-number registration for iMessage/SMS on non-Apple hardware.

---

## 2. How SMS Relay Works at the Protocol Level

### 2.1 Architecture

- **iPhone** is the authoritative device for SMS/MMS. It has the SIM and receives messages over the cellular network.
- **Mac / iPad / Apple Vision Pro** are secondary devices. They receive forwarded messages via **APNs**, not directly from the cellular network.
- **Flow:** Carrier → iPhone (SMS) → Apple infrastructure (APNs) → Mac/iPad/etc.

### 2.2 APNs and Sub-Service

- iMessage uses APNs topic **`com.apple.madrid`**.
- SMS relay uses the **sub-service** **`com.apple.private.alloy.sms`**.
- Messages are delivered over the same APNs binary protocol, with a different topic/sub-service identifier.
- The iPhone forwards incoming SMS/MMS to Apple's servers, which then push them to the Mac's (and other devices') APNs tokens.

### 2.3 Connection Requirements

- **iPhone must be online:** Turned on and connected to Wi-Fi or cellular.
- **Same Apple Account:** All devices must be signed in with the same Apple ID.
- **Initial setup:** Devices typically on the same Wi-Fi during setup; afterward, relay can work over cellular (e.g., iPhone on cellular, Mac on Wi-Fi).
- SMS relay does **not** require Bluetooth or same Wi-Fi network for ongoing operation; the iPhone's data connection is sufficient.

**Sources:**
- [Forward text messages from your iPhone to other devices - Apple Support](https://support.apple.com/en-us/102545)
- [Set up iPhone to get SMS, MMS, and RCS messages on Mac - Apple Support](https://support.apple.com/guide/messages/get-sms-mms-and-rcs-texts-from-iphone-icht8a28bb9a/mac)
- [SMS relay works without wifi and bluetooth - Apple Discussions](https://discussions.apple.com/thread/6649446)
- [SMS Relay – Hardware requirements? - Apple Stack Exchange](https://apple.stackexchange.com/questions/155280/sms-relay-hardware-requirements)

---

## 3. IDS Registration for SMS vs iMessage-Only

### 3.1 Sub-Services for SMS Capability

To support SMS (and related features), IDS registration must include additional **sub-services** beyond `com.apple.madrid`:

| Sub-Service | Purpose |
|-------------|---------|
| `com.apple.private.alloy.sms` | SMS relay / Text Message Forwarding |
| `com.apple.private.alloy.biz` | Business messaging |
| `com.apple.private.alloy.gamecenter.imessage` | Game Center iMessage integration |

From pypush sms-registration (`ids/identity.py`):

```python
"sub-services": ["com.apple.private.alloy.sms",
                 "com.apple.private.alloy.biz",
                 "com.apple.private.alloy.gamecenter.imessage"],
```

### 3.2 Phone Number Authentication

- **Apple ID auth:** Uses `id-authenticate-ds-id` with `auth-token`.
- **Phone number auth:** Uses `id-authenticate-phone-number` with:
  - `push-token`: APNs push token (hex)
  - `sigs`: List of phone signatures (bytes)

Phone signatures are obtained by sending an SMS to Apple's carrier-specific **gateway number** and capturing the response. The gateway number is defined in carrier bundles as `PhoneNumberRegistrationGatewayAddress`.

**Sources:**
- [pypush sms-registration - ids/identity.py](https://github.com/JJTech0130/pypush/blob/sms-registration/ids/identity.py)
- [pypush sms-registration - ids/profile.py](https://github.com/JJTech0130/pypush/blob/sms-registration/ids/profile.py)
- [Carrier Bundle - The Apple Wiki](https://theapplewiki.com/wiki/Carrier_Bundle)
- [Carrier.plist - The iPhone Wiki](https://www.theiphonewiki.com/wiki/Carrier.plist)

---

## 4. The SIM Tag in IDS Registration

When registering a **phone number** (as opposed to an email) with IDS, the user payload includes a **`tag`** field set to **`"SIM"`**.

From pypush (`ids/__init__.py`):

```python
user_payloads.append({
    "client-data": ...,
    "tag": "SIM" if user.user_id.startswith("P:") else None,
    "uris": [{"uri": handle} for handle in user.handles],
    "user-id": user.user_id,
})
```

- **`P:` prefix:** Phone number user IDs are prefixed with `P:` (e.g., `P:+14155551234`).
- **`tag: "SIM"`:** Indicates the handle is a phone number associated with a SIM card.
- Email handles do not use the SIM tag.

**Source:**
- [pypush sms-registration - ids/__init__.py](https://github.com/JJTech0130/pypush/blob/sms-registration/ids/__init__.py)

---

## 5. SMS Message Structure at the Wire Level

### 5.1 APNs Message Types for SMS

From pypush `imessage.py`, SMS-related message types use topic `com.apple.private.alloy.sms`:

| Type | Topic | Message Class | Direction |
|------|-------|---------------|-----------|
| 140 | com.apple.private.alloy.sms | SMSIncomingMessage | Incoming SMS (text) |
| 141 | com.apple.private.alloy.sms | SMSIncomingImage | Incoming MMS (image) |
| 143 | com.apple.private.alloy.sms | SMSReflectedMessage | Outgoing SMS (reflected to sender's devices) |
| 144 | com.apple.private.alloy.sms | SMSReflectedMessage | Outgoing SMS (reflected) |
| 145 | com.apple.private.alloy.sms | (activation) | SMS forwarding activation |
| 147 | com.apple.private.alloy.sms | (response) | Response to activation |

### 5.2 SMSIncomingMessage (Type 140)

Incoming SMS from iPhone relay. Payload (binary plist, optionally gzip-compressed):

- `k[0].data`: Message body (bytes, decoded as text)
- `h`: Sender handle (phone number)
- `co`: Conversation/recipient
- `g`: Message GUID (UUID string)

### 5.3 SMSReflectedMessage (Types 143, 144)

Outgoing SMS reflected back to sender's devices. Payload:

- `mD.plain-body`: Message text
- `mD.handle`: Handle
- `mD.guid`: Message GUID
- `mD.service`: `"SMS"`
- `mD.sV`: Version string (e.g., `"1"`)
- `re`: Recipients list
- `chat-style`: `"im"` (1:1) or `"chat"` (group)

### 5.4 Comparison to iMessage

- **iMessage:** Uses keys like `t` (text), `p` (participants), `r` (GUID), `x` (XML/attributed body).
- **SMS:** Uses `plain-body`, `handle`, `service: "SMS"`, and different participant structures.
- Both use binary plist and optional gzip compression.
- Both are delivered over APNs with the same binary framing; the topic/sub-service distinguishes SMS from iMessage.

**Sources:**
- [pypush sms-registration - imessage.py](https://github.com/JJTech0130/pypush/blob/sms-registration/imessage.py)
- [docs/IMESSAGE_DB_SCHEMA.md](../IMESSAGE_DB_SCHEMA.md) (this repo)
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)

---

## 6. Paired iPhone Must Be Online

**Yes.** For SMS relay to work, the paired iPhone must be:

- Turned on
- Connected to Wi-Fi or cellular network

If the iPhone is off or offline, SMS messages will not be forwarded to the Mac, iPad, or other devices. The iPhone is the relay; without it, there is no path from the cellular network to the secondary devices.

**Source:**
- [Forward text messages from your iPhone to other devices - Apple Support](https://support.apple.com/en-us/102545)

---

## 7. phone-registration-provider (Beeper)

### 7.1 Purpose

**phone-registration-provider** (also called **beepserv**) is a **tweak for jailbroken iPhones** that generates iMessage registration data (including validation data) and provides it to Beeper's relay service. This allows Beeper Mini (Android) users to register their phone number with Apple as if it were an iPhone.

### 7.2 How It Works

1. **Jailbroken iPhone** runs the tweak, which hooks into **identityservicesd**.
2. **Hooks:**
   - `IDSRegistrationMessage.setValidationData:` — Intercepts validation data when IDS generates it during registration.
   - `IDSRegistrationCenter._sendAuthenticateRegistration:` — Triggers the native registration flow to obtain validation data.
   - `CKSettingsMessagesController` — Modifies Settings → Messages UI to show registration code and connection status.
3. **Validation data:** The tweak captures the binary validation blob from `IDSRegistrationMessage` and stores it (with a 10-minute expiry). When Beeper's relay requests it via WebSocket (`get-validation-data`), the tweak sends the base64-encoded validation data.
4. **WebSocket:** Connects to `https://registration-relay.beeper.com/api/v1/provider` (or custom URL in `/.beepserv_wsurl`).
5. **Registration flow:** The iPhone runs the real IDS registration; the tweak does not generate signatures or validation data itself—it extracts them from the native process.

### 7.3 Signature Generation

The tweak does **not** generate registration signatures. It relies on the **native identityservicesd** to perform registration. The iPhone's IDS stack produces validation data, auth certs, and push tokens. The tweak's role is to:

- Trigger `_checkRegistration` on `IDSDAccount` to force registration.
- Intercept `validationData` from `IDSRegistrationMessage`.
- Send that data to Beeper's relay so non-Apple clients can use it.

### 7.4 Requirements

- Jailbroken iPhone (iOS 10+)
- Hooking library (ellekit, libhooker, mobilesubstitute, mobilesubstrate)
- Beeper Mini on Android
- iPhone connected to Wi-Fi, plugged in (recommended)

**Sources:**
- [beeper/phone-registration-provider - GitHub](https://github.com/beeper/phone-registration-provider)
- [beeper/phone-registration-provider README](https://github.com/beeper/phone-registration-provider/blob/main/README.md)
- [beeper/phone-registration-provider Tweak.x](https://github.com/beeper/phone-registration-provider/blob/main/Tweak.x)
- [iMessage and Phone Registration Are Back – Kinda – Beeper Blog](https://blog.beeper.com/2023/12/21/imessage-and-phone-registration-are-back-kinda/)

---

## 8. pypush sms-registration Branch

### 8.1 Purpose

The **sms-registration** branch of pypush enables **phone number registration** for iMessage on non-Apple devices (e.g., Android, Linux, Windows) by obtaining a phone signature from Apple's carrier gateway and using it to authenticate with IDS.

### 8.2 Key Components

| Component | Role |
|-----------|------|
| **PNRGateway** (Android app) | Sends SMS to Apple's gateway number, captures response, exposes HTTP API for pypush |
| **sms_registration.py** | Orchestrates registration: gets push token, sends REG-REQ via gateway, parses REG-RESP for phone number + signature |
| **gateway_fetch.py** | Resolves carrier MCC+MNC to Apple gateway number via iTunes carrier bundle (`PhoneNumberRegistrationGatewayAddress`) |
| **ids/profile.py** | `get_phone_cert()` — authenticates with `id-authenticate-phone-number` using push token + signatures |
| **ids/identity.py** | Registers with sub-services including `com.apple.private.alloy.sms` |

### 8.3 Registration Flow

1. PNRGateway app on Android gets MCC+MNC from device.
2. pypush fetches gateway number from `gateway_fetch.getGatewayMCCMNC()` (iTunes carrier bundle).
3. pypush builds `REG-REQ?v=3;t={push_token};r={req_id};` and sends it via PNRGateway to the gateway number.
4. Apple's gateway responds with SMS containing `REG-RESP?v=3;r={req_id};n={phone_number};s={signature_hex};`.
5. pypush parses `n` (phone number) and `s` (signature).
6. pypush calls `get_phone_cert(phone_number, push_token, [signature])` to get auth cert.
7. pypush registers with IDS including `com.apple.private.alloy.sms` sub-service and `tag: "SIM"` for the phone handle.

### 8.4 Changes vs Main Branch

The **main** branch of pypush has been rewritten with a different package layout (`pypush/` package, no flat scripts). The **sms-registration** branch retains the older structure and adds:

- `sms_registration.py` — Phone number registration via PNRGateway
- `gateway_fetch.py` — Carrier gateway resolution
- `IDSPhoneUser` — Phone-number-authenticated user type
- `SMSIncomingMessage`, `SMSReflectedMessage`, `SMSIncomingImage` — SMS message types
- `MESSAGE_TYPES` entries for types 140, 141, 143, 144 with `com.apple.private.alloy.sms`
- `activate_sms()` — SMS forwarding activation (command 145/147)
- Sub-services and SIM tag in IDS registration

### 8.5 Limitations

- Requires Android device with PNRGateway (or similar) to send/capture gateway SMS.
- Carrier-dependent: gateway numbers vary by carrier; some carriers may not work.
- Registration expires; must re-register periodically (e.g., every 10 min–48 hrs).
- Bugs and instability; project is in development.

**Sources:**
- [pypush sms-registration - GitHub](https://github.com/JJTech0130/pypush/tree/sms-registration)
- [pypush sms-registration README](https://github.com/JJTech0130/pypush/blob/sms-registration/README.md)
- [PNRGatewayClientV2 - GitHub](https://github.com/JJTech0130/PNRGatewayClientV2)
- [danipoak/pypush sms-registration fork](https://github.com/danipoak/pypush/tree/sms-registration)

---

## 9. Known Limitations

### 9.1 MMS Support

- **SMS relay** supports MMS (images, etc.) when using native Apple devices.
- pypush defines `SMSIncomingImage` (type 141) for MMS, but implementation is incomplete (`TODO: Implement this`).
- Carrier and gateway limitations may affect MMS reliability.

### 9.2 Character Limits

- **SMS:** 160 characters (GSM-7) or 70 (UCS-2); longer messages split into segments.
- **MMS:** Up to ~1,600 characters; media size limits vary by carrier (e.g., 600 KB–2 MB for images).

### 9.3 Delivery Receipts

- pypush checks for delivery status (command 255) after sending.
- Native Apple devices support read/delivered receipts; third-party implementations may have gaps.

### 9.4 Reregistration

- Phone number registration expires. pypush users must run reregistration scripts (e.g., every 25–30 min via cron or daemon).
- Expiration can range from ~10 minutes to 48 hours; longer uptime may extend it.

**Sources:**
- [SMS and MMS limits - AWS](https://docs.aws.amazon.com/sms-voice/latest/userguide/sms-limitations.html)
- [pypush imessage.py - SMSIncomingImage](https://github.com/JJTech0130/pypush/blob/sms-registration/imessage.py)

---

## 10. SMS Relay Without a Jailbroken Device

### 10.1 Native Apple Ecosystem

- **With iPhone + Mac/iPad:** SMS relay works out of the box. No jailbreak needed.
- **With Mac only (no iPhone):** iMessage works with Apple ID/email only; **phone number cannot be registered** without an iPhone or equivalent.

### 10.2 Non-Apple Devices

| Method | Jailbreak? | Notes |
|--------|------------|-------|
| **mac-registration-provider** | No | Generates registration on a real Mac. Supports **email** handles only; **no phone number** without iPhone. |
| **phone-registration-provider (beepserv)** | **Yes** | Requires jailbroken iPhone to extract validation data for phone number registration. |
| **pypush sms-registration** | No | Uses **Android** PNRGateway to obtain phone signature. No jailbreak, but needs Android + carrier gateway support. |

### 10.3 Summary

- **SMS relay** (iPhone → Mac) works without jailbreak in the normal Apple setup.
- **Phone number registration for iMessage on non-Apple devices** requires either:
  - A jailbroken iPhone (beepserv), or
  - An Android device with PNRGateway + pypush sms-registration (no jailbreak, but different stack).

**Sources:**
- [beeper/mac-registration-provider - GitHub](https://github.com/beeper/mac-registration-provider)
- [Phone Number Registration - OpenBubbles](https://openbubbles.app/docs/pnr)
- [Registering a Phone Number - BlueBubbles](https://docs.bluebubbles.app/server/advanced/registering-a-phone-number-with-your-imessage-account)

---

## 11. Configuration Files and Plists

On macOS, IDS stores service-specific data in plists:

- `~/Library/Preferences/com.apple.ids.service.com.apple.madrid.plist` — iMessage
- `~/Library/Preferences/com.apple.ids.service.com.apple.private.alloy.sms.plist` — SMS relay / alloy.sms

Deleting these (with Messages signed out) can reset account state. The alloy.sms plist holds SMS-related IDS registration and routing data.

**Sources:**
- [How to delete your Apple ID account from Messages - iPhone FAQ](https://www.iphonefaq.org/archives/975913)
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)

---

## 12. Source URLs Summary

| Source | URL |
|--------|-----|
| Apple Support - Forward text messages | https://support.apple.com/en-us/102545 |
| Apple Support - Set up SMS on Mac | https://support.apple.com/guide/messages/get-sms-mms-and-rcs-texts-from-iphone-icht8a28bb9a/mac |
| Apple Support - Text Message Forwarding security | https://support.apple.com/guide/security/iphone-text-message-forwarding-security-sec16bb20def/web |
| Apple Discussions - SMS relay without wifi | https://discussions.apple.com/thread/6649446 |
| Apple Stack Exchange - SMS Relay hardware | https://apple.stackexchange.com/questions/155280/sms-relay-hardware-requirements |
| pypush sms-registration | https://github.com/JJTech0130/pypush/tree/sms-registration |
| pypush ids/identity.py | https://github.com/JJTech0130/pypush/blob/sms-registration/ids/identity.py |
| pypush ids/__init__.py | https://github.com/JJTech0130/pypush/blob/sms-registration/ids/__init__.py |
| pypush ids/profile.py | https://github.com/JJTech0130/pypush/blob/sms-registration/ids/profile.py |
| pypush imessage.py | https://github.com/JJTech0130/pypush/blob/sms-registration/imessage.py |
| pypush sms_registration.py | https://github.com/JJTech0130/pypush/blob/sms-registration/sms_registration.py |
| pypush gateway_fetch.py | https://github.com/JJTech0130/pypush/blob/sms-registration/gateway_fetch.py |
| PNRGatewayClientV2 | https://github.com/JJTech0130/PNRGatewayClientV2 |
| beeper/phone-registration-provider | https://github.com/beeper/phone-registration-provider |
| beeper/mac-registration-provider | https://github.com/beeper/mac-registration-provider |
| Beeper Blog - Registration back | https://blog.beeper.com/2023/12/21/imessage-and-phone-registration-are-back-kinda/ |
| Identity Services - The Apple Wiki | https://theapplewiki.com/wiki/Identity_Services |
| Carrier Bundle - The Apple Wiki | https://theapplewiki.com/wiki/Carrier_Bundle |
| Carrier.plist - The iPhone Wiki | https://www.theiphonewiki.com/wiki/Carrier.plist |
| OpenBubbles PNR | https://openbubbles.app/docs/pnr |
| BlueBubbles - Registering phone number | https://docs.bluebubbles.app/server/advanced/registering-a-phone-number-with-your-imessage-account |
| docs/IDS_IDENTITY_SERVICES_RESEARCH.md | (this repo) |
| docs/IMESSAGE_DB_SCHEMA.md | (this repo) |

---

*Research completed February 27, 2026. Protocol details may change with Apple updates.*
