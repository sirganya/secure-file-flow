import { get as idbGet } from "idb-keyval";
import { useCallback, useEffect, useState } from "react";

import { CourierView } from "./components/CourierView";
import { MassReceiverView } from "./components/MassReceiverView";
import { MassSellerView } from "./components/MassSellerView";
import { ReceiverView } from "./components/ReceiverView";
import { VaultView } from "./components/VaultView";

// Determine API URL based on environment
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";
const WS_BASE = API_BASE.replace(/^http/, "ws");

function App() {
	const [mode, setMode] = useState<
		"courier" | "receiver" | "vault" | "mass-seller" | "mass-receiver"
	>("courier");
	const [hasVaultItem, setHasVaultItem] = useState(false);
	const [massTicketId, setMassTicketId] = useState<string | null>(null);

	const checkVault = useCallback(async () => {
		const item = await idbGet("secure-file");
		setHasVaultItem(!!item);
	}, []);

	useEffect(() => {
		checkVault();

		// Check for Mass Ticket in URL
		const params = new URLSearchParams(window.location.search);
		const massTicket = params.get("mass_ticket");
		if (massTicket) {
			setMassTicketId(massTicket);
			setMode("mass-receiver");
		}
	}, [checkVault]);

	return (
		<div className="min-h-screen flex flex-col items-center p-4 font-sans bg-gray-900 text-gray-100">
			<header className="w-full max-w-2xl mb-8 border-b border-gray-700 pb-4 text-center">
				<h1 className="text-3xl font-bold text-blue-400">
					Secure File Courier
				</h1>
				<p className="text-sm text-gray-400">
					Ephemeral Transfer & Secure Vault
				</p>
			</header>

			{/* Mode Switcher */}
			<div className="flex flex-wrap gap-2 justify-center bg-gray-800 p-2 rounded-lg mb-8">
				<button
					type="button"
					onClick={() => setMode("courier")}
					className={`px-4 py-2 rounded font-semibold transition ${mode === "courier" ? "bg-blue-600" : "hover:bg-gray-700"}`}
				>
					P2P Sender
				</button>
				<button
					type="button"
					onClick={() => setMode("receiver")}
					className={`px-4 py-2 rounded font-semibold transition ${mode === "receiver" ? "bg-blue-600" : "hover:bg-gray-700"}`}
				>
					P2P Receiver
				</button>
				<button
					type="button"
					onClick={() => setMode("vault")}
					className={`px-4 py-2 rounded font-semibold transition ${mode === "vault" ? "bg-green-600" : "hover:bg-gray-700"}`}
				>
					Vault {hasVaultItem && "🔒"}
				</button>
				<div className="w-full sm:w-auto h-px sm:h-auto bg-gray-600 mx-2"></div>
				<button
					type="button"
					onClick={() => setMode("mass-seller")}
					className={`px-4 py-2 rounded font-semibold transition ${mode === "mass-seller" ? "bg-purple-600" : "hover:bg-gray-700"}`}
				>
					Mass Sender
				</button>
			</div>

			{mode === "courier" && <CourierView apiBase={API_BASE} />}
			{mode === "receiver" && (
				<ReceiverView apiBase={API_BASE} onVaultUpdate={checkVault} />
			)}
			{mode === "vault" && <VaultView hasVaultItem={hasVaultItem} />}
			{mode === "mass-seller" && (
				<MassSellerView apiBase={API_BASE} wsBase={WS_BASE} />
			)}
			{mode === "mass-receiver" && massTicketId && (
				<MassReceiverView
					apiBase={API_BASE}
					ticketId={massTicketId}
					onVaultUpdate={checkVault}
				/>
			)}
		</div>
	);
}

export default App;
