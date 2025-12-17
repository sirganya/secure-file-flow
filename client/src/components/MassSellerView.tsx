import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

interface MassSellerViewProps {
	apiBase: string;
	wsBase: string;
}

export function MassSellerView({ apiBase, wsBase }: MassSellerViewProps) {
	const [file, setFile] = useState<File | null>(null);
	const [massCount, setMassCount] = useState(100);
	const [massTickets, setMassTickets] = useState<string[]>([]);
	const [currentTicketId, setCurrentTicketId] = useState<string | null>(null);
	const [wsConnected, setWsConnected] = useState(false);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const wsRef = useRef<WebSocket | null>(null);

	const handleMassInit = async () => {
		if (!file) return alert("Select file");
		const formData = new FormData();
		formData.append("file", file);
		formData.append("count", massCount.toString());

		try {
			const res = await fetch(`${apiBase}/api/mass/init`, {
				method: "POST",
				body: formData,
			});
			if (!res.ok) throw new Error(await res.text());
			alert("Initialized! Connecting to Dispenser...");
			connectSellerWs();
		} catch (e: unknown) {
			alert(`Error: ${(e as Error).message}`);
		}
	};

	const connectSellerWs = () => {
		const ws = new WebSocket(`${wsBase}/api/mass/ws`);
		wsRef.current = ws;

		ws.onopen = () => setWsConnected(true);
		ws.onclose = () => setWsConnected(false);
		ws.onmessage = async (evt) => {
			const msg = JSON.parse(evt.data);
			if (msg.type === "batch") {
				setMassTickets((prev) => [...prev, ...msg.tickets]);
			}
			if (msg.type === "claimed") {
				setMassTickets((prev) => prev.filter((t) => t !== msg.ticketId));
				// If the claimed ticket was the current one, the effect below will advance it
			}
		};
	};

	// Auto-Advance Logic
	useEffect(() => {
		// If we have tickets but no current one, pick the first
		if (massTickets.length > 0 && !currentTicketId) {
			const next = massTickets[0];
			setCurrentTicketId(next);
		}
		// If the current ticket is no longer in the list (claimed), pick the new first
		else if (currentTicketId && !massTickets.includes(currentTicketId)) {
			const next = massTickets[0]; // Could be undefined if empty
			setCurrentTicketId(next || null);
		}
	}, [massTickets, currentTicketId]);

	// QR Generation Effect
	useEffect(() => {
		if (currentTicketId) {
			const url = `${window.location.origin}/?mass_ticket=${currentTicketId}`;
			QRCode.toDataURL(url).then(setQrDataUrl);
		} else {
			setQrDataUrl(null);
		}
	}, [currentTicketId]);

	return (
		<section className="w-full max-w-xl bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl text-center">
			<h2 className="text-xl font-semibold mb-4 text-purple-400">
				Mass Dispenser
			</h2>
			{!wsConnected ? (
				<div className="space-y-4">
					<input
						type="file"
						onChange={(e) => setFile(e.target.files?.[0] || null)}
						className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-purple-900 file:text-purple-300"
					/>
					<div className="flex items-center space-x-2 justify-center">
						<label>
							Tickets:
							<input
								type="number"
								value={massCount}
								onChange={(e) => setMassCount(Number(e.target.value))}
								className="bg-gray-900 border border-gray-600 rounded p-2 w-24 ml-2"
							/>
						</label>
					</div>
					<button
						type="button"
						onClick={handleMassInit}
						disabled={!file}
						className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg transition"
					>
						Initialize & Start
					</button>
				</div>
			) : (
				<div className="flex flex-col items-center">
					<div className="mb-4 text-green-400 font-mono text-sm">
						● Connected to Dispenser
					</div>
					<div className="mb-4 text-gray-400">
						Tickets in Queue: {massTickets.length}
					</div>
					{qrDataUrl ? (
						<div className="bg-white p-8 rounded-lg">
							<img src={qrDataUrl} alt="QR" className="w-64 h-64" />
						</div>
					) : (
						<div className="animate-pulse text-gray-500">
							Loading next ticket...
						</div>
					)}
					<p className="mt-4 text-xs text-gray-500">
						Scan to claim. QR will auto-advance.
					</p>
				</div>
			)}
		</section>
	);
}
