import { get as idbGet, set as idbSet } from "idb-keyval";
import { useState } from "react";
import {
	base64ToArrayBuffer,
	deriveKeyFromSecret,
	getWebAuthnSecret,
} from "../utils/crypto";

interface ReceiverViewProps {
	apiBase: string;
	onVaultUpdate: () => void;
}

export function ReceiverView({ apiBase, onVaultUpdate }: ReceiverViewProps) {
	const [claimUrl, setClaimUrl] = useState("");
	const [status, setStatus] = useState("Waiting for input...");
	const [decryptedFile, setDecryptedFile] = useState<{
		buffer: ArrayBuffer;
		type: string;
	} | null>(null);
	const [downloadLink, setDownloadLink] = useState<{
		url: string;
		name: string;
	} | null>(null);

	const handleClaim = async () => {
		try {
			if (!claimUrl) throw new Error("Missing Claim URL");
			const urlObj = new URL(claimUrl);
			const ticketId = urlObj.searchParams.get("ticket_id");
			if (!ticketId) throw new Error("Invalid URL");

			setStatus("1. Generating Keys...");
			const keyPair = await window.crypto.subtle.generateKey(
				{
					name: "RSA-OAEP",
					modulusLength: 2048,
					publicExponent: new Uint8Array([1, 0, 1]),
					hash: "SHA-256",
				},
				true,
				["encrypt", "decrypt", "wrapKey", "unwrapKey"],
			);

			setStatus("2. Requesting File...");
			const publicKeyJWK = await window.crypto.subtle.exportKey(
				"jwk",
				keyPair.publicKey,
			);
			const res = await fetch(`${apiBase}/api/claim`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ticket_id: ticketId, public_key: publicKeyJWK }),
			});

			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();

			setStatus("3. Decrypting...");
			const encryptedKey = base64ToArrayBuffer(data.wrapped_key);
			const decryptedAesKey = await window.crypto.subtle.decrypt(
				{ name: "RSA-OAEP" },
				keyPair.privateKey,
				encryptedKey,
			);
			const aesKeyObj = await window.crypto.subtle.importKey(
				"raw",
				decryptedAesKey,
				{ name: "AES-GCM" },
				true,
				["encrypt", "decrypt"],
			);

			const decryptedFileBuffer = await window.crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: base64ToArrayBuffer(data.iv) },
				aesKeyObj,
				base64ToArrayBuffer(data.encrypted_file),
			);

			const blob = new Blob([decryptedFileBuffer], { type: data.mime_type });
			setDecryptedFile({ buffer: decryptedFileBuffer, type: data.mime_type });
			setDownloadLink({
				url: URL.createObjectURL(blob),
				name: `decrypted-${Date.now()}`,
			});
			setStatus("Success! File ready.");
		} catch (e: unknown) {
			setStatus(`Error: ${(e as Error).message}`);
		}
	};

	const handleSaveToVault = async () => {
		if (!decryptedFile) return;
		try {
			setStatus("Authenticating with WebAuthn...");

			const existingId = await idbGet("credential-id");
			const secret = await getWebAuthnSecret(!existingId);

			setStatus("Deriving Vault Key...");
			const key = await deriveKeyFromSecret(secret);

			setStatus("Encrypting for Vault...");
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const encryptedContent = await crypto.subtle.encrypt(
				{ name: "AES-GCM", iv },
				key,
				decryptedFile.buffer,
			);

			await idbSet("secure-file", {
				content: encryptedContent,
				iv: iv,
				type: decryptedFile.type,
			});

			onVaultUpdate();
			setStatus("Saved to Browser Vault!");
		} catch (e: unknown) {
			setStatus(`Vault Error: ${(e as Error).message}`);
		}
	};

	return (
		<section className="w-full max-w-xl bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl">
			<h2 className="text-xl font-semibold mb-4 text-blue-400">
				Receive File (P2P)
			</h2>
			<div className="space-y-4">
				<input
					type="text"
					value={claimUrl}
					onChange={(e) => setClaimUrl(e.target.value)}
					placeholder="Paste URL..."
					className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white font-mono text-sm"
				/>

				<div className="p-4 bg-gray-900 rounded border border-gray-700 text-xs text-gray-400 font-mono">
					<p>
						Status:{" "}
						<span
							className={
								status.startsWith("Error") || status.startsWith("Unlock Failed")
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
					onClick={handleClaim}
					className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition"
				>
					Decrypt P2P
				</button>

				{downloadLink && (
					<div className="mt-4 flex flex-col space-y-3">
						<a
							href={downloadLink.url}
							download={downloadLink.name}
							className="block w-full text-center px-6 py-3 bg-green-500 text-white rounded font-bold hover:bg-green-400"
						>
							Save to Disk
						</a>
						<button
							type="button"
							onClick={handleSaveToVault}
							className="block w-full px-6 py-3 bg-gray-700 border border-green-500 text-green-400 rounded font-bold hover:bg-gray-600"
						>
							Save to Browser Vault
						</button>
					</div>
				)}
			</div>
		</section>
	);
}
