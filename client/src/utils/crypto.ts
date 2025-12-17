import { get as idbGet, set as idbSet } from "idb-keyval";

export const base64ToArrayBuffer = (base64: string) => {
	const binaryString = window.atob(base64);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer;
};

// Static challenge for PRF
const getPrfSalt = async () => {
	const enc = new TextEncoder().encode("secure-file-flow-static-challenge-v1");
	return crypto.subtle.digest("SHA-256", enc);
};

export const getWebAuthnSecret = async (
	create: boolean = false,
): Promise<ArrayBuffer> => {
	const salt = await getPrfSalt();
	const prfParams = { eval: { first: new Uint8Array(salt) } };

	if (create) {
		const credential = (await navigator.credentials.create({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rp: { name: "Secure File Courier" },
				user: {
					id: crypto.getRandomValues(new Uint8Array(16)),
					name: "user@local",
					displayName: "Local User",
				},
				pubKeyCredParams: [
					{ alg: -7, type: "public-key" },
					{ alg: -257, type: "public-key" },
				],
				authenticatorSelection: {
					userVerification: "required",
					residentKey: "required",
				},
				timeout: 60000,
				extensions: {
					// @ts-ignore - PRF types missing
					prf: prfParams,
				},
			},
		})) as PublicKeyCredential;
		await idbSet("credential-id", credential.rawId);
		// @ts-ignore - PRF types missing
		const res = credential.getClientExtensionResults();
		// @ts-ignore - PRF types missing
		if (res.prf?.results?.first) return res.prf.results.first;
	}

	const storedCredId = await idbGet("credential-id");
	if (!storedCredId && !create) throw new Error("No Vault set up.");

	const assertion = (await navigator.credentials.get({
		publicKey: {
			challenge: new Uint8Array(salt),
			allowCredentials: storedCredId
				? [{ id: storedCredId, type: "public-key" }]
				: [],
			userVerification: "required",
			extensions: {
				// @ts-ignore - PRF types missing
				prf: prfParams,
			},
		},
	})) as PublicKeyCredential;

	// @ts-ignore - PRF types missing
	const extResults = assertion.getClientExtensionResults();
	// @ts-ignore - PRF types missing
	if (extResults.prf?.results?.first) return extResults.prf.results.first;

	console.warn("PRF fallback to signature.");
	return (assertion.response as AuthenticatorAssertionResponse).signature;
};

export const deriveKeyFromSecret = async (
	secret: ArrayBuffer,
): Promise<CryptoKey> => {
	const material = await crypto.subtle.importKey(
		"raw",
		secret,
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: new TextEncoder().encode("salt-v1"),
			iterations: 100000,
			hash: "SHA-256",
		},
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
};