import { get as idbGet } from "idb-keyval";
import { useState } from "react";
import { deriveKeyFromSecret, getWebAuthnSecret } from "../utils/crypto";

interface VaultViewProps {
	hasVaultItem: boolean;
}

export function VaultView({ hasVaultItem }: VaultViewProps) {
	const [status, setStatus] = useState("Waiting for input...");
	const [downloadLink, setDownloadLink] = useState<{
		url: string;
		name: string;
	} | null>(null);

	const handleOpenVault = async () => {
		try {
			setStatus("Authenticating to Unlock...");
			const item = await idbGet("secure-file");
			if (!item) throw new Error("Vault is empty");

			const secret = await getWebAuthnSecret(false);
			const key = await deriveKeyFromSecret(secret);

			setStatus("Decrypting Vault...");
			const decrypted = await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: item.iv },
				key,
				item.content,
			);

			const blob = new Blob([decrypted], { type: item.type });
			setDownloadLink({
				url: URL.createObjectURL(blob),
				name: `vault-file-${Date.now()}`,
			});
			setStatus("Vault Unlocked!");
		} catch (e: unknown) {
			setStatus(`Unlock Failed: ${(e as Error).message}`);
		}
	};

	return (
		<section className="w-full max-w-xl bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl text-center">
			<h2 className="text-xl font-semibold mb-4 text-green-400">
				Browser Vault
			</h2>
			{hasVaultItem ? (
				<div className="space-y-4">
					<p className="text-gray-400 text-sm">
						A file is secured with your Passkey.
					</p>
					<div className="p-4 bg-gray-900 rounded border border-gray-700 text-xs text-gray-400 font-mono text-left">
						<p>
							Status:{" "}
							<span
								className={
									status.startsWith("Error") ||
									status.startsWith("Unlock Failed")
										? "text-red-500"
										: "text-yellow-500"
								}
							>
								{status}
							</span>
						</p>
					</div>
					<button
						type="button"
						onClick={handleOpenVault}
						className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg transition"
					>
						Authenticate & Unlock
					</button>
					{downloadLink && (
						<a
							href={downloadLink.url}
							download={downloadLink.name}
							className="block w-full text-center px-6 py-3 bg-blue-500 text-white rounded font-bold hover:bg-blue-400"
						>
							Download
						</a>
					)}
				</div>
			) : (
				<p className="text-gray-500">Vault is empty.</p>
			)}
		</section>
	);
}
