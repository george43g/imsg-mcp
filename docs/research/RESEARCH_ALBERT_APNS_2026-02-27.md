# Deep Research Findings: Albert Activation Server & APNs Binary Protocol

**Research Date:** February 27, 2026  
**Topics:** Albert Activation Server (APNs Certificate) | APNs Binary Protocol

---

# TOPIC A: Albert Activation Server (APNs Certificate)

## 1. Overview

**Albert** is Apple's iPhone/macOS activation server that handles device certification and authentication. It attests certificates for use in Apple Push Notification Service (APNs) and other services (iMessage, HomeKit, etc.).

**Source:** [The Apple Wiki - Albert](https://theapplewiki.com/wiki/Albert)

---

## 2. Albert Endpoint and POST Format

### Endpoint URL

```
https://albert.apple.com/deviceservices/deviceActivation?device={device_class}
```

The `device` query parameter specifies the device class (e.g., `MacOS`, `Windows`, `iPhone`, etc.).

### Request Method

**HTTP POST** with URL-encoded form data.

### Activation-Info Body Format

The POST body contains a single form field `activation-info` whose value is a **binary plist** (or non-binary plist in some flows) containing:

```python
# From pypush/apns/albert.py - exact structure
{
    "ActivationInfoComplete": True,
    "ActivationInfoXML": activation_info,  # plist bytes
    "FairPlayCertChain": FAIRPLAY_CERT_CHAIN,  # bytes
    "FairPlaySignature": signature,  # bytes
}
```

The `ActivationInfoXML` itself is a plist containing:

```python
{
    "ActivationRandomness": str(uuid.uuid4()),
    "ActivationState": "Unactivated",
    "BuildVersion": build,           # e.g. "10.6.4"
    "DeviceCertRequest": csr.encode("utf-8"),  # PEM-encoded CSR
    "DeviceClass": device_class,     # e.g. "MacOS", "Windows"
    "ProductType": model,             # e.g. "windows1,1"

    "ProductVersion": version,        # e.g. "10.6.4"
    "SerialNumber": serial,
    "UniqueDeviceID": udid,
}
```

---

## 3. FairPlay Signature

### What It Is

The **FairPlaySignature** is a **SHA1 RSA signature** of the `ActivationInfoXML` plist bytes. It proves the activation request originates from a legitimate Apple device.

### How It's Generated

1. **Lockdownd** (on real devices) generates a SHA1 hash of the ActivationInfoXML
2. **fairplayd** completes the signature process using the device's private key
3. The signature uses **PKCS1v15 padding** and **SHA1** hash

**Code example (pypush):**

```python
signature = fairplay_key.sign(activation_info, padding.PKCS1v15(), hashes.SHA1())
```

### FairPlay Key and Certificate Chain

pypush uses a **hardcoded FairPlay private key** and **certificate chain** (base64 decoded from constants in `albert.py`). These are Apple's FairPlay attestation credentials used to sign the activation request.

---

## 4. Device Fields Required

| Field | Description | Example |
|-------|-------------|---------|
| `UniqueDeviceID` | UUID (UDID) | `str(uuid.uuid4())` |
| `SerialNumber` | Device serial | `"WindowSerial"` |
| `ProductType` | Model identifier | `"windows1,1"` |
| `ProductVersion` | OS version | `"10.6.4"` |
| `BuildVersion` | OS build | `"10.6.4"` |
| `DeviceClass` | Device class | `"MacOS"`, `"Windows"`, etc. |

The device also generates a **1024-bit RSA activation key** and creates a **Certificate Signing Request (CSR)** signed with that key. The CSR is included in `DeviceCertRequest`.

---

## 5. Certificate Response Format

Albert responds with an **XML document** containing a plist. The plist is extracted from `<Protocol>...</Protocol>` tags.

```python
# Response parsing (pypush)
protocol = re.search("<Protocol>(.*)</Protocol>", resp.text).group(1)
protocol = plistlib.loads(protocol.encode("utf-8"))

# Certificate path
cert_pem = protocol["device-activation"]["activation-record"]["DeviceCertificate"]
```

The **DeviceCertificate** is **PEM-encoded** (X.509 certificate chain).

---

## 6. Certificate Lifetime and Renewal

- **Public documentation** does not specify exact Albert device certificate lifetime. General CA standards limit new certs to **398 days** (post Sept 2020).
- Devices typically renew certificates when re-activating or when the OS detects expiration.
- No explicit renewal endpoint documented; activation is typically re-run.

---

## 7. beeper/mac-registration-provider: NAC/Validation Data Generation

### Repository

- **URL:** https://github.com/beeper/mac-registration-provider
- **Purpose:** Generates iMessage registration data on macOS for use with Beeper Mini.

### How It Works

The tool does **not** use Albert directly. It uses a different flow:

1. **Fetch validation cert:** `http://static.ess.apple.com/identity/validation/cert-1.0.plist`
2. **NAC Init:** Calls `identityservicesd` binary via `dlopen`/`dlsym` to invoke:
   - `NACInit` – takes cert, returns `validationCtx` and `request`
   - `InitializeValidation` – POST to `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/initializeValidation` with `session-info-request`
   - `NACKeyEstablishment` – processes `session-info` response
   - `NACSign` – produces `validationData`
3. **Validation data** is used for iMessage registration.

### Key Code Paths

**nac/nac.go:**
- Loads `identityservicesd` from `/System/Library/PrivateFrameworks/IDS.framework/identityservicesd.app/Contents/MacOS/identityservicesd`
- Uses **version-specific offsets** (SHA256 hash of binary) to find `NACInit`, `NACKeyEstablishment`, `NACSign` addresses
- Calls these via C bridge (`nacInitProxy`, `nacKeyEstablishmentProxy`, `nacSignProxy`)

**requests/requests.go:**
- `FetchCert`: GET `cert-1.0.plist`, returns `cert` bytes
- `InitializeValidation`: POST plist with `session-info-request` to Apple, returns `session-info`

### Validation Data Validity

- **ValidityTime:** 15 minutes (`generate.go`)

---

## 8. Supported macOS Versions (mac-registration-provider)

| Architecture | Supported Versions |
|--------------|-------------------|
| **Intel** | 10.14.6, 10.15.1–10.15.7, 11.5–11.7, 12.7.1, 13.3.1, 13.5–13.6.4, 14.0–14.3 |
| **Apple Silicon** | 12.7.1, 13.3.1, 13.5–13.6.4, 14.0–14.3 |

### Why Version-Specific

The tool uses **hardcoded offsets** into `identityservicesd` binary. Each macOS version has a different binary hash and internal layout. The offsets are stored in `nac/offsets.go` and keyed by SHA256 of the binary. Unsupported versions = no offsets = `NoOffsetsError`.

---

## 9. Activation Data Reuse Across Machines

- **Beeper's testing:** 10–20 iMessage users could share the same registration data.
- **Apple's response:** Apple detects reuse and **bans the registration**, which also blocks the **original Mac** that generated it.
- **Conclusion:** Reuse is possible but risky; Apple actively bans shared registrations.

---

## 10. Source URLs (Topic A)

| Source | URL |
|--------|-----|
| Albert | https://theapplewiki.com/wiki/Albert |
| mac-registration-provider | https://github.com/beeper/mac-registration-provider |
| pypush albert.py | https://github.com/JJTech0130/pypush/blob/main/pypush/apns/albert.py |
| FairPlayKeyData | https://stackoverflow.com/questions/23434692/fairplaykeydata-apple-activation |

---

# TOPIC B: APNs Binary Protocol

## 1. Overview

APNs uses a binary protocol over TLS for device-to-server communication. Apple devices connect to push servers to receive notifications (push, iMessage, etc.).

**Source:** [The Apple Wiki - APNs](https://theapplewiki.com/wiki/Apple_Push_Notification_Service)

---

## 2. Connection Establishment

- **Port:** 5223 (TCP/TLS), fallback to 443
- **Host:** `{N}-courier.push.apple.com` (production) or `{N}-courier.sandbox.push.apple.com` (sandbox)
- **N:** Random 1–50 (production), 1–10 (sandbox)
- **ALPN:** `apns-security-v3` (negotiated during TLS handshake)
- **Certificate:** Device certificate from Albert (or equivalent activation)

---

## 3. apns-security-v3

- **Purpose:** Replaces older TCP client certificate fingerprinting with a challenge-response mechanism.
- **ALPN:** Must negotiate `apns-security-v3` during TLS handshake.
- **Auth:** Device signs a nonce with its private key; APNs verifies using the device certificate.

---

## 4. Message Structure (TLV)

Each message:

| Part | Size | Description |
|------|------|-------------|
| Command ID | 1 byte | Message type (0x07–0x1D) |
| Payload length | 4 bytes | Big-endian |
| Fields | variable | TLV items |

Each field:

| Part | Size | Description |
|------|------|-------------|
| Field type | 1 byte | Field ID |
| Field length | 2 bytes | Big-endian |
| Field value | variable | Raw bytes |

**Code (pypush transport.py):**

```python
def _serialize_field(self, field: Packet.Field) -> bytes:
    return (
        field.id.to_bytes(1, "big")
        + len(field.value).to_bytes(2, "big")
        + field.value
    )
```

---

## 5. Command Reference

| Cmd | Hex | Name | Direction | Description |
|-----|-----|------|-----------|-------------|
| 7 | 0x07 | Connect | Device→Server | Initial connection |
| 8 | 0x08 | Connect Response | Server→Device | Response to Connect |
| 9 | 0x09 | Filter Topics | Device→Server | Subscribe/unsubscribe topics |
| 10 | 0x0A | Message | Both | Push notification / iMessage |
| 11 | 0x0B | Ack | Both | Acknowledge message |
| 12 | 0x0C | Keep-Alive | Device→Server | Connection maintenance |
| 13 | 0x0D | Keep-Alive Response | Server→Device | Response to keep-alive |
| 14 | 0x0E | NoStorage | Server→Device | Storage unavailable |
| 15 | 0x0F | Flush | Both | Cache flush |
| 16 | 0x10 | Flush Response | Server→Device | Response to Flush |
| 17 | 0x11 | App Token (ScopedToken) | Device→Server | Request scoped token |
| 18 | 0x12 | App Token Response | Server→Device | Scoped token response |
| 20 | 0x14 | SetState | Device→Server | Set active state |

---

## 6. Connect Command (0x07) Fields

| Field ID | Name | Type | Description |
|----------|------|------|-------------|
| 0x01 | token | bytes | 32-byte push token (optional) |
| 0x02 | state | int | State |
| 0x05 | flags | 4 bytes | Bitfield |
| 0x06 | interface | uint8 | 0=cellular, 1=WiFi |
| 0x07 | active_interval | - | - |
| 0x08 | carrier | string | "WiFi" or carrier code |
| 0x09 | software_version | string | OS version |
| 0x0A | software_build | string | OS build |
| 0x0B | hardware_version | string | Device model |
| 0x0C | certificate | bytes | X.509 device cert (DER) |
| 0x0D | nonce | bytes | 17 bytes |
| 0x0E | signature | bytes | RSA signature |
| 0x10 | version | uint16 | Protocol version |
| 0x11 | redirect_count | uint16 | - |
| 0x13 | dns_time | - | DNS resolve time |
| 0x14 | tls_time | - | TLS handshake time |

---

## 7. Nonce Format

```
nonce = 0x00 (1 byte) + timestamp_ms (8 bytes, big-endian) + random (8 bytes)
```

**Code (pypush lifecycle.py):**

```python
nonce = (
    b"\x00"
    + int(time.time() * 1000).to_bytes(8, "big")
    + random.randbytes(8)
)
```

Total: **17 bytes**.

---

## 8. Signature Format

```
signature = 0x01 0x01 (2 bytes) + RSASSA-PKCS1-SHA1(nonce)
```

**Code (pypush lifecycle.py):**

```python
signature = b"\x01\x01" + self.private_key.sign(
    nonce, padding.PKCS1v15(), hashes.SHA1()
)
```

---

## 9. Topic Subscription (SHA1 Hashes)

- Topics are identified by **SHA1 hash** of the topic name string.
- Hash length: **20 bytes**.
- Filter command (0x09) uses field IDs: `0x02` (enabled), `0x03` (ignored), `0x04` (opportunistic), `0x05` (paused).

**Topic hash computation:**

```python
topic_hash = hashlib.sha1(b"com.apple.madrid").digest()
```

---

## 10. Exact SHA1 Hash for com.apple.madrid

```
e4e6d952954168d0a5db02dbaf27cc35fc18d159
```

(20 bytes: 0xe4e6d952954168d0a5db02dbaf27cc35fc18d159)

---

## 11. Keep-Alive Intervals

- **Pushproxy doc:** Keep-alive sent every **15–20 minutes**.
- **pypush:** Sends keep-alive every **30 seconds** (`lifecycle.py`).
- **Timeout:** No explicit timeout documented; connection drops if no keep-alive response.

---

## 12. apns-pack-v1

- **Introduced:** iOS 10
- **ALPN:** `apns-pack-v1`
- **Purpose:** Byte-efficient packed encoding; same command IDs, different binary format.
- **Support:** Older protocol still supported; apns-dissector does not yet support apns-pack-v1.

---

## 13. Message (0x0A) Fields

| Field ID | Name | Type | Description |
|----------|------|------|-------------|
| 0x01 | topic_hash / token | varies | Outgoing: topic hash; Incoming: token |
| 0x02 | token / topic_hash | varies | Outgoing: token; Incoming: topic hash |
| 0x03 | payload | bytes | JSON (app) or binary plist (iMessage) |
| 0x04 | message_id | uint32 | Unique ID |
| 0x05 | expiry | timestamp | Expiration |
| 0x06 | timestamp | uint64 | Nanoseconds since Unix epoch |
| 0x09 | storage_flags | uint8 | - |
| 0x0D | priority | uint8 | - |
| 0x0F | base_token | bytes | - |
| 0x15 | tracing_uuid | - | - |
| 0x18 | correlation_id | string | - |
| 0x19 | lastRTT | uint16 | - |
| 0x1A | apn_flags | uint32 | - |
| 0x1C | push_type | uint16 | - |

---

## 14. Source URLs (Topic B)

| Source | URL |
|--------|-----|
| APNs Wiki | https://theapplewiki.com/wiki/Apple_Push_Notification_Service |
| Apple Push Service Protocol | https://www.theiphonewiki.com/wiki/Apple_Push_Service_Protocol |
| pushproxy protocol doc | https://github.com/mfrister/pushproxy/blob/master/doc/apple-push-protocol-ios5-lion.md |
| apns-dissector | https://gitlab.com/nicolas17/apns-dissector |
| apns-command-info.yml | https://gitlab.com/nicolas17/apns-dissector/-/blob/master/apns-command-info.yml |
| pypush | https://github.com/JJTech0130/pypush |
| pypush apns protocol | https://github.com/JJTech0130/pypush/blob/main/pypush/apns/protocol.py |
| pypush apns transport | https://github.com/JJTech0130/pypush/blob/main/pypush/apns/transport.py |
| pypush apns lifecycle | https://github.com/JJTech0130/pypush/blob/main/pypush/apns/lifecycle.py |

---

# Appendix: Code Examples

## Albert Activation (Python)

```python
# From pypush/apns/albert.py
private_key = rsa.generate_private_key(
    public_exponent=65537, key_size=1024, backend=default_backend()
)
csr = _generate_csr(private_key)

activation_info = plistlib.dumps({
    "ActivationRandomness": str(uuid.uuid4()),
    "ActivationState": "Unactivated",
    "BuildVersion": build,
    "DeviceCertRequest": csr.encode("utf-8"),
    "DeviceClass": device_class,
    "ProductType": model,
    "ProductVersion": version,
    "SerialNumber": serial,
    "UniqueDeviceID": udid,
})

signature = fairplay_key.sign(activation_info, padding.PKCS1v15(), hashes.SHA1())

resp = await http_client.post(
    f"https://albert.apple.com/deviceservices/deviceActivation?device={device_class}",
    data={
        "activation-info": plistlib.dumps({
            "ActivationInfoComplete": True,
            "ActivationInfoXML": activation_info,
            "FairPlayCertChain": FAIRPLAY_CERT_CHAIN,
            "FairPlaySignature": signature,
        }).decode()
    },
)
```

## APNs Connect (Python)

```python
# From pypush/apns/lifecycle.py
nonce = b"\x00" + int(time.time() * 1000).to_bytes(8, "big") + random.randbytes(8)
signature = b"\x01\x01" + private_key.sign(nonce, padding.PKCS1v15(), hashes.SHA1())

await conn.send(protocol.ConnectCommand(
    push_token=token,
    state=1,
    flags=65,
    certificate=cert_der,
    nonce=nonce,
    signature=signature,
))
```

## Topic Hash (Python)

```python
import hashlib
topic_hash = hashlib.sha1(b"com.apple.madrid").digest()
# hex: e4e6d952954168d0a5db02dbaf27cc35fc18d159
```

---

*End of Research Document*
