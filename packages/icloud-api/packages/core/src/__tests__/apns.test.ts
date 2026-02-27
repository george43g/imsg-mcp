import { describe, it, expect } from 'vitest';
import {
  encodeField,
  encodeMessage,
  decodeMessage,
  topicHash,
  buildNonce,
  buildTopicFilter,
  buildAck,
  buildKeepAlive,
} from '../apns/protocol.js';
import {
  APNsCommand,
  IMESSAGE_TOPIC,
  IMESSAGE_TOPIC_HASH,
} from '../apns/types.js';

describe('APNs Protocol', () => {
  describe('TLV encoding', () => {
    it('encodes a field correctly', () => {
      const value = Buffer.from([0x01, 0x02, 0x03]);
      const encoded = encodeField(0x05, value);
      expect(encoded.length).toBe(6); // 1 type + 2 length + 3 value
      expect(encoded[0]).toBe(0x05);
      expect(encoded.readUInt16BE(1)).toBe(3);
      expect(encoded.subarray(3)).toEqual(value);
    });

    it('encodes empty value', () => {
      const encoded = encodeField(0x01, Buffer.alloc(0));
      expect(encoded.length).toBe(3);
      expect(encoded.readUInt16BE(1)).toBe(0);
    });
  });

  describe('message encode/decode roundtrip', () => {
    it('encodes and decodes a simple message', () => {
      const fields = [
        encodeField(0x01, Buffer.from([0xAA, 0xBB])),
        encodeField(0x02, Buffer.from([0xCC])),
      ];
      const msg = encodeMessage(APNsCommand.KeepAlive, fields);
      expect(msg[0]).toBe(APNsCommand.KeepAlive);

      const result = decodeMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.message.command).toBe(APNsCommand.KeepAlive);
      expect(result!.message.fields.get(0x01)).toEqual(Buffer.from([0xAA, 0xBB]));
      expect(result!.message.fields.get(0x02)).toEqual(Buffer.from([0xCC]));
    });
  });

  describe('topicHash', () => {
    it('produces correct SHA1 for com.apple.madrid', () => {
      const hash = topicHash(IMESSAGE_TOPIC);
      expect(hash.toString('hex')).toBe(IMESSAGE_TOPIC_HASH);
    });

    it('produces 20-byte hash', () => {
      const hash = topicHash('any.topic');
      expect(hash.length).toBe(20);
    });
  });

  describe('buildNonce', () => {
    it('produces 17-byte nonce starting with 0x01', () => {
      const nonce = buildNonce();
      expect(nonce.length).toBe(17);
      expect(nonce[0]).toBe(0x01);
    });

    it('produces different nonces each time', () => {
      const a = buildNonce();
      const b = buildNonce();
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('buildTopicFilter', () => {
    it('produces a valid PushTopics message', () => {
      const token = Buffer.alloc(32, 0x42);
      const msg = buildTopicFilter(token, [
        { topic: IMESSAGE_TOPIC, state: 'enabled' },
      ]);
      expect(msg[0]).toBe(APNsCommand.PushTopics);
      const decoded = decodeMessage(msg);
      expect(decoded).not.toBeNull();
      expect(decoded!.message.fields.has(0x01)).toBe(true); // push token
      expect(decoded!.message.fields.has(0x02)).toBe(true); // enabled topic
    });
  });

  describe('buildAck', () => {
    it('produces a NotificationAck message', () => {
      const msgId = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const ack = buildAck(msgId);
      expect(ack[0]).toBe(APNsCommand.NotificationAck);
    });
  });

  describe('buildKeepAlive', () => {
    it('produces a KeepAlive message', () => {
      const ka = buildKeepAlive();
      expect(ka[0]).toBe(APNsCommand.KeepAlive);
    });
  });
});
