import { get as idbGet, set as idbSet } from "idb-keyval";
import { useCallback, useEffect, useState } from "react";
import {
	base64ToArrayBuffer,
	deriveKeyFromSecret,
	getWebAuthnSecret,
} from "../utils/crypto";

interface MassReceiverViewProps {
	apiBase: string;
	ticketId: string;
	onVaultUpdate: () => void;
}

export function MassReceiverView({
	apiBase,
	ticketId,
	onVaultUpdate,
}: MassReceiverViewProps) {
	const [status, setStatus] = useState("Initializing...");
	const [decryptedFile, setDecryptedFile] = useState<{
		buffer: ArrayBuffer;
		type: string;
	} | null>(null);
	const [downloadLink, setDownloadLink] = useState<{
		url: string;
		name: string;
	} | null>(null);

	const handleMassClaim = useCallback(
		async (tid: string) => {
			setStatus("Connecting to Queue...");
			try {
				const res = await fetch(`${apiBase}/api/mass/claim?ticket=${tid}`);

				const contentType = res.headers.get("content-type");
				if (contentType?.includes("text/html")) {
					setStatus("⚠️ Server Busy. You are in the queue... Retrying in 5s.");
					setTimeout(() => handleMassClaim(tid), 5000);
					return;
				}

				if (!res.ok) throw new Error(await res.text());

				setStatus("Downloading Encrypted File...");
				const ivHeader = res.headers.get("X-IV");
				if (!ivHeader) throw new Error("Missing IV from server");

				const encryptedBuffer = await res.arrayBuffer();
				const iv = base64ToArrayBuffer(ivHeader);

				setStatus("Decrypting...");
				const ticketBytes = new TextEncoder().encode(tid);
				const keyHash = await crypto.subtle.digest("SHA-256", ticketBytes);
				const key = await crypto.subtle.importKey(
					"raw",
					keyHash,
					"AES-GCM",
					false,
					["encrypt", "decrypt"],
				);

				const decrypted = await crypto.subtle.decrypt(
					{ name: "AES-GCM", iv },
					key,
					encryptedBuffer,
				);

				const blob = new Blob([decrypted], {
					type: contentType || "application/octet-stream",
				});
				setDecryptedFile({
					buffer: decrypted,
					type: contentType || "application/octet-stream",
				});
				setDownloadLink({ url: URL.createObjectURL(blob), name: "file" });
				setStatus("Success! File ready.");

				await fetch(`${apiBase}/api/mass/ack`, {
					method: "POST",
					body: JSON.stringify({ ticketId: tid }),
				});
			} catch (e: unknown) {
				setStatus(`Error: ${(e as Error).message}`);
			}
		},
		[apiBase],
	);

	useEffect(() => {
		if (ticketId) {
			handleMassClaim(ticketId);
		}
	}, [ticketId, handleMassClaim]);

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
				Receive File (Mass)
			</h2>
			<div className="space-y-4">
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
