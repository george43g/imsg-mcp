# iCloud Contacts Synchronization APIs and Protocols – Research

**Research Date:** February 27, 2026  
**Topic:** iCloud Contacts API, CardDAV, proprietary web services, authentication, sync mechanisms

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [CardDAV vs Proprietary API](#2-carddav-vs-proprietary-api)
3. [CardDAV Endpoint and Authentication](#3-carddav-endpoint-and-authentication)
4. [The `/co/startup` Endpoint (pyicloud)](#4-the-costartup-endpoint-pyicloud)
5. [pyicloud Contacts Module](#5-pyicloud-contacts-module)
6. [Authentication Methods](#6-authentication-methods)
7. [Real-Time Sync and Delta Updates](#7-real-time-sync-and-delta-updates)
8. [Contact Data Format](#8-contact-data-format)
9. [Reading vs Writing](#9-reading-vs-writing)
10. [Rate Limiting and Detection](#10-rate-limiting-and-detection)
11. [Known Working Approaches](#11-known-working-approaches)
12. [Source URLs Summary](#12-source-urls-summary)

---

## 1. Executive Summary

iCloud Contacts can be accessed programmatically via two main paths:

1. **CardDAV (RFC 6352)** – Standard protocol at `https://contacts.icloud.com` (or `pXX-contacts.icloud.com`). Uses vCard format, app-specific passwords, and standard WebDAV methods (PROPFIND, REPORT, GET, PUT, DELETE).

2. **Proprietary JSON API** – Used by iCloud.com and pyicloud. Endpoints like `co/startup`, `co/contacts`, `co/changeset` return JSON. Requires Apple ID web session (cookies, session tokens); app-specific passwords do **not** work with this path.

**Recommendation:** For third-party integrations, **CardDAV** with app-specific passwords is the officially supported, stable approach. The proprietary API is undocumented and may change; pyicloud provides read-only access via web session auth.

---

## 2. CardDAV vs Proprietary API

### 2.1 Does iCloud Use Standard CardDAV (RFC 6352)?

**Yes.** Apple was instrumental in CardDAV development (RFC 6352 was authored by Cyrus Daboo from Apple). iCloud implements CardDAV for contact synchronization.

| Aspect | CardDAV (iCloud) | Proprietary API |
|--------|------------------|-----------------|
| **Protocol** | RFC 6352 (CardDAV), RFC 6350 (vCard) | Custom JSON over HTTP |
| **Endpoint** | `https://pXX-contacts.icloud.com` | `https://pXX-contactsws.icloud.com` |
| **Auth** | App-specific password (Basic) | Apple ID + session cookies |
| **Data format** | vCard 3.0/4.0 | JSON |
| **Documentation** | RFCs, third-party docs | Undocumented |
| **Write support** | Yes (PUT, DELETE) | Limited/undocumented |

### 2.2 CardDAV Implementation Details

- **Contact groups:** iCloud represents groups differently than the vCard CATEGORIES property. Via CardDAV, groups are returned as separate vCards with `X-ADDRESSBOOKSERVER-KIND:group` and `X-ADDRESSBOOKSERVER-MEMBER` referencing member UIDs. Local macOS Contacts.app export uses CATEGORIES.
- **vCard quirks:** iCloud sometimes returns vCards with empty `FN` (formatted name) properties, violating RFC 6350. This can occur randomly after resync; contacts may display correctly in iCloud.com and iOS.
- **Sync tokens:** macOS Contacts has reported issues with sync-token format (UUID vs URI) when syncing with some CardDAV servers; RFC 6578 expects URI-style sync tokens.

---

## 3. CardDAV Endpoint and Authentication

### 3.1 Endpoint URL Format

```
https://pXX-contacts.icloud.com/[account-id]/carddavhome/card/
```

- **pXX:** Server number (e.g., p01, p02, p30, p45). Assigned per account for load balancing.
- **account-id:** Unique identifier for the iCloud account (often the DSID or a derived value).

**Alternative base for non-@icloud.com accounts:** `https://icloud.com`  
**China mainland:** `https://contacts.icloud.com.cn`

### 3.2 Finding Your Server and Account ID

- **Configuration.plist:** `~/Library/Application Support/Address Book/Sources/Configuration.plist` may contain a line like `xxxxxxxx/carddavhome/` — the `xxxxxxxx` is the account identifier.
- **iCloud.com:** Log in, inspect element, search for `contacts.icloud.com` in the HTML to find the full URL (e.g., `https://p45-contacts.icloud.com:443/.../wcs/`).
- **Calendar:** Contacts and calendar often share the same pXX server.

### 3.3 Authentication (App-Specific Password)

| Requirement | Details |
|-------------|---------|
| **Username** | Full Apple ID (e.g., `user@icloud.com`) |
| **Password** | **App-specific password** (not the main Apple ID password) |
| **2FA** | Account must have two-factor authentication enabled to generate app-specific passwords |

**Generate app-specific password:**
1. Sign in at [account.apple.com](https://account.apple.com)
2. Sign-In and Security → App-Specific Passwords
3. Generate a new password; use it as the CardDAV password

**Note:** Up to 25 active app-specific passwords. Changing the main Apple ID password revokes all app-specific passwords.

### 3.4 Example CardDAV Connection (curl)

```bash
# PROPFIND to discover address book
curl -X PROPFIND \
  -u "user@icloud.com:xxxx-xxxx-xxxx-xxxx" \
  "https://p02-contacts.icloud.com/123456789/carddavhome/card/" \
  -H "Depth: 1" \
  -H "Content-Type: application/xml"
```

---

## 4. The `/co/startup` Endpoint (pyicloud)

### 4.1 Endpoint Structure

The proprietary contacts API uses a base URL from the setup response (e.g., `https://p45-contactsws.icloud.com:443`). Endpoints:

| Endpoint | Purpose |
|----------|---------|
| `{base}/co/startup` | Initial handshake; returns `prefToken`, `syncToken` |
| `{base}/co/contacts` | Fetch contacts (paginated; use prefToken, syncToken) |
| `{base}/co/changeset` | Delta/changeset updates (documented in code, not fully used by pyicloud) |

### 4.2 `/co/startup` Request

**Method:** GET  
**Query parameters (from pyicloud):**

```
clientVersion=2.1
locale=en_US
order=last,first
```

Additional params (from session): `clientBuildNumber`, `clientId`, `dsid`, etc., typically passed via cookies or session context.

### 4.3 `/co/startup` Response

Returns JSON with at least:

- **prefToken** – Preference/sync token for subsequent requests
- **syncToken** – Token for incremental sync

These tokens are passed to `/co/contacts` for the next request.

### 4.4 Authentication Required

The proprietary API requires:

- **X-APPLE-WEBAUTH-TOKEN** cookie (from Apple ID web login)
- Session established via `setup.icloud.com/setup/ws/1` (`accountLogin`, `validate`)
- **App-specific passwords do NOT work** with this API; it expects a full web session

### 4.5 Service URL Discovery

The contacts service URL (e.g., `https://p45-contactsws.icloud.com:443`) is **not** hardcoded. It comes from:

1. Authenticate via `idmsa.apple.com` (signin) or use existing session token
2. POST to `https://setup.icloud.com/setup/ws/1/accountLogin` with `dsWebAuthToken`, `accountCountryCode`, `trustToken`
3. Response JSON includes `webservices.contacts.url` — use that as the base for `co/startup`, `co/contacts`, `co/changeset`

The `contactsws` subdomain (vs `contacts`) indicates the **web services** (JSON) API, as opposed to the CardDAV server at `contacts.icloud.com`.

---

## 5. pyicloud Contacts Module

### 5.1 Overview

**Repository:** [picklepete/pyicloud](https://github.com/picklepete/pyicloud)  
**Contacts service:** `pyicloud/services/contacts.py`

### 5.2 Code Structure

```python
class ContactsService:
    def __init__(self, service_root, session, params):
        self._contacts_endpoint = "%s/co" % service_root
        self._contacts_refresh_url = "%s/startup" % self._contacts_endpoint   # co/startup
        self._contacts_next_url = "%s/contacts" % self._contacts_endpoint     # co/contacts
        self._contacts_changeset_url = "%s/changeset" % self._contacts_endpoint

    def refresh_client(self):
        # 1. GET co/startup with clientVersion, locale, order
        req = self.session.get(self._contacts_refresh_url, params=params_contacts)
        self.response = req.json()

        # 2. GET co/contacts with prefToken, syncToken, limit=0, offset=0
        params_next.update({
            "prefToken": self.response["prefToken"],
            "syncToken": self.response["syncToken"],
            "limit": "0", "offset": "0",
        })
        req = self.session.get(self._contacts_next_url, params=params_next)
        self.response = req.json()

    def all(self):
        self.refresh_client()
        return self.response.get("contacts")
```

### 5.3 Data Accessible

From `api.contacts.all()`:

- **firstName**, **lastName**
- **phones** – Array of `{label, field}` (e.g., `{"label": "mobile", "field": "+1234567890"}`)
- **emails** – Similar structure
- **contactId** – Unique identifier
- Other vCard-derived fields as exposed by the JSON API

### 5.4 Limitations

- **Read-only:** pyicloud does not implement create, update, or delete. The `co/changeset` URL exists but is not used for writes.
- **Full fetch:** Each `all()` call does startup + full contacts fetch (limit=0, offset=0 returns all). No incremental sync in the public API.
- **Auth:** Requires full Apple ID + password (or keyring); 2FA must be completed (trusted device or SMS code). App-specific passwords are not supported for this flow.
- **Service URL:** Obtained from `setup.icloud.com` → `accountLogin` response → `webservices.contacts.url`.

### 5.5 Usage Example (from CODE_SAMPLES.md)

```python
from pyicloud import PyiCloudService

api = PyiCloudService("your@me.com", "password")
if api.requires_2fa:
    # Handle 2FA: trusted_devices, send_verification_code, validate_verification_code
    ...

for c in api.contacts.all():
    print(c.get("firstName"), c.get("phones"))
```

---

## 6. Authentication Methods

### 6.1 Comparison

| Method | CardDAV | Proprietary (pyicloud) |
|--------|---------|------------------------|
| **Apple ID + password** | No (use app-specific) | Yes |
| **App-specific password** | Yes | No |
| **Web session (cookies)** | No | Yes |
| **GSA / PET tokens** | No | No (different stack) |

### 6.2 Apple ID Web Session (pyicloud)

1. POST to `idmsa.apple.com` `/appleauth/auth` (signin) with Apple ID + password
2. If 2FA: validate via trusted device or SMS
3. Trust session via `/2sv/trust`
4. POST to `setup.icloud.com/setup/ws/1/accountLogin` with `dsWebAuthToken`, `accountCountryCode`, etc.
5. Response includes `webservices` with URLs for contacts, calendar, etc.
6. Cookies (`X-APPLE-WEBAUTH-TOKEN`) and session headers used for subsequent API calls

### 6.3 App-Specific Passwords

- Required for CardDAV/CalDAV third-party clients (DAVx⁵, Thunderbird, etc.)
- Generated at account.apple.com
- Used as HTTP Basic auth password with the Apple ID as username
- **Cannot** be used with `setup.icloud.com` or the proprietary contacts JSON API

### 6.4 GSA Tokens

GrandSlam (GSA) and Password Equivalent Tokens (PET) are used for IDS, iMessage, and other low-level Apple services. They are **not** used for iCloud Contacts. Contacts use either CardDAV (Basic auth) or the web session flow.

---

## 7. Real-Time Sync and Delta Updates

### 7.1 Native iCloud (Apple Devices)

- **CloudKit** and push notifications for near real-time sync across devices
- Changes propagate automatically; no explicit delta API for end users

### 7.2 CardDAV Sync

- **RFC 6578** (Collection Synchronization for WebDAV) defines sync-token-based delta sync
- **REPORT** method with sync token returns only changed items
- **Caveat:** macOS Contacts has been reported to use UUID-style sync tokens that don’t comply with RFC 6578 (which expects URI-style tokens), causing sync issues with some servers

### 7.3 Proprietary API (pyicloud)

- **syncToken** and **prefToken** from `/co/startup` enable token-based requests
- pyicloud uses `limit=0, offset=0` for a full fetch; it does not implement incremental delta sync
- The `co/changeset` endpoint exists and likely supports delta updates, but its usage is undocumented

### 7.4 CloudKit Web Services

CloudKit has `records/changes` and `zones/changes` with `syncToken` for incremental sync. These are for CloudKit databases, not the legacy iCloud Contacts service. The deprecated `users/lookup/contacts` endpoint is for contact discovery (finding users), not for syncing the user’s address book.

---

## 8. Contact Data Format

### 8.1 CardDAV: vCard

- **RFC 6350** (vCard 4.0) and vCard 3.0
- Properties: FN, N, TEL, EMAIL, ADR, ORG, NOTE, PHOTO, etc.
- iCloud uses `X-ADDRESSBOOKSERVER-KIND:group` and `X-ADDRESSBOOKSERVER-MEMBER` for groups

### 8.2 Proprietary API: JSON

Example structure (from pyicloud):

```json
{
  "contactId": "abc123",
  "firstName": "Jane",
  "lastName": "Doe",
  "phones": [
    {"label": "mobile", "field": "+1234567890"}
  ],
  "emails": [
    {"label": "home", "field": "jane@example.com"}
  ]
}
```

Fields align with vCard concepts but are flattened into JSON.

### 8.3 iCloud Limits (from Apple Support)

| Limit | Value |
|-------|-------|
| Total contact cards | 50,000 |
| Max contact card size | 256 KB |
| Max contact photo size | 224 KB |
| Max combined card text | 48 MB |
| Max combined card photos | 200 MB |

---

## 9. Reading vs Writing

### 9.1 CardDAV

| Operation | Method | Support |
|-----------|--------|---------|
| Read (list) | PROPFIND, REPORT | Yes |
| Read (single) | GET | Yes |
| Create | PUT | Yes |
| Update | PUT | Yes |
| Delete | DELETE | Yes |

Standard WebDAV semantics. Clients like DAVx⁵ and Thunderbird support full CRUD.

### 9.2 Proprietary API (pyicloud)

| Operation | Support |
|-----------|---------|
| Read (all) | Yes (`all()`) |
| Create | Not implemented |
| Update | Not implemented |
| Delete | Not implemented |

The `co/changeset` endpoint suggests server support for writes, but pyicloud does not implement it. Third-party guides (e.g., Rollout) that show `api.contacts.create()` / `update()` are describing a different or hypothetical API; stock pyicloud only has `all()`.

### 9.3 Native Apple (Contacts framework)

- **CNContactStore**, **CNMutableContact**, **CNSaveRequest** support full CRUD
- Sync with iCloud is handled by the system when iCloud Contacts is enabled

---

## 10. Rate Limiting and Detection

### 10.1 Documented Limits

Apple documents **storage limits** (contacts, photos, etc.) but not explicit **request rate limits** for the contacts API.

### 10.2 Observed Behavior

- **ACCESS_DENIED** errors have been reported, sometimes with a message suggesting throttling: *"Please wait a few minutes then try again. The remote servers might be trying to throttle requests."*
- Aggressive polling or bulk operations may trigger temporary blocks
- 2FA and session trust flows can be rate-limited (e.g., too many verification attempts)

### 10.3 Recommendations

- Use reasonable polling intervals (e.g., minutes, not seconds)
- Prefer CardDAV sync tokens for incremental sync over full fetches
- Cache contact data locally and sync periodically

---

## 11. Known Working Approaches

### 11.1 CardDAV with App-Specific Password

**Best for:** Third-party apps, cross-platform sync, long-term stability

- **DAVx⁵** (Android): Tested with iCloud; syncs contacts and calendars. Use app-specific password.
- **Thunderbird**: CardDAV support; configure with iCloud server URL and app-specific password.
- **Custom clients**: Use any CardDAV client library with `https://pXX-contacts.icloud.com`, Basic auth (Apple ID + app-specific password).

**Caveats:**
- Chinese iCloud accounts may need `contacts.icloud.com.cn` and separate account setup for contacts vs calendars
- Occasional DNS/SRV issues; re-adding the account can resolve
- Some users report HTTP 403; creating a new Apple ID has sometimes resolved it

### 11.2 pyicloud (Read-Only)

**Best for:** Quick read-only access, scripting, automation

```python
from pyicloud import PyiCloudService
api = PyiCloudService("user@icloud.com", "password")
# Handle 2FA if api.requires_2fa
contacts = api.contacts.all()
```

**Limitations:** Read-only, requires full Apple ID (no app-specific password), 2FA must be completed.

### 11.3 Nylas (Commercial)

Nylas provides iCloud integration using CardDAV and app-specific passwords. Users generate app-specific passwords and complete auth through Nylas’ flow. Suitable for productized integrations.

### 11.4 Native Apple Development

For iOS/macOS apps: use the **Contacts** framework with **CNContactStore**. iCloud sync is automatic when the user enables iCloud Contacts.

---

## 12. Source URLs Summary

| Source | URL |
|--------|-----|
| RFC 6352 (CardDAV) | https://tools.ietf.org/html/rfc6352 |
| RFC 6350 (vCard) | https://tools.ietf.org/html/rfc6350 |
| RFC 6578 (Sync) | https://tools.ietf.org/html/rfc6578 |
| pyicloud GitHub | https://github.com/picklepete/pyicloud |
| pyicloud contacts.py | https://github.com/picklepete/pyicloud/blob/master/pyicloud/services/contacts.py |
| pyicloud CODE_SAMPLES | https://github.com/picklepete/pyicloud/blob/master/CODE_SAMPLES.md |
| DAVx⁵ iCloud tested | https://www.davx5.com/tested-with/icloud |
| Apple app-specific passwords | https://support.apple.com/en-us/102654 |
| Apple iCloud contacts limits | https://support.apple.com/en-us/103188 |
| Nylas iCloud auth | https://developer.nylas.com/docs/provider-guides/icloud |
| CardDAV/iCloud (iaddressbook) | https://iaddressbook.org/wiki/_export/xhtml/docs%3Acarddav |
| Apple Discussions – CardDAV URL | https://discussions.apple.com/thread/253887571 |
| Stack Overflow – iCloud groups CardDAV | https://stackoverflow.com/questions/24202551/manipulate-groups-in-icloud-with-carddav-protocol |
| Apple Developer – Contacts framework | https://developer.apple.com/documentation/contacts |
| CloudKit Web Services (deprecated contacts) | https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/LookupContacts.html |
| OpenRadar – CardDAV sync token | https://openradar.appspot.com/46163430 |
| Apple Forums – vCard FN empty | https://developer.apple.com/forums/thread/724626 |
| Rollout iCloud Contacts API guide | https://rollout.com/integration-guides/icloud-contacts |

---

*Research completed February 27, 2026. API details may change with Apple updates.*
