# Apple GrandSlam (GSA) Authentication Protocol – Comprehensive Research

Research conducted Feb 2026. Exhaustive findings on Apple's GrandSlam Authentication (GSA) protocol used for iCloud, iMessage (IDS), App Store, and related Apple services.

---

## Table of Contents

1. [Overview](#1-overview)
2. [GSA Endpoint and Request Format](#2-gsa-endpoint-and-request-format)
3. [SRP-6a Protocol Parameters](#3-srp-6a-protocol-parameters)
4. [Required HTTP Headers](#4-required-http-headers)
5. [Complete Authentication Flow](#5-complete-authentication-flow)
6. [Two-Factor Authentication (2FA)](#6-two-factor-authentication-2fa)
7. [Password Equivalent Token (PET)](#7-password-equivalent-token-pet)
8. [Anisette Data](#8-anisette-data)
9. [Anisette v1 vs v3](#9-anisette-v1-vs-v3)
10. [Known Failure Modes](#10-known-failure-modes)
11. [Reference Implementations](#11-reference-implementations)
12. [Sources and URLs](#12-sources-and-urls)

---

## 1. Overview

**GrandSlam Authentication (GSA)** is Apple's authentication protocol used across iCloud, App Store, iTunes, Xcode, and IDS (iMessage). It is based on the **SRP (Secure Remote Password)** protocol, specifically **SRP-6a**, which allows password verification without transmitting the password over the network.

- **Primary endpoint**: `https://gsa.apple.com/grandslam/GsService2`
- **Communication format**: XML-encoded property lists (plist)
- **Content-Type**: `text/x-xml-plist`
- **Process responsible on Apple devices**: Auth Kit Daemon (`akd`)

---

## 2. GSA Endpoint and Request Format

### 2.1 Primary Endpoint

| Endpoint | Method | Purpose |
|---------|--------|---------|
| `https://gsa.apple.com/grandslam/GsService2` | POST | Main SRP init/complete |
| `https://gsa.apple.com/grandslam/GsService2/validate` | GET | 2FA code validation (trusted device) |
| `https://gsa.apple.com/grandslam/GsService2/lookup` | GET | Provisioning URLs (anisette v3) |
| `https://gsa.apple.com/auth/verify/trusteddevice` | GET | Trigger 2FA prompt on trusted device |
| `https://gsa.apple.com/auth/verify/phone/` | PUT | Trigger SMS 2FA code |
| `https://gsa.apple.com/auth/verify/phone/securitycode` | POST | Submit SMS 2FA code |

### 2.2 Request Structure (XML Plist)

All GSA requests use a top-level plist with `Header` and `Request` keys:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Header</key>
    <dict>
        <key>Version</key>
        <string>1.0.1</string>
    </dict>
    <key>Request</key>
    <dict>
        <!-- Request-specific parameters -->
    </dict>
</dict>
</plist>
```

### 2.3 Init Request (Step 1)

```python
# Init request parameters
{
    "A2k": A,           # Client SRP public key (bytes, base64 in XML <data>)
    "ps": ["s2k", "s2k_fo"],  # Supported protocols
    "u": username,      # Apple ID (email)
    "o": "init",
    "cpd": { ... }      # Client parameter data (see Section 4)
}
```

### 2.4 Init Response

```python
{
    "sp": "s2k" | "s2k_fo",   # Server-selected protocol
    "s": salt,                 # bytes (base64)
    "B": server_public_key,    # bytes (base64)
    "i": iterations,           # PBKDF2 iteration count
    "c": continuation_token    # string, used in complete step
}
```

### 2.5 Complete Request (Step 2)

```python
{
    "M1": M,            # Client SRP proof (bytes, base64)
    "c": c,             # Continuation token from init
    "u": username,
    "o": "complete",
    "cpd": { ... }
}
```

### 2.6 Complete Response

```python
{
    "M2": M2,           # Server SRP proof (for client verification)
    "spd": encrypted_session_data  # AES-CBC encrypted, decrypt with session key
}
```

---

## 3. SRP-6a Protocol Parameters

### 3.1 Library Configuration (Python `srp._pysrp`)

```python
import srp._pysrp as srp

# Required for Apple compatibility
srp.rfc5054_enable()
srp.no_username_in_x()
```

### 3.2 SRP Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Group** | NG_2048 | RFC 5054 2048-bit group (N, g) |
| **Hash algorithm** | SHA-256 | `hash_alg=srp.SHA256` |
| **Key size** | 2048 bits | Standard RFC 5054 Appendix A |
| **Username in x** | No | `no_username_in_x()` – Apple does not include username in x calculation |

### 3.3 Password Pre-Processing (s2k vs s2k_fo)

The raw password is **not** used directly. It is first derived:

**s2k:**
```python
p = hashlib.sha256(password.encode("utf-8")).digest()
# Then: PBKDF2-HMAC-SHA256(p, salt, iterations, 32)
```

**s2k_fo (fallback):**
```python
p = hashlib.sha256(password.encode("utf-8")).digest().hex().encode("utf-8")
# Then: PBKDF2-HMAC-SHA256(p, salt, iterations, 32)
```

The resulting 32-byte value is used as the SRP password (`usr.p`).

### 3.4 Session Key Derivation (for spd decryption)

```python
extra_data_key = HMAC-SHA256(session_key, "extra data key:")
extra_data_iv  = HMAC-SHA256(session_key, "extra data iv:")[:16]

# AES-128-CBC decrypt spd with extra_data_key and extra_data_iv
# PKCS#7 padding
```

---

## 4. Required HTTP Headers

### 4.1 Core Headers (all requests)

| Header | Example / Notes |
|--------|-----------------|
| `Content-Type` | `text/x-xml-plist` |
| `Accept` | `*/*` or `text/x-xml-plist` |
| `User-Agent` | `akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0` (varies by client) |
| `X-MMe-Client-Info` | `<iPhone6,1> <iPhone OS;12.4.8;16G201> <com.apple.akd/1.0 (com.apple.akd/1.0)>` |

### 4.2 CPD (Client Parameter Data) – in Request body

CPD is sent inside the `Request.cpd` dict. It includes both meta headers and anisette data:

| Key | Type | Example / Notes |
|-----|------|-----------------|
| `bootstrap` | bool | `true` |
| `icscrec` | bool | `true` (AltServer) or omitted |
| `pbe` | bool | `false` |
| `prkgen` / `ckgen` | bool | `true` |
| `svct` | string | `"iCloud"` or `"iTunes"` |
| `X-Apple-I-Client-Time` | string | ISO 8601 UTC, e.g. `2026-02-27T12:00:00Z` |
| `X-Apple-I-TimeZone` | string | e.g. `UTC` |
| `loc` | string | `en_US` |
| `X-Apple-Locale` | string | `en_US` |
| `X-Apple-I-MD-RINFO` | string | `17106176` or `50660608` |
| `X-Apple-I-MD-LU` | string | Base64 of uppercase USER_ID / local user |
| `X-Mme-Device-Id` | string | Device UDID (hex, uppercase) |
| `X-Apple-I-SRL-NO` | string | Device serial number |
| `X-Apple-I-MD` | string | **Anisette one-time password** (time-sensitive) |
| `X-Apple-I-MD-M` | string | **Anisette machine ID** |

### 4.3 Additional CPD Keys (optional)

| Key | Value | Notes |
|-----|-------|-------|
| `capp` | `"AppStore"` | Client app identifier |
| `dc` | `"#d4c5b3"` | Display color |
| `dec` | `"#e1e4e3"` | |
| `prtn` | `"ME349"` | Device part number |

---

## 5. Complete Authentication Flow

### Step-by-Step Flow

```
┌─────────┐                                    ┌──────────────┐
│ Client  │                                    │ gsa.apple.com│
└────┬────┘                                    └──────┬───────┘
     │                                                 │
     │  1. POST /grandslam/GsService2                   │
     │     Request: { A2k, ps, u, o:"init", cpd }      │
     │────────────────────────────────────────────────>│
     │                                                 │
     │  2. Response: { sp, s, B, i, c }                │
     │<────────────────────────────────────────────────│
     │                                                 │
     │  3. Derive password: PBKDF2(s2k/s2k_fo)          │
     │  4. Compute M1 = process_challenge(s, B)        │
     │                                                 │
     │  5. POST /grandslam/GsService2                  │
     │     Request: { M1, c, u, o:"complete", cpd }    │
     │────────────────────────────────────────────────>│
     │                                                 │
     │  6. Response: { M2, spd }                       │
     │<────────────────────────────────────────────────│
     │                                                 │
     │  7. Verify M2 (session authenticity)           │
     │  8. Decrypt spd with session key                │
     │  9. Extract dsid, idms_token, etc.               │
     │                                                 │
     │  [If 2FA required]                              │
     │  10. Trigger: GET /auth/verify/trusteddevice     │
     │      or PUT /auth/verify/phone/                  │
     │  11. Submit: GET .../validate or POST .../securitycode
     │                                                 │
     └─────────────────────────────────────────────────┘
```

### 2FA Detection

If the server returns a 2FA response (e.g. `needs2FA` or similar), the client must:

1. Build an identity token: `base64(dsid + ":" + idms_token)`
2. Use `X-Apple-Identity-Token` header with that value
3. Trigger the chosen factor (trusted device or SMS)
4. Submit the 6-digit code

---

## 6. Two-Factor Authentication (2FA)

### 6.1 GrandSlam 2FA Method

GSA uses **GrandSlam-native 2FA**:

1. After SRP complete, the response may indicate 2FA is required.
2. Client receives `dsid` and `idms_token` from the decrypted `spd`.
3. Identity token: `base64(dsid + ":" + idms_token)`
4. Headers for 2FA: `X-Apple-Identity-Token`, `X-Apple-App-Info`, `X-Xcode-Version` (or similar)

### 6.2 Trusted Device Flow

| Step | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| Trigger | `https://gsa.apple.com/auth/verify/trusteddevice` | GET | Show 2FA prompt on trusted device |
| Submit | `https://gsa.apple.com/grandslam/GsService2/validate` | GET | Submit code via `security-code` header |

### 6.3 SMS Flow

| Step | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| Trigger | `https://gsa.apple.com/auth/verify/phone/` | PUT | Send SMS: `{"phoneNumber": {"id": 1}, "mode": "sms"}` |
| Submit | `https://gsa.apple.com/auth/verify/phone/securitycode` | POST | Body: `{"phoneNumber": {"id": 1}, "mode": "sms", "securityCode": {"code": "123456"}}` |

### 6.4 Legacy / pyicloud Approach

**pyicloud** uses a different authentication path (likely web-based):

- `api.requires_2fa` – detect if 2FA needed
- `api.validate_2fa_code(code)` – submit code
- `api.trust_session()` – trust session (expires ~2 months)

This is **not** the GrandSlam GSA flow; it uses Apple's web authentication endpoints.

---

## 7. Password Equivalent Token (PET)

### 7.1 Definition

A **Password Equivalent Token (PET)** is a long-lived credential obtained after successful GrandSlam authentication. It allows downstream services (e.g. IDS for iMessage) to authenticate without re-running the full SRP flow.

### 7.2 Usage

- **pypush**: After GrandSlam + 2FA, the client obtains a PET used for IDS (iMessage) registration and key lookup.
- **Lifetime**: Server-side; not publicly documented. Tokens may expire for some operations (e.g. backups) while remaining valid for others (photos, sync).

### 7.3 Related: iCloud Tokens (Elcomsoft)

Elcomsoft research describes iCloud authentication tokens that:

- Do not contain passwords
- Enable access to iCloud data without 2FA for each request
- Have variable expiration (e.g. 5 min–12 hours for backups; some never expire)
- Can be extracted from live macOS/Windows with tools like Apple Token Extractor (ATEX)

---

## 8. Anisette Data

### 8.1 Purpose

Anisette data proves to Apple that the client is a legitimate Apple device. It is required for:

- GSA authentication
- App signing / provisioning (SideStore, AltServer)
- Device registration

### 8.2 Key Fields

| Field | HTTP Header / CPD Key | Description |
|-------|------------------------|-------------|
| One-time password | `X-Apple-I-MD` | Time-sensitive (~30 seconds). "Anisette OTP". |
| Machine ID | `X-Apple-I-MD-M` | Persistent machine identifier. |
| Routing info | `X-Apple-I-MD-RINFO` | `17106176` or `50660608`. |
| Local user | `X-Apple-I-MD-LU` | Base64-encoded local user ID. |

### 8.3 Generation

- **Native**: Generated by Apple's **AFD (Apple FairPlay / Auth)** binaries. Requires macOS or iOS.
- **Reverse-engineering**: Some projects hook into `akd` or AFD to call the internal generation function and extract values.
- **Server-based**: Anisette servers spoof a Mac and return the data. No account info is sent to the server.

### 8.4 ADI (Apple Device Information)

- **libCoreADI** (from Apple Music APK) and **libstoreservicescore** are used in Provision/anisette_server to retrieve ADI.
- ADI is stored locally (e.g. `~/.adi/adi.pb`) and allows the machine to be "remembered" by Apple.
- **adi_pb**: Provisioned blob used in anisette v3; required for `get_headers`.

---

## 9. Anisette v1 vs v3

### 9.1 v1 Servers

- Simpler; return anisette headers directly.
- **Risk**: When many users share the same v1 server, Apple's security systems detect the pattern and may **lock accounts**.
- Error code reported: **-20751** when locked.

### 9.2 v3 Servers

- **Recommended** for SideStore 0.4.0+ and similar tools.
- **Provisioning**: Requires a WebSocket provisioning session to obtain `adi_pb`.
- **Flow**:
  1. `GET https://gsa.apple.com/grandslam/GsService2/lookup` → provisioning URLs
  2. Connect to `wss://<server>/v3/provisioning_session`
  3. Protocol: `GiveIdentifier` → `GiveStartProvisioningData` (spim) → `GiveEndProvisioningData` (cpim → tk, ptm) → `ProvisioningSuccess` (adi_pb)
  4. `POST https://<server>/v3/get_headers` with `{"identifier": local_user, "adi_pb": adi_pb}` → JSON with OTP and other headers

### 9.3 v3 Client (Python)

```python
from anisettev3 import AnisetteV3SyncClient, MAIN_ANI

client = AnisetteV3SyncClient(MAIN_ANI)  # MAIN_ANI = "https://ani.sidestore.io"
headers = client.get_headers()
# Returns dict suitable for CPD/headers
```

### 9.4 Deployment

- **Dadoum/anisette-v3-server**: Docker-based; deployable on Render, etc.
- **Official SideStore list**: `https://servers.sidestore.io/servers.json`
- **Custom list**: Host `servers.json` (e.g. GitHub Pages) with `{"name": "...", "address": "https://..."}` entries.

---

## 10. Known Failure Modes

### 10.1 Account Lockout

- **Cause**: Shared anisette servers (especially v1), many users with same machine ID.
- **Symptom**: Error -20751, account locked.
- **Mitigation**: Use v3 servers, host your own anisette server.

### 10.2 Invalid Anisette

- **Cause**: Stale `X-Apple-I-MD` (OTP expires ~30 seconds), wrong machine ID, or malformed data.
- **Symptom**: Auth failure, "invalid" responses.

### 10.3 Detection Signatures

- Apple may detect:
  - Repeated use of same anisette across many accounts
  - Non-Apple User-Agent / Client-Info
  - Missing or inconsistent CPD fields
  - SSL pinning bypass / proxy traffic (mitm)

### 10.4 A2k vs Init Flow

- **MathewYaldo/Apple-GSA-Protocol** uses `A2k` as a **precomputed salted verification key** (different from JJTech's init flow).
- That approach may be legacy or for a different GSA variant; JJTech's init→complete flow is the widely referenced implementation.

---

## 11. Reference Implementations

### 11.1 JJTech0130 GrandSlam Gist

- **URL**: https://gist.github.com/JJTech0130/049716196f5f1751b8944d93e73d3452
- **Language**: Python
- **Features**: Full SRP init/complete, password encryption (s2k/s2k_fo), CBC decryption of spd, 2FA (trusted device + SMS), anisette integration.
- **Dependencies**: `srp`, `plistlib`, `requests`, `cryptography`, `anisette`, `useragent` (custom).

### 11.2 MathewYaldo/Apple-GSA-Protocol

- **URL**: https://github.com/MathewYaldo/Apple-GSA-Protocol
- **Language**: Python
- **Features**: A2k-based flow, hardcoded anisette (for testing). Documents that `X-Apple-I-MD` is time-sensitive.
- **Limitation**: Does not obtain M2 successfully; anisette must be properly generated.

### 11.3 PyDunk

- **URL**: https://github.com/nythepegasus/PyDunk
- **Language**: Python
- **Features**: Cleaned-up package for GSA communication, based on JJTech's work.

### 11.4 anisettev3 (Python client)

- **URL**: https://github.com/nythepegasus/pyAnisetteV3
- **PyPI**: `anisettev3`
- **Features**: Sync/async client for anisette-v3-server, provisioning + get_headers.

---

## 12. Sources and URLs

| Resource | URL |
|----------|-----|
| GrandSlam Gist (JJTech0130) | https://gist.github.com/JJTech0130/049716196f5f1751b8944d93e73d3452 |
| Apple-GSA-Protocol | https://github.com/MathewYaldo/Apple-GSA-Protocol |
| PyDunk | https://github.com/nythepegasus/PyDunk |
| SideStore Anisette Docs | https://docs.sidestore.io/docs/advanced/anisette |
| SideStore Server List | https://servers.sidestore.io/servers.json |
| anisette-v3-server (Dadoum) | https://github.com/Dadoum/anisette-v3-server |
| pyAnisetteV3 | https://github.com/nythepegasus/pyAnisetteV3 |
| Provision / libprovision | https://github.com/Dadoum/provision |
| libprovision (Siguza) | https://github.com/Siguza/libprovision |
| RFC 5054 (SRP) | https://rfc-editor.org/rfc/rfc5054.txt |
| Elcomsoft iCloud Tokens | https://blog.elcomsoft.com/2017/11/icloud-authentication-tokens-inside-out/ |
| pypush | https://github.com/JJTech0130/pypush |
| pyicloud | https://github.com/picklepete/pyicloud |

---

## Appendix A: Code Snippet – GSA Init (JJTech-style)

```python
import srp._pysrp as srp
import plistlib as plist

srp.rfc5054_enable()
srp.no_username_in_x()

usr = srp.User(username, bytes(), hash_alg=srp.SHA256, ng_type=srp.NG_2048)
_, A = usr.start_authentication()

body = {
    "Header": {"Version": "1.0.1"},
    "Request": {
        "A2k": A,
        "ps": ["s2k", "s2k_fo"],
        "u": username,
        "o": "init",
        "cpd": generate_cpd(),
    },
}

resp = requests.post(
    "https://gsa.apple.com/grandslam/GsService2",
    headers={"Content-Type": "text/x-xml-plist", "User-Agent": "...", "X-MMe-Client-Info": "..."},
    data=plist.dumps(body),
)
r = plist.loads(resp.content)["Response"]
# r["sp"], r["s"], r["B"], r["i"], r["c"]
```

---

## Appendix B: Code Snippet – Password Encryption

```python
def encrypt_password(password, salt, iterations, protocol):
    assert protocol in ["s2k", "s2k_fo"]
    p = hashlib.sha256(password.encode("utf-8")).digest()
    if protocol == "s2k_fo":
        p = p.hex().encode("utf-8")
    return hashlib.pbkdf2_hmac("sha256", p, salt, iterations, 32)
```

---

*Document generated from research of public implementations, documentation, and reverse-engineering references. Protocol details may change with Apple updates.*
