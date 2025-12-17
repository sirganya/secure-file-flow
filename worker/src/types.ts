export type TicketAsset = {
	content: ArrayBuffer;
	mimeType: string;
};

export type ClaimRequest = {
	ticket_id: string;
	public_key: JsonWebKey;
};
