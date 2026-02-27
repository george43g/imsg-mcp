/**
 * Types for Apple GrandSlam (GSA) authentication.
 *
 * GSA uses SRP-6a with SHA-256 and 2048-bit group.
 * See docs/GRANDSLAM_GSA_RESEARCH.md for protocol details.
 */

export interface AnisetteData {
  /** Base64-encoded one-time password (~60 chars, expires in ~30s). */
  'X-Apple-I-MD': string;
  /** Base64-encoded machine identifier (persistent per device). */
  'X-Apple-I-MD-M': string;
  /** Machine info identifier (17106176 for macOS, 50660608 for Windows). */
  'X-Apple-I-MD-RINFO': string;
}

export interface GSAInitRequest {
  username: string;
  /** SRP-6a client public value A (hex). */
  A2k: Buffer;
  /** Supported password protocols: ['s2k', 's2k_fo']. */
  ps: string[];
  /** Client proof data (anisette headers, timestamps, device info). */
  cpd: Record<string, string>;
}

export interface GSAInitResponse {
  /** Server salt. */
  s: Buffer;
  /** SRP-6a server public value B. */
  B: Buffer;
  /** PBKDF2 iteration count. */
  i: number;
  /** Session challenge string. */
  c: string;
  /** Server-selected password protocol ('s2k' or 's2k_fo'). */
  sp: string;
}

export interface GSACompleteResponse {
  /** Server's M2 proof for mutual auth. */
  M2: Buffer;
  /** Encrypted session data (AES-CBC with SRP session key). */
  spd: Buffer;
  /** Status code (0 = success). */
  status: number;
}

export interface GSASessionData {
  /** Apple ID DSID (9-digit numeric string). */
  aDsID: string;
  /** IDMS token for 2FA flows. */
  idmsToken?: string;
  /** GrandSlam token. */
  GsIdmsToken?: string;
  /** Authentication token for IDS. */
  authToken?: string;
  /** Account name. */
  acname?: string;
}

export interface TwoFactorState {
  kind: '2fa' | '2sv';
  /** For 2SV: available trusted devices. */
  trustedDevices?: TrustedDevice[];
}

export interface TrustedDevice {
  id: string;
  name: string;
  type: 'sms' | 'trustedDevice';
}

export interface AuthSession {
  dsid: string;
  authToken: string;
  idmsToken?: string;
  petToken?: string;
  anisetteData: AnisetteData;
}

export interface AuthConfig {
  /** Apple ID username (email). */
  username: string;
  /** Apple ID password. */
  password: string;
  /** Provider for anisette data. */
  anisetteProvider: AnisetteProvider;
  /** Optional callback for 2FA code input. */
  twoFactorCallback?: (state: TwoFactorState) => Promise<string>;
}

export interface AnisetteProvider {
  getAnisetteData(): Promise<AnisetteData>;
}
