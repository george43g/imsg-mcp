/**
 * APNs TLV binary protocol encoder/decoder.
 *
 * Each message: 1-byte command ID, then N fields.
 * Each field:   1-byte field ID, 2-byte BE length, value bytes.
 *
 * Reference: Apple Wiki APNs page, apns-dissector
 */

import { createHash, randomBytes, sign } from 'node:crypto';
import {
  type APNsMessage,
  APNsCommand,
  APNsField,
  type TopicState,
} from './types.js';

/**
 * Encode a TLV field: [fieldId:1][length:2BE][value:N]
 */
export function encodeField(fieldId: number, value: Buffer): Buffer {
  const buf = Buffer.alloc(3 + value.length);
  buf.writeUInt8(fieldId, 0);
  buf.writeUInt16BE(value.length, 1);
  value.copy(buf, 3);
  return buf;
}

/**
 * Encode a complete APNs message: [command:1][fields...]
 */
export function encodeMessage(command: APNsCommand, fields: Buffer[]): Buffer {
  const body = Buffer.concat(fields);
  const msg = Buffer.alloc(1 + body.length);
  msg.writeUInt8(command, 0);
  body.copy(msg, 1);
  return msg;
}

/**
 * Decode a TLV stream into an APNsMessage.
 * Returns the message and the number of bytes consumed.
 */
export function decodeMessage(data: Buffer): { message: APNsMessage; bytesRead: number } | null {
  if (data.length < 1) return null;
  const command = data.readUInt8(0) as APNsCommand;
  const fields = new Map<number, Buffer>();

  let offset = 1;
  while (offset + 3 <= data.length) {
    const fieldId = data.readUInt8(offset);
    const fieldLen = data.readUInt16BE(offset + 1);
    if (offset + 3 + fieldLen > data.length) break;
    const value = data.subarray(offset + 3, offset + 3 + fieldLen);
    fields.set(fieldId, Buffer.from(value));
    offset += 3 + fieldLen;
  }

  return { message: { command, fields }, bytesRead: offset };
}

/**
 * Compute SHA-1 topic hash (20 bytes) from a topic string.
 */
export function topicHash(topic: string): Buffer {
  return createHash('sha1').update(topic).digest();
}

/**
 * Build the 17-byte nonce for APNs connect:
 * [0x01][timestamp_ms:8BE][random:8]
 */
export function buildNonce(): Buffer {
  const nonce = Buffer.alloc(17);
  nonce.writeUInt8(0x01, 0);
  const nowMs = BigInt(Date.now());
  nonce.writeBigUInt64BE(nowMs, 1);
  randomBytes(8).copy(nonce, 9);
  return nonce;
}

/**
 * Sign a nonce with the device private key (PKCS1-SHA1).
 * Returns [0x01, 0x01, ...signature].
 */
export function signNonce(nonce: Buffer, privateKeyPem: string): Buffer {
  const sig = sign('sha1', nonce, { key: privateKeyPem, padding: 1 /* PKCS1 */ });
  return Buffer.concat([Buffer.from([0x01, 0x01]), sig]);
}

/**
 * Build a Connect (0x07) message.
 */
export function buildConnectMessage(opts: {
  pushToken?: Buffer;
  certificate: Buffer;
  privateKey: string;
  flags?: number;
}): Buffer {
  const nonce = buildNonce();
  const signature = signNonce(nonce, opts.privateKey);

  const fields: Buffer[] = [];

  if (opts.pushToken) {
    fields.push(encodeField(APNsField.PushToken, opts.pushToken));
  }

  fields.push(encodeField(APNsField.State, Buffer.from([0x01])));
  fields.push(encodeField(APNsField.Flags, Buffer.alloc(4, 0)));
  fields.push(encodeField(APNsField.Interface, Buffer.from([0x01])));
  fields.push(encodeField(APNsField.Carrier, Buffer.from('WiFi')));
  fields.push(encodeField(APNsField.OSVersion, Buffer.from('14.3')));
  fields.push(encodeField(APNsField.OSBuild, Buffer.from('23D60')));
  fields.push(encodeField(APNsField.HardwareVersion, Buffer.from('MacBookPro18,1')));
  fields.push(encodeField(APNsField.Certificate, opts.certificate));
  fields.push(encodeField(APNsField.Nonce, nonce));
  fields.push(encodeField(APNsField.Signature, signature));
  fields.push(encodeField(APNsField.ProtocolVersion, Buffer.from([0x00, 0x02])));

  return encodeMessage(APNsCommand.Connect, fields);
}

/**
 * Build a Push Topics (0x09) filter message to subscribe to iMessage (and optionally SMS).
 */
export function buildTopicFilter(
  pushToken: Buffer,
  topics: { topic: string; state: TopicState }[],
): Buffer {
  const fields: Buffer[] = [
    encodeField(APNsField.PushToken, pushToken),
  ];

  for (const t of topics) {
    const hash = topicHash(t.topic);
    let fieldId: number;
    switch (t.state) {
      case 'enabled': fieldId = 0x02; break;
      case 'disabled': fieldId = 0x03; break;
      case 'opportunistic': fieldId = 0x04; break;
      case 'paused': fieldId = 0x05; break;
    }
    fields.push(encodeField(fieldId, hash));
  }

  return encodeMessage(APNsCommand.PushTopics, fields);
}

/**
 * Build a Notification Ack (0x0B) message.
 */
export function buildAck(messageId: Buffer, status: number = 0): Buffer {
  return encodeMessage(APNsCommand.NotificationAck, [
    encodeField(APNsField.MessageId, messageId),
    encodeField(0x08, Buffer.from([status])),
  ]);
}

/**
 * Build a KeepAlive (0x0C) message.
 */
export function buildKeepAlive(): Buffer {
  return encodeMessage(APNsCommand.KeepAlive, [
    encodeField(0x05, Buffer.from([0x10])),
  ]);
}
