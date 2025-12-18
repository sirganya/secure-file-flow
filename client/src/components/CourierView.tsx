import QRCode from "qrcode";
import { useState } from "react";

interface CourierViewProps {
	apiBase: string;
}

export function CourierView({ apiBase }: CourierViewProps) {
	const [file, setFile] = useState<File | null>(null);
	const [ticketUrl, setTicketUrl] = useState<string | null>(null);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [origin, setOrigin] = useState(window.location.origin);

	const handleMint = async () => {
		if (!file) return alert("Select a file first");
		const formData = new FormData();
		formData.append("file", file);
		try {
			const res = await fetch(`${apiBase}/api/mint`, {
				method: "POST",
				body: formData,
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			const url = `${origin}/?ticket_id=${data.ticket_id}`;
			setTicketUrl(url);
			setQrDataUrl(await QRCode.toDataURL(url));
		} catch (e: unknown) {
			alert((e as Error).message);
		}
	};

	return (
		<section className="w-full max-w-xl bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl">
			<h2 className="text-xl font-semibold mb-4 text-green-400">P2P Upload</h2>
			<div className="space-y-4">
				<div>
					<label className="block text-xs text-gray-400 mb-1">
						Public Origin (for QR)
						<input
							type="text"
							value={origin}
							onChange={(e) => setOrigin(e.target.value)}
							className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white font-mono text-xs mt-1"
						/>
					</label>
				</div>
				<input
					type="file"
					onChange={(e) => setFile(e.target.files?.[0] || null)}
					className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-blue-900 file:text-blue-300"
				/>
				<button
					type="button"
					onClick={handleMint}
					disabled={!file}
					className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg transition"
				>
					Generate QR
				</button>
			</div>
			{qrDataUrl && (
				<div className="mt-8 flex flex-col items-center bg-white p-4 rounded-lg text-gray-900">
					<img src={qrDataUrl} alt="QR" />
					<p className="text-xs mt-2 font-mono break-all max-w-xs text-center">
						{ticketUrl}
					</p>
				</div>
			)}
		</section>
	);
}
