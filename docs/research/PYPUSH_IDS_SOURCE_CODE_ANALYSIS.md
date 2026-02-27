# pypush IDS Source Code Analysis

Comprehensive extraction of IDS (Identity Services) implementation from the pypush project.  
**Source commit:** `e2102d006e4fc558d48e66d3cbf10220e497f26e` (pre-rewrite, when IDS was present).  
**Note:** The current pypush `main` branch has removed IDS; the `ids/` directory contains only `.gitkeep`.

---

## 1. Python Files in pypush (at old commit)

```
albert.py
apns.py
bags.py
demo.py
development/demo.py
development/printer.py
development/proxy/hosts.py
development/proxy/proxy.py
development/test.py
emulated/jelly.py
emulated/mparser.py
emulated/nac.py
generatenac.py
ids/__init__.py
ids/_helpers.py
ids/identity.py
ids/profile.py
ids/query.py
ids/signing.py
imessage.py
```

---

## 2. IDS Authentication Flow

### 2.1 Auth Token (profile.py)

**Endpoint:** `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateUser`

```python
def _auth_token_request(username: str, password: str) -> any:
    data = {
        "username": username,
        "password": password,
    }
    data = plistlib.dumps(data)

    r = requests.post(
        "https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateUser",
        data=data,
        verify=False,
    )
    r = plistlib.loads(r.content)
    return r
```

**2FA handling:** If `status == 5000`, append 2FA code to password and retry.

**Returns:** `(realm_user_id, auth_token)` from `profile-id` and `auth-token` in response.

### 2.2 Get Handles (profile.py)

**Bag key:** `id-get-handles`

```python
def get_handles(push_token, user_id: str, auth_key: KeyPair, push_key: KeyPair):
    headers = {
        "x-protocol-version": PROTOCOL_VERSION,
        "x-auth-user-id": user_id,
    }
    signing.add_auth_signature(headers, None, BAG_KEY, auth_key, push_key, push_token)
    r = requests.get(bags.ids_bag()[BAG_KEY], headers=headers, verify=False)
    r = plistlib.loads(r.content)
    return [handle["uri"] for handle in r["handles"]]
```

### 2.3 Auth Cert Exchange (profile.py)

**Bag key:** `id-authenticate-ds-id` (URL from IDS bag)

**Request body:**
```python
body = {
    "authentication-data": {"auth-token": token},
    "csr": b64decode(_generate_csr(private_key)),
    "realm-user-id": user_id,
}
```

**CSR generation:**
```python
def _generate_csr(private_key: rsa.RSAPrivateKey) -> str:
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.COMMON_NAME, random.randbytes(20).hex()),
                ]
            )
        )
        .sign(private_key, hashes.SHA256())
    )
    csr = csr.public_bytes(serialization.Encoding.PEM).decode("utf-8")
    return (
        csr.replace("-----BEGIN CERTIFICATE REQUEST-----", "")
        .replace("-----END CERTIFICATE REQUEST-----", "")
        .replace("\n", "")
    )
```

**Headers:** `x-protocol-version: 1630` (for authenticate-ds; profile uses `PROTOCOL_VERSION = "1640"` elsewhere)

**Response:** DER cert in `r["cert"]`; loaded as `x509.load_der_x509_certificate(r["cert"])`.

### 2.4 Helpers (_helpers.py)

```python
USER_AGENT = "com.apple.madrid-lookup [macOS,13.2.1,22D68,MacBookPro18,3]"
PROTOCOL_VERSION = "1640"

KeyPair = namedtuple("KeyPair", ["key", "cert"])

def dearmour(armoured: str) -> str:
    return re.sub(r"-----BEGIN .*-----|-----END .*-----", "", armoured).replace("\n", "")

def parse_key(key: str):  # PEM → PublicKey or PrivateKey
def serialize_key(key):   # Key → PEM string
```

---

## 3. IDS Registration Plist Construction

### 3.1 Full Registration Body (identity.py)

**Endpoint:** `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/register` (hardcoded; not from bag)

```python
body = {
    "hardware-version": "MacBookPro18,3",
    "language": "en-US",
    "os-version": "macOS,13.2.1,22D68",
    "software-version": "22D68",
    "services": [
        {
            "capabilities": [{"flags": 17, "name": "Messenger", "version": 1}],
            "service": "com.apple.madrid",
            "users": [
                {
                    "client-data": {
                        'is-c2k-equipment': True,
                        'optionally-receive-typing-indicators': True,
                        'public-message-identity-key': identity.encode(),
                        'public-message-identity-version': 2,
                        'show-peer-errors': True,
                        'supports-ack-v1': True,
                        'supports-activity-sharing-v1': True,
                        'supports-audio-messaging-v2': True,
                        "supports-autoloopvideo-v1": True,
                        'supports-be-v1': True,
                        'supports-ca-v1': True,
                        'supports-fsm-v1': True,
                        'supports-fsm-v2': True,
                        'supports-fsm-v3': True,
                        'supports-ii-v1': True,
                        'supports-impact-v1': True,
                        'supports-inline-attachments': True,
                        'supports-keep-receipts': True,
                        "supports-location-sharing": True,
                        'supports-media-v2': True,
                        'supports-photos-extension-v1': True,
                        'supports-st-v1': True,
                        'supports-update-attachments-v1': True,
                    },
                    "uris": uris,  # [{"uri": handle} for handle in handles]
                    "user-id": user_id,
                }
            ],
        }
    ],
    "validation-data": b64decode(validation_data),
}
```

**Headers:**
- `x-protocol-version`: PROTOCOL_VERSION ("1640")
- `x-auth-user-id-0`: user_id
- Auth signature via `add_auth_signature(headers, body, "id-register", auth_key, push_key, push_token, 0)`

**Status codes:** `6004` = "Validation data expired!"

---

## 4. validation-data (Unicorn Emulation)

### 4.1 Flow (emulated/nac.py)

1. **Load binary:** `IMDAppleServices` from `https://github.com/JJTech0130/nacserver/raw/main/IMDAppleServices`
2. **Get cert:** `http://static.ess.apple.com/identity/validation/cert-1.0.plist` → `resp["cert"]`
3. **nac_init(j, cert):** Call `0xB1DB0` with cert → returns `(validation_ctx, request_bytes)`
4. **get_session_info(request):** POST to `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/initializeValidation` with `session-info-request`
5. **nac_key_establishment(j, validation_ctx, session_info):** Call `0xB1DD0`
6. **nac_sign(j, validation_ctx):** Call `0xB1DF0` → returns `validation_data` bytes

### 4.2 Key Functions

```python
def get_cert():
    resp = requests.get("http://static.ess.apple.com/identity/validation/cert-1.0.plist")
    resp = plistlib.loads(resp.content)
    return resp["cert"]

def get_session_info(req: bytes) -> bytes:
    body = {'session-info-request': req}
    body = plistlib.dumps(body)
    resp = requests.post(
        "https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/initializeValidation",
        data=body, verify=False
    )
    resp = plistlib.loads(resp.content)
    return resp["session-info"]
```

### 4.3 Unicorn/Jelly Setup

- Uses `unicorn` (UC_ARCH_X86, UC_MODE_64)
- Loads x64 slice of `IMDAppleServices` via `mparser` (macholibre)
- Hooks: `malloc`, `memcpy`, `IORegistryEntryCreateCFProperty`, `CFDictionaryGetValue`, `DADiskCopyDescription`, etc.
- Fake IOKit/CF data from `emulated/data.plist`

---

## 5. Request Signing Implementation

### 5.1 Nonce Format (signing.py)

```python
def generate_nonce() -> bytes:
    return (
        b"\x01"                                    # version (0x01 = HTTP)
        + int(datetime.now().timestamp() * 1000).to_bytes(8, "big")
        + random.randbytes(8)
    )
```

**Format:** `[01][8-byte timestamp ms BE][8 random bytes]`

### 5.2 Payload Construction

```python
def _create_payload(
    bag_key: str,
    query_string: str,
    push_token: typing.Union[str, bytes],
    payload: bytes,
    nonce: typing.Union[bytes, None] = None,
) -> tuple[bytes, bytes]:
    if nonce is None:
        nonce = generate_nonce()

    push_token = b64decode(push_token)
    if payload is None:
        payload = b""

    return (
        nonce
        + len(bag_key).to_bytes(4, "big")
        + bag_key.encode()
        + len(query_string).to_bytes(4, "big")
        + query_string.encode()
        + len(payload).to_bytes(4, "big")
        + payload
        + len(push_token).to_bytes(4, "big")
        + push_token,
        nonce,
    )
```

**Order:** nonce | len(bag_key) | bag_key | len(query_string) | query_string | len(payload) | payload | len(push_token) | push_token

### 5.3 Signature

```python
def _sign_payload(...) -> tuple[str, bytes]:
    key = serialization.load_pem_private_key(private_key.encode(), password=None, backend=default_backend())
    payload, nonce = _create_payload(bag_key, query_string, push_token, payload, nonce)
    sig = key.sign(payload, padding.PKCS1v15(), hashes.SHA1())
    sig = b"\x01\x01" + sig
    sig = b64encode(sig).decode()
    return sig, nonce
```

**Algorithm:** RSA PKCS#1 v1.5 SHA1. **Prefix:** `\x01\x01` before raw signature.

### 5.4 Auth Headers (add_auth_signature)

```python
headers["x-push-sig"] = push_sig
headers["x-push-nonce"] = b64encode(push_nonce)
headers["x-push-cert"] = dearmour(push_key.cert)
headers["x-push-token"] = push_token

headers["x-auth-sig" + auth_postfix] = auth_sig      # auth_postfix = "-0" for id-register
headers["x-auth-nonce" + auth_postfix] = b64encode(auth_nonce)
headers["x-auth-cert" + auth_postfix] = dearmour(auth_key.cert)
```

### 5.5 ID Headers (add_id_signature, for id-query)

```python
headers["x-id-sig"] = id_sig
headers["x-id-nonce"] = b64encode(id_nonce).decode()
headers["x-id-cert"] = dearmour(id_key.cert)
headers["x-push-token"] = push_token
```

---

## 6. Key Lookup (id-query) Implementation

### 6.1 HTTP-over-APNs (query.py)

**Bag key:** `id-query`

**Flow:**
1. `conn.filter([topic])` — filter APNs to topic
2. Body: `plistlib.dumps({"uris": query})` then `gzip.compress(body, mtime=0)`
3. Headers: `x-id-self-uri`, `x-protocol-version`, plus `add_id_signature(...)`
4. Request plist:

```python
req = {
    "cT": "application/x-apple-plist",
    "U": msg_id,           # random 16 bytes
    "c": 96,
    "u": bags.ids_bag()[BAG_KEY],   # URL from bag
    "h": headers,
    "v": 2,
    "b": body,
}
conn.send_message(topic, plistlib.dumps(req, fmt=plistlib.FMT_BINARY))
```

5. **Response:** Wait for APNs message with `payload[0] == 0x0A`, `resp_body["U"] == msg_id`
6. Decompress: `gzip.decompress(resp["b"])` then `plistlib.loads(...)`
7. Check `resp['status'] != 0` and `'results' in resp`

---

## 7. Session Token Handling

- **Lookup response** contains `identities`; each identity has `push-token` and `session-token`
- **imessage.py** caches: `KEY_CACHE[push_token] = (public_key, session_token)`
- **Send payload** includes `sT` (sessionToken) per recipient:

```python
bundled_payloads.append({
    "tP": participant,
    "D": not participant == message.sender,
    "sT": self.KEY_CACHE[push_token][1],   # session token
    "P": payload,
    "t": push_token,
})
```

---

## 8. HTTP-over-APNs in Code

### 8.1 APNs Connection (apns.py)

- **Host:** `{1..N}-{APNSCourierHostname}` from `bags.apns_init_bag()`
- **Port:** 5223
- **ALPN:** `apns-security-v2`
- **TLS:** Client cert from Albert (push cert)

### 8.2 Message Types

| Type | Hex | Purpose |
|------|-----|---------|
| 7 | Connect | With/without token |
| 8 | Connect response | Returns token |
| 9 | Filter | Subscribe to topics (SHA1 of topic) |
| 0x0A | Notification | Incoming message |
| 0x0B | ACK | Send ACK |
| 0x0C | Keep-alive | Ping |
| 0x0D | Keep-alive response | Pong |
| 0x14 | Set state | State + TTL |

### 8.3 Send Message (type 0x0A)

```python
payload = _serialize_payload(
    0x0A,
    [
        (4, id),
        (1, sha1(topic.encode()).digest()),
        (2, self.token),
        (3, payload),
    ],
)
```

### 8.4 Field Format

- 1 byte: field ID
- 2 bytes: length (BE)
- N bytes: value

---

## 9. Bag Endpoint Fetch and URL Resolution

### 9.1 IDS Bag (bags.py)

```python
def ids_bag():
    r = requests.get(
        "https://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=3",
        verify=False
    )
    content = plistlib.loads(r.content)
    bag = plistlib.loads(content["bag"])
    return bag
```

### 9.2 APNs Bag

```python
# New style (signed)
r = requests.get("http://init-p01st.push.apple.com/bag", verify=False)
content = plistlib.loads(r.content)
bag = plistlib.loads(content["bag"])
```

### 9.3 Bag Keys Used

| Key | Purpose |
|-----|---------|
| `id-authenticate-ds-id` | Auth cert exchange |
| `id-get-handles` | Get user handles |
| `id-query` | Key lookup (HTTP-over-APNs URL) |
| `id-register` | (identity.py uses hardcoded URL, not bag) |

---

## 10. Identity Key Format Parsing (ASN.1 with EC + RSA)

### 10.1 Decode (identity.py)

```python
def decode(input: bytes) -> 'IDSIdentity':
    input = BytesIO(input)

    assert input.read(5) == b'\x30\x81\xF6\x81\x43'   # DER header
    raw_ecdsa = input.read(67)
    assert input.read(3) == b'\x82\x81\xAE'          # DER header
    raw_rsa = input.read(174)

    # Parse RSA
    raw_rsa = BytesIO(raw_rsa)
    assert raw_rsa.read(2) == b'\x00\xAC'
    assert raw_rsa.read(3) == b'\x30\x81\xA9'
    assert raw_rsa.read(3) == b'\x02\x81\xA1'
    rsa_modulus = raw_rsa.read(161)
    rsa_modulus = int.from_bytes(rsa_modulus, "big")
    assert raw_rsa.read(5) == b'\x02\x03\x01\x00\x01'   # exponent 65537

    # Parse EC (uncompressed point)
    assert raw_ecdsa[:3] == b'\x00\x41\x04'
    raw_ecdsa = raw_ecdsa[3:]
    ec_x = int.from_bytes(raw_ecdsa[:32], "big")
    ec_y = int.from_bytes(raw_ecdsa[32:], "big")
    ec_key = ec.EllipticCurvePublicNumbers(ec_x, ec_y, ec.SECP256R1()).public_key()
    rsa_key = rsa.RSAPublicNumbers(e=65537, n=rsa_modulus).public_key()

    return IDSIdentity(signing_public_key=..., encryption_public_key=...)
```

### 10.2 Encode (identity.py)

```python
def encode(self) -> bytes:
    output = BytesIO()
    raw_rsa = BytesIO()
    raw_rsa.write(b'\x00\xAC')
    raw_rsa.write(b'\x30\x81\xA9')
    raw_rsa.write(b'\x02\x81\xA1')
    raw_rsa.write(parse_key(self.encryption_public_key).public_numbers().n.to_bytes(161, "big"))
    raw_rsa.write(b'\x02\x03\x01\x00\x01')

    output.write(b'\x30\x81\xF6\x81\x43')
    output.write(b'\x00\x41\x04')
    output.write(parse_key(self.signing_public_key).public_numbers().x.to_bytes(32, "big"))
    output.write(parse_key(self.signing_public_key).public_numbers().y.to_bytes(32, "big"))
    output.write(b'\x82\x81\xAE')
    output.write(raw_rsa.getvalue())
    return output.getvalue()
```

**Structure:**
- EC: SECP256R1 uncompressed (0x04 || x || y), 32+32 bytes
- RSA: 1280-bit (161-byte modulus), exponent 65537

### 10.3 IDSIdentity Key Generation

```python
# Signing: EC SECP256R1
self.signing_key = serialize_key(ec.generate_private_key(ec.SECP256R1()))

# Encryption: RSA 1280-bit
self.encryption_key = serialize_key(rsa.generate_private_key(65537, 1280))
```

---

## 11. Demo Flow (demo.py)

1. Load `config.json` (push key/cert/token, auth cert, id cert, encryption keys)
2. Connect APNs, set state 1, filter `com.apple.madrid`
3. Create `IDSUser`, restore or authenticate
4. Set `encryption_identity` (EC + RSA keys)
5. Restore id_keypair or register with `emulated.nac.generate_validation_data()`
6. Save config
7. Create `iMessageUser`, loop receive/send

---

## 12. mautrix imessage

**Finding:** mautrix/imessage is a Matrix bridge that uses **native macOS iMessage** (via `imessage` CLI or similar). It does **not** implement IDS in Go. The bridge runs on a Mac and delegates to the system. No IDS registration or key lookup code exists in the Go codebase.

---

## 13. Raw File URLs (for reference)

```
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/ids/__init__.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/ids/query.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/ids/profile.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/ids/identity.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/ids/signing.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/ids/_helpers.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/apns.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/imessage.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/bags.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/demo.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/emulated/nac.py
https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/albert.py
```

---

*Analysis completed Feb 2026. For protocol implementation reference only.*
