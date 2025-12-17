import { DurableObject } from "cloudflare:workers";

interface Ticket {
	id: string;
	status: "AVAILABLE" | "RESERVED" | "CLAIMED";
	reservedAt?: number;
}

export class TicketDispenser extends DurableObject {
	state: DurableObjectState;

	// In-memory state (backed by DO storage for persistence)
	file: ArrayBuffer | null = null;
	mimeType: string = "application/octet-stream";
	tickets: Map<string, Ticket> = new Map();

	// Queueing
	maxConcurrentDownloads = 50;
	currentDownloads = 0;
	waitingRoom: Set<(canEnter: boolean) => void> = new Set(); // Resolvers for waiting requests

	// WebSockets for Seller
	sellerSockets: Set<WebSocket> = new Set();

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.state = state;

		// Load state from storage on boot
		this.state.blockConcurrencyWhile(async () => {
			const storedFile = await this.state.storage.get<ArrayBuffer>("file");
			const storedMime = await this.state.storage.get<string>("mimeType");
			const storedTickets =
				await this.state.storage.get<Map<string, Ticket>>("tickets");

			if (storedFile) this.file = storedFile;
			if (storedMime) this.mimeType = storedMime;
			if (storedTickets) this.tickets = storedTickets;
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// --- SELLER ACTIONS ---

		// 1. Upload File & Initialize Tickets
		if (path === "/init" && request.method === "POST") {
			const formData = await request.formData();
			const file = formData.get("file") as File;
			const count = parseInt(formData.get("count") as string, 10) || 100;

			if (!file) return new Response("No file", { status: 400 });

			this.file = await file.arrayBuffer();
			this.mimeType = file.type;

			// Generate Tickets
			this.tickets.clear();
			for (let i = 0; i < count; i++) {
				const id = crypto.randomUUID();
				this.tickets.set(id, { id, status: "AVAILABLE" });
			}

			// Persist
			await this.state.storage.put("file", this.file);
			await this.state.storage.put("mimeType", this.mimeType);
			await this.state.storage.put("tickets", this.tickets);

			return new Response(
				JSON.stringify({
					message: "Initialized",
					ticket_count: count,
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}

		// 2. Seller WebSocket (Live Updates)
		if (path === "/ws") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);

			this.sellerSockets.add(server);
			server.accept();
			server.addEventListener("close", () => this.sellerSockets.delete(server));

			// Send initial batch of tickets
			this.sendBatchToSeller(server);

			return new Response(null, { status: 101, webSocket: client });
		}

		// --- CLIENT ACTIONS ---

		// 3. Claim (Download) Request
		if (path === "/claim") {
			const ticketId = url.searchParams.get("ticket");
			if (!ticketId || !this.tickets.has(ticketId)) {
				return new Response("Invalid Ticket", { status: 403 });
			}

			const ticket = this.tickets.get(ticketId);
			if (!ticket) return new Response("Ticket error", { status: 500 });

			// State Machine
			if (ticket.status === "CLAIMED") {
				return new Response("Ticket already used", { status: 410 });
			}

			if (ticket.status === "RESERVED") {
				// Check expiry (5 mins)
				if (Date.now() - (ticket.reservedAt || 0) > 5 * 60 * 1000) {
					// Expired, allow reset
					ticket.status = "AVAILABLE";
				} else {
					// Check if it's the same user (Cookie/Session check would go here)
					// For now, assuming naive race or retry
				}
			}

			// QUEUEING LOGIC
			if (this.currentDownloads >= this.maxConcurrentDownloads) {
				// Return "Waiting Room" HTML which polls this endpoint
				return new Response(
					`
                 <html>
                 <head><meta http-equiv="refresh" content="5"></head>
                 <body style="background:#111; color:#eee; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
                    <div style="text-align:center">
                        <h1>High Traffic</h1>
                        <p>You are in the queue...</p>
                        <p>Do not close this page.</p>
                    </div>
                 </body>
                 </html>
             `,
					{ headers: { "Content-Type": "text/html" } },
				);
			}

			// Enter Download Mode
			this.currentDownloads++;
			ticket.status = "RESERVED";
			ticket.reservedAt = Date.now();
			this.tickets.set(ticketId, ticket);
			await this.state.storage.put("tickets", this.tickets); // Persist status

			// Stream the file (Internal unencrypted, Worker will encrypt)
			// We send the key-seed (ticketID) to the worker via header/metadata so IT can encrypt.
			// But wait, the Worker calls *us*. We just return the body.
			// The Worker wrapper will handle the encryption.

			return new Response(this.file, {
				headers: {
					"Content-Type": this.mimeType,
					"X-Ticket-ID": ticketId, // Pass ID back so Worker knows what key to use
				},
			});
		}

		// 4. ACK (Confirm Download Success)
		if (path === "/ack" && request.method === "POST") {
			const body = (await request.json()) as { ticketId: string };
			const ticketId = body.ticketId;

			if (this.tickets.has(ticketId)) {
				const ticket = this.tickets.get(ticketId);
				if (ticket) {
					ticket.status = "CLAIMED";
					this.tickets.set(ticketId, ticket);
					await this.state.storage.put("tickets", this.tickets);

					this.currentDownloads = Math.max(0, this.currentDownloads - 1);

					// Notify Seller to remove QR
					this.broadcastToSeller({ type: "claimed", ticketId });

					return new Response("Burned", { status: 200 });
				}
			}
			return new Response("Unknown", { status: 400 });
		}

		return new Response("Not Found", { status: 404 });
	}

	// Helper: Send available tickets to seller
	sendBatchToSeller(ws: WebSocket) {
		const available = Array.from(this.tickets.values())
			.filter((t) => t.status === "AVAILABLE")
			.slice(0, 20)
			.map((t) => t.id);

		ws.send(JSON.stringify({ type: "batch", tickets: available }));
	}

	broadcastToSeller(msg: unknown) {
		const data = JSON.stringify(msg);
		for (const ws of this.sellerSockets) {
			try {
				ws.send(data);
			} catch {
				this.sellerSockets.delete(ws);
			}
		}
	}
}
