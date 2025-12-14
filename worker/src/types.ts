export type Bindings = {
  // Add KV or other bindings here if needed in the future
  // e.g., TICKET_KV: KVNamespace;
};

export type TicketAsset = {
  content: ArrayBuffer;
  mimeType: string;
};

export type ClaimRequest = {
  ticket_id: string;
  public_key: JsonWebKey;
};
