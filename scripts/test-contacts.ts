#!/usr/bin/env tsx
/**
 * Test script to verify contacts integration
 */

import { IMessageDB } from '../src/imessage-db.js';
import { ContactsDB } from '../src/contacts-db.js';

async function main() {
  console.log('Testing Contacts Integration\n');
  
  // Test contacts DB
  const contacts = new ContactsDB();
  contacts.initialize();
  
  const stats = contacts.getStats();
  console.log('Contacts loaded:');
  console.log(`  Total contacts: ${stats.totalContacts}`);
  console.log(`  Phone numbers: ${stats.phoneNumbers}`);
  console.log(`  Emails: ${stats.emails}\n`);
  
  // Test iMessage DB with contacts
  const imsg = new IMessageDB();
  
  console.log('Recent conversations (with contact names):');
  const convs = await imsg.listConversations();
  for (const conv of convs.slice(0, 5)) {
    console.log(`  ${conv.displayName || conv.chatIdentifier}`);
    console.log(`    Raw: ${conv.rawIdentifier}`);
    console.log(`    Unread: ${conv.unreadCount}`);
    if (conv.lastMessageSnippet) {
      console.log(`    Last: ${conv.lastMessageSnippet.substring(0, 50)}...`);
    }
    console.log('');
  }
  
  console.log('\nRecent messages (with display names and delivery status):');
  const messages = await imsg.getRecentMessages(5);
  for (const msg of messages) {
    const from = msg.isFromMe ? 'me' : (msg.displayName || msg.handle);
    const status = msg.isDelivered ? '✓' : '...';
    const readStatus = msg.dateRead ? ` (read ${msg.dateRead.toLocaleTimeString()})` : '';
    console.log(`  [${msg.date.toLocaleString()}] ${from}: ${msg.text?.substring(0, 60)}${status}${readStatus}`);
    if (msg.richContentSummary) {
      console.log(`    Rich content: ${msg.richContentSummary}`);
    }
    if (msg.hasAttachments && msg.attachments) {
      console.log(`    Attachments: ${msg.attachments.map(a => a.transferName || a.filename).join(', ')}`);
    }
  }
  
  await imsg.close();
  contacts.close();
}

main().catch(console.error);
