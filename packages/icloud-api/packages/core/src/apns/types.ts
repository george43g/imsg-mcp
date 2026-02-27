/**
 * Types for Apple Push Notification Service (APNs) binary protocol.
 *
 * Protocol: TLS on TCP port 5223 (fallback 443).
 * Format: Type-Length-Value (TLV) encoding.
 * Topic for iMessage: com.apple.madrid
 *
 * Reference: docs/RESEARCH_ALBERT_APNS_2026-02-27.md
 */

export const APNS_PORT = 5223;
export const APNS_FALLBACK_PORT = 443;
export const APNS_HOST = 'courier.push.apple.com';

export const IMESSAGE_TOPIC = 'com.apple.madrid';
/** SHA1('com.apple.madrid') = e4e6d952954168d0a5db02dbaf27cc35fc18d159 */
export const IMESSAGE_TOPIC_HASH = 'e4e6d952954168d0a5db02dbaf27cc35fc18d159';

export const SMS_TOPIC = 'com.apple.private.alloy.sms';

/** APNs command IDs. */
export enum APNsCommand {
  Connect = 0x07,
  ConnectResponse = 0x08,
  PushTopics = 0x09,
  Notification = 0x0a,
  NotificationAck = 0x0b,
  KeepAlive = 0x0c,
  KeepAliveResponse = 0x0d,
  NoStorage = 0x0e,
  Flush = 0x0f,
  SetState = 0x14,
}

/** Field IDs within APNs commands. */
export enum APNsField {
  PushToken = 0x01,
  State = 0x02,
  EnabledTopic = 0x02,
  DisabledTopic = 0x03,
  OpportunisticTopic = 0x04,
  PausedTopic = 0x05,
  Flags = 0x05,
  Interface = 0x06,
  Timestamp = 0x06,
  Unknown07 = 0x07,
  Carrier = 0x08,
  MessageId = 0x04,
  Expiry = 0x05,
  LargeMessageSize = 0x08,
  OSVersion = 0x09,
  OSBuild = 0x0a,
  HardwareVersion = 0x0b,
  Certificate = 0x0c,
  Nonce = 0x0d,
  Signature = 0x0e,
  ProtocolVersion = 0x10,
  RedirectCount = 0x11,
  DNSResolveTime = 0x13,
  TLSHandshakeTime = 0x14,
}

/** Topic subscription state. */
export type TopicState = 'enabled' | 'opportunistic' | 'paused' | 'disabled';

export interface APNsMessage {
  command: APNsCommand;
  fields: Map<number, Buffer>;
}

export interface PushNotification {
  id: Buffer;
  topic: Buffer;
  payload: Buffer;
  timestamp: bigint;
  expiry: number;
}

export interface APNsConnectionConfig {
  /** PEM-encoded device certificate from Albert activation. */
  certificate: string;
  /** PEM-encoded private key corresponding to the certificate. */
  privateKey: string;
  /** Override host (default: courier.push.apple.com). */
  host?: string;
  /** Override port (default: 5223). */
  port?: number;
}
