import { Context } from 'hono';
import { TICKET_STORE } from '../store';
import { Bindings, ClaimRequest } from '../types';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const mintTicket = async (c: Context<{ Bindings: Bindings }>) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'File required' }, 400);
  }

  const ticketId = crypto.randomUUID();
  const content = await file.arrayBuffer();

  TICKET_STORE.set(ticketId, {
    content,
    mimeType: file.type || 'application/octet-stream',
  });

  const claimUrl = `${new URL(c.req.url).origin}/?ticket_id=${ticketId}`;

  return c.json({
    ticket_id: ticketId,
    claim_url: claimUrl,
    message: 'Ticket minted',
  });
};

export const claimTicket = async (c: Context<{ Bindings: Bindings }>) => {
  const body = await c.req.json<ClaimRequest>();
  const { ticket_id, public_key } = body;

  if (!ticket_id || !public_key) {
    return c.json({ error: 'Missing parameters' }, 400);
  }

  const asset = TICKET_STORE.get(ticket_id);

  if (!asset) {
    return c.json({ error: 'Ticket invalid or expired' }, 404);
  }

  try {
    // A. Import Receiver's Public Key
    const userPublicKey = await crypto.subtle.importKey(
      'jwk',
      public_key,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['wrapKey']
    );

    // B. Generate Ephemeral AES Key
    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // C. Encrypt the File
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedFile = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      asset.content
    );

    // D. Wrap the AES Key with Receiver's Public Key
    const wrappedKey = await crypto.subtle.wrapKey(
      'raw',
      aesKey,
      userPublicKey,
      { name: 'RSA-OAEP' }
    );

    // E. Burn the Ticket
    TICKET_STORE.delete(ticket_id);

    return c.json({
      encrypted_file: arrayBufferToBase64(encryptedFile),
      wrapped_key: arrayBufferToBase64(wrappedKey),
      iv: arrayBufferToBase64(iv),
      mime_type: asset.mimeType,
    });
  } catch (err: any) {
    return c.json({ error: 'Encryption failed: ' + err.message }, 500);
  }
};
