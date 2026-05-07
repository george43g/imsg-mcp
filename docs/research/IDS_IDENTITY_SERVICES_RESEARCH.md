# Apple Identity Services (IDS) Protocol Research

Comprehensive research on Apple's Identity Services (IDS) protocol used for iMessage key management and registration. Conducted Feb 2026.

---

## 1. Overview

**Identity Services (IDS)** is Apple's protocol, key server, and encryption mechanism used by FaceTime and iMessage to enable end-to-end encryption. It also refers to:

- The local daemon **identityservicesd** that implements this protocol on macOS
- A macOS system for local user authentication

IDS serves as a directory of:
- iMessage public keys
- Apple Push Notification service (APNs) addresses
- Contact information (phone numbers, emails) for key and device lookups

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [Apple Identity Service (IDS) - Apple Support](https://support.apple.com/guide/security/aside/secf752dc2e2/1/web)
- [iMessage, explained - JJTech](https://jjtech.dev/reverse-engineering/imessage-explained/)

---

## 2. Authentication Flow

### 2.1 RSA Key Generation and CSR

1. **Generate** a 2048-bit RSA key
2. **Create** a Certificate Signing Request (CSR) with:
   - **Common Name**: Uppercase hexadecimal SHA1 hash of the User ID
   - Public key from the generated RSA key
   - Signature from the generated key
3. **Post** the CSR to an authentication endpoint with gzipped plist data

### 2.2 Authentication Endpoints

| Method | Endpoint | Auth Data |
|--------|----------|-----------|
| **Apple ID** | `id-authenticate-ds-id` | Auth token from loginDelegates |
| **Phone Number** | `id-authenticate-phone-number` | Phone signatures and push token |

### 2.3 Request Body (Authentication)

- `realm-user-id`: User ID
- `csr`: CSR in DER format
- `authentication-data`: Service-specific authentication data

### 2.4 Response

- DER-encoded authentication certificate
- Status code

### 2.5 Headers

- Protocol version
- User-Agent

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [iMessage, explained - JJTech](https://jjtech.dev/reverse-engineering/imessage-explained/)

---

## 3. Request Signing Mechanism

### 3.1 Nonce Format

```
[01 (HTTP) / 00 (APNs auth)] [time in ms rounded to sec, 64-bit BE] [8 random bytes]
```

- 1 byte: Protocol type (0x01 for HTTP, 0x00 for APNs auth)
- 8 bytes: Timestamp in milliseconds, rounded to seconds, big-endian
- 8 bytes: Random bytes

### 3.2 Payload Format

- Nonce + Data fields
- Each field prefixed with BE 32-bit length
- Fields concatenated

### 3.3 HTTP Fields (for Signing)

- Bag Key
- Query String
- Payload
- Push token

### 3.4 Signature Format

- **Algorithm**: PKCS#1 SHA1 RSA
- **Input**: Payload (nonce + data)
- **Output**: Signature prefixed with two 0x1 bytes

### 3.5 Headers Format (Base64 Encoded)

| Header | Content |
|--------|---------|
| `x-item-nonce` | Nonce (base64) |
| `x-item-sig` | Signature (base64) |
| `x-item-cert` | Certificate (base64) |

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [Apple Push Notification Service - The Apple Wiki](https://theapplewiki.com/wiki/Apple_Push_Notification_Service)

---

## 4. Registration (id-register)

### 4.1 Endpoint

HTTP POST to `id-register` (URL from bag configuration)

### 4.2 Request Format

- **Content**: Gzipped plist
- **Headers**: Protocol version, authentication headers (x-item-nonce, x-item-sig, x-item-cert)

### 4.3 id-register Plist Body Schema

| Field | Description |
|-------|-------------|
| `device-name` | Device name |
| `hardware-version` | Hardware version string |
| `os-version` | OS version |
| `language` | Language/locale |
| `private-device-data` | Private device data |
| `validation-data` | Obfuscated binary blob (see Section 9) |
| `services` | Array of service capabilities (e.g. `com.apple.madrid`) |
| `users` | Multiple users with prefixed user IDs and signatures |
| `protocol-version` | Protocol version |

### 4.4 Registration Response Format

- **services**: Registered service info
- **users**: User registration status
- **uris**: URIs for further operations
- **certs**: IDS certificates for lookups
- **status codes**: 0 = success; others indicate errors (see Section 12)

### 4.5 Registration Flow

1. Obtain authentication certificate (Section 2)
2. Obtain push certificate from Albert activation server
3. Obtain push token from APNs (topic: `com.apple.madrid`)
4. Sign registration request with both auth cert and push cert
5. Send registration with device info, public keys, validation-data
6. Receive IDS certificate for lookups

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [iMessage, explained - JJTech](https://jjtech.dev/reverse-engineering/imessage-explained/)
- [IMessage - IMFreedom Knowledge Base](https://kb.imfreedom.org/protocols/imessage/)

---

## 5. Identity Key Format

### 5.1 Key Types

- **RSA**: 2048-bit for authentication
- **EC (Elliptic Curve)**: SECG secp256r1 (NIST P-256) for signing and encryption

### 5.2 Encoding

- **ASN.1 DER**: Binary format for keys and certificates
- **PEM**: Text format (DER base64-encoded)
- Keys can be nested (e.g. RSA key DER-encoded then PEM-encoded)

### 5.3 Compact EC Key Format (P256)

- **Point compression**: Store x-coordinate + 1 bit for y-coordinate sign
- **Y-coordinate**: Recoverable from x via curve equation; two possible values (y, -y); sign bit selects
- **Apple CryptoKit**: `compactRepresentation` format for P256; ~50% of private keys cannot be represented (reduces key-space)

**Sources:**
- [Apple Identity Service (IDS) - Apple Support](https://support.apple.com/guide/security/aside/secf752dc2e2/1/web)
- [On Cryptographic Key Formats - Apple Developer](https://developer.apple.com/forums/thread/680554)
- [CryptoKit compactRepresentation - Aidan Woods](https://www.aidanwoods.com/blog/apple-compact-representation)

---

## 6. Key Lookup (id-query)

### 6.1 Endpoint

`id-query-by-service` or equivalent from bag:
- `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/queryByService`

### 6.2 Request

- Service identifier (e.g. `com.apple.madrid`)
- User IDs / handles to query
- Signed with IDS certificate

### 6.3 Response

- One identity per device on the account
- Public keys per device
- Push tokens per device
- APNs addresses for routing

### 6.4 Session Tokens

- Returned from key lookup
- **Required** to send messages
- **Per-lookup**: Each lookup may return new session tokens
- **Expiration**: Session tokens expire (exact lifetime not publicly documented)

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [iMessage, explained - JJTech](https://jjtech.dev/reverse-engineering/imessage-explained/)
- [gossgirl69 / com.apple.facetime.bag plist](https://gist.github.com/gossgirl69/904b17f940492b3f80e0)

---

## 7. The Bag Endpoint and Service URLs

### 7.1 Bag Endpoint

```
http://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=<id>
```

- **ix parameter**: 1–5 (different bag IDs for different services/configs)
- **Response**: Plist/XML with service URLs and configuration

### 7.2 Service URLs (from bag data)

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `id-query-by-service` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/queryByService` | Key lookup |
| `vc-profile-get-handles` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/getHandles` | Get user handles |
| `gk-commnat-main1-name` | `commnat-main.ess.apple.com:16385` | Communication server |

### 7.3 Domain Info

- **init.ess.apple.com**: CNAME to `init.ess.g.aaplimg.com`
- IPs: 17.253.21.131, 17.253.119.202, 17.253.21.145, 17.253.119.201

**Sources:**
- [init.ess.apple.com - nodedata.io](https://nodedata.io/init.ess.apple.com)
- [kahunalu/apple_bag - GitHub](https://github.com/kahunalu/apple_bag)
- [gossgirl69 / com.apple.facetime.bag plist](https://gist.github.com/gossgirl69/904b17f940492b3f80e0)

---

## 8. HTTP over APNs

### 8.1 Overview

IDS uses a pseudo-HTTP layer on top of APNs for queries and responses. Messages are delivered via APNs push tokens.

### 8.2 APNs Topic

- **iMessage**: `com.apple.madrid`

### 8.3 APNs Binary Protocol

- 1 byte: Message type (command ID)
- 4 bytes: Payload length (BE)
- Items: 1 byte type, 2 byte length, value
- All integers big-endian

### 8.4 IDS Payload Keys (Abbreviated)

From [nicolas17 gist](https://gist.github.com/nicolas17/559bec0d8e636f93f62cca844ee94ada):

| Abbrev | Full Name | Meaning |
|--------|-----------|---------|
| `c` | command | Command type |
| `cc` | commandContext | Command context |
| `v` | version | Protocol version |
| `P` | payload | Payload data |
| `N` | bulkedPayload | Bulk payload |
| `i` | messageId | Message ID |
| `U` | messageUUID | Message UUID |
| `D` | deliveryStatus | Delivery status |
| `Dc` | deliveryContext | Delivery context |
| `sT` | sessionToken | Session token |
| `hT` | homekitSessionToken | HomeKit session token |
| `gd` | generateDeliveryReceipt | Generate delivery receipt |
| `mA` | MMCSAuthToken | MMCS auth token |
| `mR` | MMCSAuthUrl | MMCS auth URL |
| `mU` | MMCSAuthId | MMCS auth ID |
| `dal` | MMCSDownloadAuthList | MMCS download auth list |
| `dul` | MMCSDownloadUrlList | MMCS download URL list |
| `cV` | contentVersion | Content version |
| `cH` | contentHeaders | Content headers |
| `cB` | contentBody | Content body |
| `cR` | contentReferenceSignature | Content reference signature |
| `s` | responseStatus | Response status |
| `e` | epochTimeNanos | Epoch time (nanos) |
| `oe` | originalEpoch | Original epoch |

**HTTP-over-APNs fields** (b, v, h, u, c, U, cT): These map to the abbreviated payload keys above. The exact mapping for b/v/h/u/c/U/cT in the binary APNs format is not fully documented in public sources; the nicolas17 gist provides the plist/payload key names.

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [Apple Push Notification Service - The Apple Wiki](https://theapplewiki.com/wiki/Apple_Push_Notification_Service)
- [nicolas17 / gist:559bec0d8e636f93f62cca844ee94ada](https://gist.github.com/nicolas17/559bec0d8e636f93f62cca844ee94ada)

---

## 9. validation-data

### 9.1 What It Is

- **Purpose**: Obfuscated binary blob that Apple uses to verify the client is legitimate Apple software
- **Used in**: id-register request
- **Location**: Generated by identityservicesd (or equivalent) on macOS; embedded/obfuscated in Apple binaries

### 9.2 How pypush Generates It

- **Method**: Unicorn Engine emulation
- **Process**: Load and run an older macOS binary (from identityservicesd or related framework) that contains the obfuscated validation logic
- **Output**: The validation binary produces the expected blob when given device/registration inputs
- **Challenge**: Protocol and binary change with each macOS/iOS update; requires reverse engineering and emulation

### 9.3 Beeper mac-registration-provider

- **Purpose**: Generates iMessage registration data on a Mac
- **Repo**: [beeper/mac-registration-provider](https://github.com/beeper/mac-registration-provider)
- **Language**: Go (95.9%) + Objective-C
- **Modes**: Relay (websocket), Submit (periodic push), Once (single code to stdout)
- **How it works**: Runs on a real Mac; uses native macOS APIs/frameworks to produce registration data (including validation-data). No emulation needed; requires supported macOS versions.

**Sources:**
- [iMessage, explained - JJTech](https://jjtech.dev/reverse-engineering/imessage-explained/)
- [JJTech0130/pypush - GitHub](https://github.com/JJTech0130/pypush)
- [beeper/mac-registration-provider - GitHub](https://github.com/beeper/mac-registration-provider)
- [docs/ICLOUD_API_RESEARCH.md](./ICLOUD_API_RESEARCH.md) (this repo)

---

## 10. Sub-Services Under com.apple.madrid

| Service | Purpose |
|---------|---------|
| `com.apple.madrid` | Main iMessage/FaceTime identity service |
| `com.apple.private.alloy.sms` | SMS-related functionality within identity services |
| `gelato` | (Related service; exact purpose not fully documented) |
| `biz` | Business messaging |
| `gamecenter` | Game Center integration |

**Sources:**
- [What is com.apple.madrid? - Apple Discussions](https://discussions.apple.com/thread/6799988)

---

## 11. Group Chat Participants at IDS Level

### 11.1 Local Resolution

- Group chat participants are stored locally in `~/Library/Messages/chat.db`
- `handle` table: participant identifiers (phone/email)
- `message` table: `handle_id` links to `handle.rowid`
- `cache_roomnames`: group chat identifiers (e.g. `chatNNNNNNNNNNNNNNNNNN`)

### 11.2 IDS-Level Resolution

- To send to a group, the client must resolve each participant's handles via IDS
- `id-get-handles` or `id-query` returns user IDs and device info per participant
- Each participant's devices are looked up; keys and push tokens are retrieved per device
- Message is encrypted and delivered to each device (including sender's own devices)

**Sources:**
- [Fun with iMessage - imbstack](https://imbstack.com/fun-with-imessage/)
- [How iMessage sends and receives messages securely - Apple Support](https://support.apple.com/guide/security/how-imessage-sends-and-receives-messages-sec70e68c949/web)

---

## 12. Status Codes

| Code | Meaning | Notes |
|------|---------|------|
| 0 | Success | Registration/lookup succeeded |
| 6009 | Alert | (Common alert; exact semantics not documented) |
| 5051 | (Error) | (Exact semantics not documented) |
| 9 | Bad Request | "Bad Request From Server" / Error 9 in logs |

**Note**: Specific codes 6009 and 5051 are not documented in public Apple support. They appear in reverse-engineering contexts; exact meanings may vary by endpoint and version.

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [Unable to sign into Messages on Mavericks - Apple Stack Exchange](https://apple.stackexchange.com/questions/131666/unable-to-sign-into-messages-on-mavericks)

---

## 13. Pair-EC Encryption (from Apple Wiki)

*Note: Pair-EC is documented on the [Identity Services wiki](https://theapplewiki.com/wiki/Identity_Services) under the Pair-EC section. The wiki contains additional protobuf structures (PreKeyData, InnerMessage, OuterMessage, KtLoggableData) that may not be fully indexed by search engines. For complete definitions, consult the wiki directly. The following is based on available documentation and cryptographic conventions.*

### 13.1 Overview

- **Pair-EC**: Elliptic-curve-based encryption for iMessage
- **Purpose**: Forward secrecy via pre-keys (similar to Signal)
- **Evolution**: Predecessor to PQ3 (post-quantum upgrade, Feb 2024)

### 13.2 PreKeyData Protobuf

- Structure for pre-key material
- Contains pre-key public keys and identifiers
- Used in key exchange

### 13.3 InnerMessage and OuterMessage Protobufs

- **OuterMessage**: Encrypted payload wrapper
- **InnerMessage**: Actual message content
- Layered encryption (outer key protects inner)

### 13.4 KtLoggableData Protobuf

- **KT**: Key Transparency
- Loggable data for key transparency / verification
- Used in Contact Key Verification

### 13.5 Compact EC Key Format

- P256 (secp256r1)
- x-coordinate + y-parity bit (compact representation)
- ~50% key-space reduction for Apple's compact format

### 13.6 Encryption Pipeline

1. **ECDH**: Derive shared secret from sender private + recipient public
2. **HKDF**: Derive encryption keys from shared secret
3. **AES-CTR**: Encrypt payload

### 13.7 Key Validator Format

- **Length**: 7 bytes
- **Purpose**: Validates key material

### 13.8 Counter Format

- Hash of device keys + pre-key
- Used for ordering/verification

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)
- [iMessage with PQ3 - Apple Security](https://security.apple.com/blog/imessage-pq3/)
- [Security analysis of the iMessage PQ3 protocol - ePrint](https://eprint.iacr.org/2024/357)
- [CryptoKit compactRepresentation - Aidan Woods](https://www.aidanwoods.com/blog/apple-compact-representation)

---

## 14. Activation (Albert)

### 14.1 Endpoint

```
https://albert.apple.com/WebObjects/ALUnbrick.woa/wa/deviceActivation?device=MacOS
```

### 14.2 Request

- Device class, product type, serial number
- Build and product versions
- Device certificate request
- FairPlay certificates and signatures
- Obfuscated key (embedded in Apple binary) for validation

### 14.3 Response

- AccountTokenCertificate
- DeviceCertificate
- AccountTokenSignature
- AccountToken

### 14.4 Usage

- Client certificate for TLS to `courier.push.apple.com`
- Required for APNs connection and push token

**Sources:**
- [IMessage - IMFreedom Knowledge Base](https://kb.imfreedom.org/protocols/imessage/)
- [iMessage, explained - JJTech](https://jjtech.dev/reverse-engineering/imessage-explained/)

---

## 15. Getting Handles (id-get-handles)

### 15.1 Endpoint

GET request to `id-get-handles` (from bag)

### 15.2 Request

- Authentication headers
- Protocol headers

### 15.3 Response

- Plist with email addresses and device identifiers
- User handles for the account

**Sources:**
- [Identity Services - The Apple Wiki](https://theapplewiki.com/wiki/Identity_Services)

---

## 16. Source URLs Summary

| Source | URL |
|--------|-----|
| Identity Services (Apple Wiki) | https://theapplewiki.com/wiki/Identity_Services |
| Apple Push Notification Service (Apple Wiki) | https://theapplewiki.com/wiki/Apple_Push_Notification_Service |
| Apple Identity Service (Apple Support) | https://support.apple.com/guide/security/aside/secf752dc2e2/1/web |
| iMessage, explained (JJTech) | https://jjtech.dev/reverse-engineering/imessage-explained/ |
| iMessage Overview Original (JJTech) | https://jjtech.dev/reverse-engineering/imessage-overview-original |
| iMessage (IMFreedom KB) | https://kb.imfreedom.org/protocols/imessage/ |
| nicolas17 IDS payload keys gist | https://gist.github.com/nicolas17/559bec0d8e636f93f62cca844ee94ada |
| gossgirl69 FaceTime bag plist | https://gist.github.com/gossgirl69/904b17f940492b3f80e0 |
| pypush (GitHub) | https://github.com/JJTech0130/pypush |
| beeper mac-registration-provider | https://github.com/beeper/mac-registration-provider |
| kahunalu apple_bag | https://github.com/kahunalu/apple_bag |
| init.ess.apple.com (nodedata) | https://nodedata.io/init.ess.apple.com |
| CryptoKit compactRepresentation | https://www.aidanwoods.com/blog/apple-compact-representation |
| iMessage PQ3 (Apple Security) | https://security.apple.com/blog/imessage-pq3/ |
| iMessage PQ3 (ePrint) | https://eprint.iacr.org/2024/357 |
| BlastDoor for Messages and IDS | https://support.apple.com/guide/security/blastdoor-for-messages-and-ids-secd3c881cee/web |
| How iMessage sends and receives messages securely | https://support.apple.com/guide/security/how-imessage-sends-and-receives-messages-sec70e68c949/web |

---

## 17. Code Examples

### 17.1 Nonce Generation (Pseudocode)

```python
import struct
import os
import time

def generate_nonce(protocol_type: int = 0x01) -> bytes:
    """protocol_type: 0x01=HTTP, 0x00=APNs"""
    timestamp_ms = int(time.time() * 1000)
    timestamp_sec = (timestamp_ms // 1000) * 1000
    return (
        bytes([protocol_type]) +
        struct.pack(">Q", timestamp_sec) +
        os.urandom(8)
    )
```

### 17.2 CSR Common Name (Pseudocode)

```python
import hashlib

def csr_common_name(user_id: str) -> str:
    """User ID = email or phone; CN = uppercase hex SHA1"""
    digest = hashlib.sha1(user_id.encode()).hexdigest()
    return digest.upper()
```

### 17.3 Bag Request (URL)

```
http://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=4
```

---

*Research completed Feb 2026. Protocol details may change with Apple updates.*
