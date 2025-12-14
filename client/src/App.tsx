import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { set as idbSet, get as idbGet } from 'idb-keyval';

// Determine API URL based on environment
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

// Static challenge for key derivation (The "Tacky" Workaround)
// In a real app, you might mix this with a user-specific salt stored in IDB
// const STATIC_CHALLENGE = new TextEncoder().encode("secure-file-flow-static-challenge-v1"); // REMOVED

function App() {
  const [mode, setMode] = useState<'courier' | 'receiver' | 'vault'>('courier');
  
  // Courier State
  const [file, setFile] = useState<File | null>(null);
  const [ticketUrl, setTicketUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Receiver/Decrypted State
  const [claimUrl, setClaimUrl] = useState('');
  const [status, setStatus] = useState('Waiting for input...');
  const [decryptedFile, setDecryptedFile] = useState<{ buffer: ArrayBuffer; type: string } | null>(null);
  const [downloadLink, setDownloadLink] = useState<{ url: string; name: string } | null>(null);

  // Vault State
  const [hasVaultItem, setHasVaultItem] = useState(false);

  useEffect(() => {
    // Check if we have something in the vault on load
    checkVault();
  }, []);

  const checkVault = async () => {
    const item = await idbGet('secure-file');
    setHasVaultItem(!!item);
  };

  // --- CRYPTO HELPERS ---

  const base64ToArrayBuffer = (base64: string) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  // Static challenge for PRF (Must be 32 bytes for some PRF implementations)
  // We will generate this once from the string.
  const getPrfSalt = async () => {
      const enc = new TextEncoder().encode("secure-file-flow-static-challenge-v1");
      return crypto.subtle.digest("SHA-256", enc);
  };

  // 1. Get a Deterministic Secret from WebAuthn (PRF > Signature)
  const getWebAuthnSecret = async (create: boolean = false): Promise<ArrayBuffer> => {
    const salt = await getPrfSalt();
    
    // PRF Extension Config
    const prfParams = {
        eval: {
            first: new Uint8Array(salt)
        }
    };

    if (create) {
        // --- REGISTRATION ---
        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: { name: "Secure File Courier" },
                user: {
                    id: crypto.getRandomValues(new Uint8Array(16)),
                    name: "user@local",
                    displayName: "Local User"
                },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
                authenticatorSelection: { 
                    userVerification: "required",
                    residentKey: "required" // PRF usually requires resident keys (passkeys)
                },
                timeout: 60000,
                extensions: {
                    // @ts-ignore
                    prf: prfParams
                }
            }
        }) as PublicKeyCredential;

        const rawId = credential.rawId;
        await idbSet('credential-id', rawId);

        // Check if we got a PRF result immediately (some browsers do, some don't)
        const extResults = credential.getClientExtensionResults();
        // @ts-ignore
        if (extResults.prf && extResults.prf.results && extResults.prf.results.first) {
            // @ts-ignore
            return extResults.prf.results.first;
        }
        
        // If not, we might need to authenticate immediately to get it.
        // Fall through to 'get' logic below...
    }

    // --- AUTHENTICATION ---
    const storedCredId = await idbGet('credential-id');
    if (!storedCredId && !create) {
        throw new Error("No Vault set up. Please save a file first.");
    }

    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: new Uint8Array(salt), // For signature fallback
            allowCredentials: storedCredId ? [{ id: storedCredId, type: 'public-key' }] : [],
            userVerification: "required",
            extensions: {
                // @ts-ignore
                prf: prfParams
            }
        }
    }) as PublicKeyCredential;

    const extResults = assertion.getClientExtensionResults();
    // @ts-ignore
    if (extResults.prf && extResults.prf.results && extResults.prf.results.first) {
        // SUCCESS: We have a deterministic PRF output!
        // @ts-ignore
        return extResults.prf.results.first;
    }

    // FALLBACK: If PRF failed (not supported), return the Signature.
    // WARNING: This will fail decryption on non-deterministic authenticators.
    console.warn("PRF extension not supported or failed. Falling back to Signature (May be non-deterministic).");
    const response = assertion.response as AuthenticatorAssertionResponse;
    return response.signature;
  };

  // 2. Derive AES Key from Secret (PRF Output or Signature)
  const deriveKeyFromSecret = async (secret: ArrayBuffer): Promise<CryptoKey> => {
    // Import secret as key material
    const material = await crypto.subtle.importKey(
        "raw",
        secret,
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    // Derive AES-GCM key
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: new TextEncoder().encode("salt-v1"), 
            iterations: 100000,
            hash: "SHA-256"
        },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
  };

  // --- ACTIONS ---

  const handleMint = async () => {
    if (!file) return alert("Select a file first");

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/api/mint`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      setTicketUrl(data.claim_url);
      const qrCode = await QRCode.toDataURL(data.claim_url);
      setQrDataUrl(qrCode);
      setClaimUrl(data.claim_url);
    } catch (e: any) {
      alert("Error minting ticket: " + e.message);
    }
  };

  const handleClaim = async () => {
    try {
      if (!claimUrl) throw new Error("Missing Claim URL");
      
      const urlObj = new URL(claimUrl);
      const ticketId = urlObj.searchParams.get('ticket_id');
      if (!ticketId) throw new Error("Invalid URL: missing ticket_id");

      setStatus("1. Generating Keys...");
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
      );

      setStatus("2. Requesting File...");
      const publicKeyJWK = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
      const res = await fetch(`${API_BASE}/api/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, public_key: publicKeyJWK })
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      setStatus("3. Decrypting...");
      const encryptedKey = base64ToArrayBuffer(data.wrapped_key);
      const decryptedAesKey = await window.crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        keyPair.privateKey,
        encryptedKey
      );

      const aesKeyObj = await window.crypto.subtle.importKey(
        "raw",
        decryptedAesKey,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
      );

      const iv = base64ToArrayBuffer(data.iv);
      const encryptedFile = base64ToArrayBuffer(data.encrypted_file);
      const decryptedFileBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        aesKeyObj,
        encryptedFile
      );

      const blob = new Blob([decryptedFileBuffer], { type: data.mime_type });
      setDecryptedFile({ buffer: decryptedFileBuffer, type: data.mime_type });
      setDownloadLink({ url: URL.createObjectURL(blob), name: `decrypted-${Date.now()}` });
      setStatus("Success! File ready.");

    } catch (e: any) {
      setStatus("Error: " + e.message);
      console.error(e);
    }
  };

  const handleSaveToVault = async () => {
      if (!decryptedFile) return;
      try {
          setStatus("Authenticating with WebAuthn...");
          
          // Force creation/registration on first save? 
          // For demo simplicity: always try to 'create' (register) a passkey first if one doesn't exist?
          // We'll pass 'true' to create a new credential for this app instance.
          // In real life, check if user is already registered.
          const existingId = await idbGet('credential-id');
          const secret = await getWebAuthnSecret(!existingId);
          
          setStatus("Deriving Vault Key...");
          const key = await deriveKeyFromSecret(secret);
          
          setStatus("Encrypting for Vault...");
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const encryptedContent = await crypto.subtle.encrypt(
              { name: "AES-GCM", iv },
              key,
              decryptedFile.buffer
          );

          await idbSet('secure-file', {
              content: encryptedContent,
              iv: iv,
              type: decryptedFile.type
          });
          
          await checkVault();
          setStatus("Saved to Browser Vault!");
          setMode('vault');
      } catch (e: any) {
          setStatus("Vault Error: " + e.message);
      }
  };

  const handleOpenVault = async () => {
      try {
          setStatus("Authenticating to Unlock...");
          const item = await idbGet('secure-file');
          if (!item) throw new Error("Vault is empty");

          const secret = await getWebAuthnSecret(false);
          const key = await deriveKeyFromSecret(secret);

          setStatus("Decrypting Vault...");
          const decrypted = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: item.iv },
              key,
              item.content
          );

          setDecryptedFile({ buffer: decrypted, type: item.type });
          const blob = new Blob([decrypted], { type: item.type });
          setDownloadLink({ url: URL.createObjectURL(blob), name: `vault-file-${Date.now()}` });
          setStatus("Vault Unlocked!");
      } catch (e: any) {
          setStatus("Unlock Failed: " + e.message);
      }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 font-sans bg-gray-900 text-gray-100">
      <header className="w-full max-w-2xl mb-8 border-b border-gray-700 pb-4 text-center">
        <h1 className="text-3xl font-bold text-blue-400">Secure File Courier</h1>
        <p className="text-sm text-gray-400">Ephemeral Transfer & Secure Vault</p>
      </header>

      <div className="flex space-x-2 bg-gray-800 p-2 rounded-lg mb-8">
        <button onClick={() => setMode('courier')} className={`px-4 py-2 rounded font-semibold transition ${mode === 'courier' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}>
          Sender
        </button>
        <button onClick={() => setMode('receiver')} className={`px-4 py-2 rounded font-semibold transition ${mode === 'receiver' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}>
          Receiver
        </button>
        <button onClick={() => setMode('vault')} className={`px-4 py-2 rounded font-semibold transition ${mode === 'vault' ? 'bg-green-600 text-white' : 'hover:bg-gray-700'}`}>
          Vault {hasVaultItem && '🔒'}
        </button>
      </div>

      {mode === 'courier' && (
        <section className="w-full max-w-xl bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl">
          <h2 className="text-xl font-semibold mb-4 text-green-400">1. Upload & Mint</h2>
          <div className="space-y-4">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-blue-900 file:text-blue-300" />
            <button onClick={handleMint} disabled={!file} className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg transition">
              Generate QR
            </button>
          </div>
          {qrDataUrl && (
            <div className="mt-8 flex flex-col items-center bg-white p-4 rounded-lg text-gray-900">
              <img src={qrDataUrl} alt="QR" />
              <p className="text-xs mt-2 font-mono break-all max-w-xs text-center">{ticketUrl}</p>
            </div>
          )}
        </section>
      )}

      {mode === 'receiver' && (
        <section className="w-full max-w-xl bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl">
          <h2 className="text-xl font-semibold mb-4 text-purple-400">2. Claim & Decrypt</h2>
          <div className="space-y-4">
            <input type="text" value={claimUrl} onChange={(e) => setClaimUrl(e.target.value)} placeholder="Paste URL..." className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white font-mono text-sm" />
            <div className="p-4 bg-gray-900 rounded border border-gray-700 text-xs text-gray-400 font-mono">
              <p>Status: <span className={status.startsWith('Error') || status.startsWith('Unlock Failed') ? 'text-red-500' : 'text-yellow-500'}>{status}</span></p>
            </div>
            <button onClick={handleClaim} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg transition">
              Decrypt
            </button>
            {downloadLink && (
              <div className="mt-4 flex flex-col space-y-3">
                <a href={downloadLink.url} download={downloadLink.name} className="block w-full text-center px-6 py-3 bg-blue-500 text-white rounded font-bold hover:bg-blue-400">
                  Save to Disk
                </a>
                <button onClick={handleSaveToVault} className="block w-full px-6 py-3 bg-gray-700 border border-green-500 text-green-400 rounded font-bold hover:bg-gray-600">
                  Save to Browser Vault (WebAuthn)
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {mode === 'vault' && (
        <section className="w-full max-w-xl bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-xl text-center">
            <h2 className="text-xl font-semibold mb-4 text-green-400">Browser Vault</h2>
            {hasVaultItem ? (
                <div className="space-y-4">
                    <p className="text-gray-400 text-sm">A file is secured with your Passkey.</p>
                    <div className="p-4 bg-gray-900 rounded border border-gray-700 text-xs text-gray-400 font-mono text-left">
                        <p>Status: <span className={status.startsWith('Error') || status.startsWith('Unlock Failed') ? 'text-red-500' : 'text-yellow-500'}>{status}</span></p>
                    </div>
                    <button onClick={handleOpenVault} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg transition">
                        Authenticate & Unlock
                    </button>
                    {downloadLink && (
                        <a href={downloadLink.url} download={downloadLink.name} className="block mt-4 w-full text-center px-6 py-3 bg-blue-500 text-white rounded font-bold hover:bg-blue-400">
                           Download Unlocked File
                        </a>
                    )}
                </div>
            ) : (
                <p className="text-gray-500">Vault is empty.</p>
            )}
        </section>
      )}
    </div>
  );
}

export default App;