import { Hono } from "hono";
import { cors } from "hono/cors";
import { TicketDispenser } from "./do/TicketDispenser";
import { claimTicket, mintTicket } from "./routes/api";

const app = new Hono<{ Bindings: Env }>();

export { TicketDispenser };

// Enable CORS for development (allowing Vite frontend to connect)
app.use(
	"/api/*",
	cors({
		origin: "*",
		allowMethods: ["POST", "GET", "OPTIONS"],
		allowHeaders: ["Content-Type"],
		exposeHeaders: ["X-IV", "Content-Type"], // Expose IV for client
	}),
);

// Standard Routes
app.post("/api/mint", mintTicket);
app.post("/api/claim", claimTicket);

// --- MASS MINTING / DURABLE OBJECT ROUTES ---

// 1. Initialize (Seller)
app.post("/api/mass/init", async (c) => {
	const id = c.env.TICKET_DISPENSER.idFromName("GLOBAL_DEPOT");
	const stub = c.env.TICKET_DISPENSER.get(id);
	return stub.fetch(c.req.raw);
});

// 2. WebSocket (Seller)
app.get("/api/mass/ws", async (c) => {
	const id = c.env.TICKET_DISPENSER.idFromName("GLOBAL_DEPOT");
	const stub = c.env.TICKET_DISPENSER.get(id);
	return stub.fetch(c.req.raw);
});

// 3. Claim / Download (Client)
app.get("/api/mass/claim", async (c) => {
	const id = c.env.TICKET_DISPENSER.idFromName("GLOBAL_DEPOT");
	const stub = c.env.TICKET_DISPENSER.get(id);

	// Fetch from DO (returns unencrypted stream or HTML waiting room)
	const doRes = await stub.fetch(c.req.raw);

	// If not a 200 OK file download, pass it through (e.g. 403, 404, or HTML waiting room)
	if (doRes.status !== 200 || !doRes.headers.get("X-Ticket-ID")) {
		return doRes;
	}

	// ENCRYPTION (AES-GCM)
	// Since file is <1MB, we do this in-memory.
	const ticketId = doRes.headers.get("X-Ticket-ID") as string;
	const fileBuffer = await doRes.arrayBuffer();

	// Derive Key from Ticket ID
	const keyHash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(ticketId),
	);
	const key = await crypto.subtle.importKey("raw", keyHash, "AES-GCM", false, [
		"encrypt",
	]);

	// Encrypt
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encryptedFile = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		fileBuffer,
	);

	// Convert IV to Base64 for Header
	const ivB64 = btoa(String.fromCharCode(...new Uint8Array(iv)));

	return new Response(encryptedFile, {
		headers: {
			"Content-Type":
				doRes.headers.get("Content-Type") || "application/octet-stream",
			"X-IV": ivB64,
			"Access-Control-Expose-Headers": "X-IV",
		},
	});
});

// 4. ACK (Client confirms decryption)
app.post("/api/mass/ack", async (c) => {
	const id = c.env.TICKET_DISPENSER.idFromName("GLOBAL_DEPOT");
	const stub = c.env.TICKET_DISPENSER.get(id);
	return stub.fetch(c.req.raw);
});

export default app;
