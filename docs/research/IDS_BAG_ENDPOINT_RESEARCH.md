# Apple IDS "Bag" Endpoint Research

Research on the Apple Identity Services (IDS) bag endpoint that returns all service URLs for Apple Identity Services. Conducted Feb 2026.

---

## 1. Bag Endpoint URL Format

### 1.1 Primary Endpoint

```
https://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=<id>
```

Also documented as HTTP (Apple may redirect or accept both):

```
http://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=<id>
```

### 1.2 ix Parameter Variations

| ix Value | Service / Purpose | Source |
|----------|------------------|--------|
| **1** | General IDS bag (FaceTime/iMessage) | kahunalu/apple_bag ix_1 |
| **2** | (Documented in apple_bag repo) | kahunalu/apple_bag |
| **3** | IDS bag used by pypush | pypush bags.py |
| **4** | FaceTime bag (gossgirl69 plist, apple_bag README) | gossgirl69 gist, kahunalu README |
| **5** | (Documented in apple_bag repo) | kahunalu/apple_bag |

**Note:** ix values 1–5 are documented in the [kahunalu/apple_bag](https://github.com/kahunalu/apple_bag) repository structure. Different ix values return different bag configurations (e.g., different subdomains for invitation services: `profile.ess.apple.com` vs `invitation.ess.apple.com`).

### 1.3 Domain Info

- **init.ess.apple.com**: CNAME to `init.ess.g.aaplimg.com`
- **IPs**: 17.253.21.131, 17.253.119.202, 17.253.21.145, 17.253.119.201
- **Parent domain**: ess.apple.com

**Sources:**
- [init.ess.apple.com - nodedata.io](https://nodedata.io/init.ess.apple.com)
- [kahunalu/apple_bag - GitHub](https://github.com/kahunalu/apple_bag)

---

## 2. Bag Response Format

### 2.1 Structure (Signed Plist)

The live getBag response (from Apple) returns a **signed plist** with:

| Key | Type | Description |
|-----|------|-------------|
| `bag` | `<data>` | Binary plist containing the actual bag content (nested plist) |
| `certs` | `<array>` | Array of DER-encoded X.509 certificates (Apple Server Auth CA chain) |
| `signature` | `<data>` | RSA-SHA1 signature over the bag content |

The `bag` data value is itself a plist (XML or binary) containing key-value pairs of service URLs and configuration.

### 2.2 Cached Bag Format (gossgirl69)

When macOS caches the bag (e.g., in `com.apple.facetime.bag`), it stores:

| Key | Type | Description |
|-----|------|-------------|
| `URL` | string | The getBag URL that was fetched |
| `CachedBag` | dict | The bag content (key-value pairs) |
| `CacheTime` | integer | Cache duration or age |
| `Date` | real | Timestamp when cached |

### 2.3 Bag Content Keys (Full List)

From gossgirl69 FaceTime bag (ix=4) and kahunalu ix_1 bag:

#### Authentication

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `id-authenticate-ds-id` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateDS` | Apple ID authentication |
| `id-authenticate-phone-number` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/authenticatePhoneNumber` | Phone number authentication |
| `id-authenticate-icloud` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateICloud` | iCloud authentication |
| `id-authenticate-multiple-users` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/authenticateUsers` | Multi-user auth (ix_1) |
| `vc-profile-authenticate` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateUser` | Profile authentication |

#### Registration

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `id-register` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/register` | Device registration (ix_1) |
| `id-register` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/register` | (gossgirl69: TDIdentityService) |
| `id-deregister` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/deregister` | Device deregistration |
| `id-provision-ds-id` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateDS` | Provision Apple ID |
| `id-provision-phone-number` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/authenticatePhoneNumber` | Provision phone number |
| `vc-register` | `https://registration.ess.apple.com/WebObjects/VCRegistrationService.woa/wa/register` | VC registration |
| `vc-deregister` | `https://registration.ess.apple.com/WebObjects/VCRegistrationService.woa/wa/deregister` | VC deregistration |

#### Lookup / Query

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `id-query` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/query` | General identity query |
| `id-query-by-service` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/queryByService` | Key lookup by service (e.g. com.apple.madrid) |
| `id-check-unknown` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/checkUnknown` | Check unknown handles (ix_1) |
| `id-get-service-user-id` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/getServiceUserId` | Get service user ID |
| `id-canonicalize` | `https://query.ess.apple.com/WebObjects/TDIdentityService.woa/wa/canonicalize` | Canonicalize handle (gossgirl69) |
| `id-canonicalize` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/canonicalize` | (ix_1) |

#### Handle Retrieval

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `id-get-handles` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/idsGetHandles` | Get user handles (emails, phone numbers) |
| `vc-profile-get-handles` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/getHandles` | Get handles (profile service) |
| `vc-profile-get-emails` | `https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/getEmails` | Get emails |

#### Tokens and Validation

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `id-get-pairing-token` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/getPairingToken` | Pairing token |
| `id-get-admin-token` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/getAdminToken` | Admin token |
| `id-get-consent-token` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/getConsentToken` | Consent token |
| `id-get-user-token` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/getUserToken` | User token |
| `id-initialize-validation` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/initializeValidation` | Initialize validation |
| `id-validation-cert` | `http://static.ess.apple.com/identity/validation/cert-1.0.plist` | Validation certificate |
| `id-validate-credentials` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/validateCredentials` | Validate credentials (ix_1) |

#### Other IDS Endpoints

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `id-report-spam` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/reportSpam` | Report spam |
| `id-report-unknown` | `https://query.ess.apple.com/WebObjects/QueryService.woa/wa/reportUnknown` | Report unknown (ix_1) |
| `id-recover-signature` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/recoverSignature` | Recover signature |
| `id-get-dependent-registrations` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/getDependentRegistrations` | Get dependent registrations |
| `id-preflight` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/preflight` | Preflight (ix_1) |
| `id-get-esat` | `https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/getEsimAuthToken` | eSIM auth token (ix_1) |

#### FaceTime / VC Profile / Invitation

| Bag Key | URL | Purpose |
|---------|-----|---------|
| `gk-invitation-initiate` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/initiate` | Initiate invitation |
| `gk-invitation-accept` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/accept` | Accept invitation |
| `gk-invitation-reject` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/reject` | Reject invitation |
| `gk-invitation-cancel` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/cancel` | Cancel invitation |
| `gk-invitation-send` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/send` | Send invitation |
| `gk-invitation-relay-initiate` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/relayInitiate` | Relay initiate |
| `gk-invitation-relay-update` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/relayUpdate` | Relay update |
| `gk-invitation-relay-cancel` | `https://profile.ess.apple.com/.../VCInvitationService.woa/wa/relayCancel` | Relay cancel |
| `vc-profile-link-handle` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/linkHandle` | Link handle |
| `vc-profile-unlink-handle` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/unlinkHandle` | Unlink handle |
| `vc-profile-provision` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/provisionEmails` | Provision emails |
| `vc-profile-validate-handle` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/validateHandle` | Validate handle |
| `vc-profile-validate-email` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/validateHandle` | Validate email |
| `vc-profile-get-region-metadata` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/regionMetadata` | Region metadata |
| `vc-profile-get-default-invitation-context` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/getDefaultInvitationContext` | Default invitation context |
| `vc-profile-validate-invitation-context` | `https://profile.ess.apple.com/.../VCProfileService.woa/wa/validateInvitationContext` | Validate invitation context |

#### Communication / NAT (gk-*)

| Bag Key | Example Value | Purpose |
|---------|---------------|---------|
| `gk-commnat-main0` | `17.173.255.222:16384` or `17.178.104.99:16384` | Main comm NAT 0 |
| `gk-commnat-main1` | `17.173.255.222:16385` or `17.178.104.99:16385` | Main comm NAT 1 |
| `gk-commnat-cohort` | `17.173.255.223:16386` or `17.178.104.100:16386` | Comm NAT cohort |
| `gk-commnat-main0-name` | `commnat-main.ess.apple.com:16384` | Hostname for main0 |
| `gk-commnat-main1-name` | `commnat-main.ess.apple.com:16385` | Hostname for main1 |
| `gk-commnat-cohort-name` | `commnat-cohort.ess.apple.com:16386` | Hostname for cohort |
| `gk-cdx` | `17.155.5.232:4398` | CDX server |
| `gk-cdx-name` | `cdx.ess.apple.com:4398` | CDX hostname |

#### Configuration (Non-URL)

| Bag Key | Example | Purpose |
|---------|---------|---------|
| `bag-expiry-timestamp` | `-1447017314` | Bag expiry (Unix timestamp; negative may indicate past/relative) |
| `vc-build-version` | `15D95` or `1902B-35` | Build version |
| `vc-build-revision` | `undefined` | Build revision |
| `vc-registration-hbi` | `2657253` or `2816548` | Registration HBI |
| `max-uri-multi-query` | `35` | Max URIs per multi-query |
| `max-spam-message-size` | `1024` | Max spam message size |
| `max-spam-messages-per-report` | `2` or `30` | Max spam messages per report |
| `phone-registration-retry-interval-seconds` | `86400` | Retry interval for phone registration |
| `do-http-pipelining` | `true` | HTTP pipelining |
| `do-http-keep-alive` | `true` | HTTP keep-alive |
| `http-keep-alive-idle-timeout-cell-millis` | `30000` | Keep-alive timeout (cell) |
| `http-keep-alive-idle-timeout-wifi-millis` | `30000` | Keep-alive timeout (WiFi) |
| `max-concurrent-connections` | `4` | Max concurrent connections |

---

## 3. Key Usage by Operation

| Operation | Bag Key(s) |
|-----------|------------|
| **Authentication** | `id-authenticate-ds-id`, `id-authenticate-phone-number`, `id-authenticate-icloud` |
| **Registration** | `id-register`, `id-provision-ds-id`, `id-provision-phone-number` |
| **Lookup** | `id-query`, `id-query-by-service` |
| **Handle retrieval** | `id-get-handles`, `vc-profile-get-handles` |

---

## 4. Bag Fetch in pypush and Beeper

### 4.1 pypush (bags.py)

```python
def ids_bag():
    r = requests.get(
        "https://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=3",
        verify=False
    )
    content = plistlib.loads(r.content)
    bag = plistlib.loads(content["bag"])  # bag is nested plist in <data>
    return bag
```

- **URL**: `ix=3`
- **Parsing**: Response is plist; `content["bag"]` is binary data containing a nested plist; `plistlib.loads()` parses it
- **Usage**: `bags.ids_bag()[BAG_KEY]` for `id-get-handles`, `id-authenticate-ds-id`, `id-query` (HTTP-over-APNs URL)
- **Note**: pypush `identity.py` uses a hardcoded `id-register` URL, not from bag

**Source:** [PYPUSH_IDS_SOURCE_CODE_ANALYSIS.md](./PYPUSH_IDS_SOURCE_CODE_ANALYSIS.md), pypush bags.py

### 4.2 Beeper mac-registration-provider

- **Language**: Go (95.9%) + Objective-C
- **Approach**: Runs on a real Mac; uses native macOS APIs/frameworks (identityservicesd, etc.) to produce registration data
- **Bag usage**: The Mac's identityservicesd fetches the bag internally; Beeper's tool does not implement a separate bag fetch—it relies on the system daemon
- **No direct bag fetch** in the public mac-registration-provider code; the system handles it

**Source:** [beeper/mac-registration-provider](https://github.com/beeper/mac-registration-provider)

### 4.3 pushproxy bag.py (APNs, not IDS)

The [mfrister/pushproxy](https://github.com/mfrister/pushproxy) `bag.py` generates **APNs-style bags** (signed plist with `bag`, `certs`, `signature`) for a custom push proxy host. It is **not** for fetching the IDS bag from Apple—it creates bags in the same format for local serving.

---

## 5. Bag Stability Over Time

### 5.1 Evidence of Change

- **bag-expiry-timestamp**: The gossgirl69 bag contains `bag-expiry-timestamp` (-1447017314), indicating Apple expects bags to expire
- **Different ix bags**: kahunalu ix_1 vs gossgirl69 ix=4 show different subdomains (e.g., `invitation.ess.apple.com` vs `profile.ess.apple.com` for invitation services)
- **Build versions**: `vc-build-version` varies (15D95, 1902B-35) across bags
- **IP/host changes**: `gk-commnat-*` IPs differ between ix_1 (17.178.104.x) and gossgirl69 (17.173.255.x)

### 5.2 Conclusion

The bag **changes over time**:
- Apple can update URLs, IPs, and configuration
- Bags have an expiry; clients should re-fetch when expired
- Different ix values and OS versions may receive different bag content
- Core service keys (id-register, id-query, id-get-handles, id-authenticate-*) are relatively stable in structure but URLs may change

---

## 6. Direct Fetch Attempt (Feb 2026)

```
curl -sL "https://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=3"
```

- **Result**: Empty response or SSL/certificate issue (exit code 60 in test environment)
- **Possible causes**: Client cert requirement, TLS fingerprinting, User-Agent filtering, or network restrictions in cloud environment
- **Note**: The endpoint is known to work from macOS devices and has been successfully fetched in the past (gossgirl69, kahunalu)

---

## 7. Source URLs

| Source | URL |
|--------|-----|
| gossgirl69 FaceTime bag plist | https://gist.github.com/gossgirl69/904b17f940492b3f80e0 |
| kahunalu apple_bag | https://github.com/kahunalu/apple_bag |
| kahunalu ix_1 bag | https://raw.githubusercontent.com/kahunalu/apple_bag/master/ix_1/ix_1_readable.xml |
| init.ess.apple.com (nodedata) | https://nodedata.io/init.ess.apple.com |
| Identity Services (Apple Wiki) | https://theapplewiki.com/wiki/Identity_Services |
| pypush (GitHub) | https://github.com/JJTech0130/pypush |
| pypush bags.py (raw) | https://raw.githubusercontent.com/JJTech0130/pypush/e2102d006e4fc558d48e66d3cbf10220e497f26e/bags.py |
| beeper mac-registration-provider | https://github.com/beeper/mac-registration-provider |
| pushproxy bag.py | https://raw.githubusercontent.com/mfrister/pushproxy/master/setup/bag.py |
| inC3ASE bag.plist (Parsecd/Siri, not IDS) | https://gist.github.com/inC3ASE/9d7bcc761f9aad7ea64eafc3b9744240 |

---

## 8. Full Bag Content (gossgirl69, ix=4)

The complete CachedBag from [gossgirl69/com.apple.facetime.bag](https://gist.github.com/gossgirl69/904b17f940492b3f80e0):

```xml
<key>id-query-by-service</key>
<string>https://query.ess.apple.com/WebObjects/QueryService.woa/wa/queryByService</string>
<key>gk-commnat-main1-name</key>
<string>commnat-main.ess.apple.com:16385</string>
<key>vc-profile-get-handles</key>
<string>https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/getHandles</string>
<key>vc-profile-link-handle</key>
<string>https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/linkHandle</string>
<key>id-register</key>
<string>https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/register</string>
<key>id-get-consent-token</key>
<string>https://query.ess.apple.com/WebObjects/QueryService.woa/wa/getConsentToken</string>
<key>id-get-user-token</key>
<string>https://query.ess.apple.com/WebObjects/QueryService.woa/wa/getUserToken</string>
<key>vc-register</key>
<string>https://registration.ess.apple.com/WebObjects/VCRegistrationService.woa/wa/register</string>
<key>id-authenticate-ds-id</key>
<string>https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateDS</string>
<key>id-authenticate-phone-number</key>
<string>https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/authenticatePhoneNumber</string>
<key>id-get-handles</key>
<string>https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/idsGetHandles</string>
<key>id-query</key>
<string>https://query.ess.apple.com/WebObjects/QueryService.woa/wa/query</string>
<key>id-authenticate-icloud</key>
<string>https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateICloud</string>
<!-- ... plus 50+ additional keys (see Section 2.3) ... -->
<key>bag-expiry-timestamp</key>
<integer>-1447017314</integer>
```

---

*Research completed Feb 2026. Bag content and URLs may change with Apple updates.*
