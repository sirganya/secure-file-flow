# Secure File Courier - System Architecture & Security Model

## 1. Core Philosophy: "Trustless Courier"
The system operates on a "Blind Drop" principle. The server acts as a temporary courier that:
- Never sees the unencrypted file.
- Never sees the decryption keys.
- Deletes the encrypted payload immediately after delivery.

## 2. Ephemeral Hybrid Encryption Protocol
To achieve the trustless property, we use a custom handshake:

1.  **Minting (Sender):** 
    - Server holds the file temporarily (in RAM/KV) associated with a `ticket_id`.
    - Sender shares `ticket_id` via QR Code (out-of-band).

2.  **Claiming (Receiver):**
    - Receiver generates an ephemeral `RSA-OAEP` KeyPair in the browser.
    - Receiver sends `ticket_id` + `Public Key` to the server.

3.  **The Handoff (Server):**
    - Server generates a random ephemeral `AES-GCM` key.
    - Encrypts the file with the `AES` key.
    - Wraps (encrypts) the `AES` key with the Receiver's `Public Key`.
    - Returns `{ EncryptedFile, WrappedKey, IV }`.
    - **CRITICAL:** Server deletes the file and all keys from memory immediately.

4.  **Decryption (Receiver):**
    - Receiver unwraps the `AES` key using their private `RSA` key.
    - Decrypts the file locally.

## 3. Secure Browser Vault (WebAuthn Persistence)
Since the file is ephemeral, we offer a "Secure Save" using the browser's IndexedDB protected by biometric authentication (WebAuthn).

### The "Signature Workaround" for Key Derivation
Standard WebAuthn does not provide encryption keys, only signatures. We derive an encryption key from a signature to "unlock" the vault.

1.  **Key Gen:** User authenticates (TouchID/FaceID) to sign a static challenge string (`"secure-file-flow-static-challenge-v1"`).
2.  **Derivation:** The resulting **Signature** (bytes) is used as the key material for `PBKDF2`.
3.  **Encryption:** We derive an `AES-GCM` key from `PBKDF2` to encrypt the file before storing it in IndexedDB.
4.  **Retrieval:** To unlock, the user authenticates again. If the authenticator is deterministic (returns the same signature for the same challenge), we regenerate the same AES key and decrypt the file.

**Limitation:** This relies on the authenticator producing deterministic signatures (common in Apple/YubiKey, less common in some Windows Hello implementations). The robust future-proof solution is the **WebAuthn PRF Extension**.

## 4. Project Structure (Monorepo-lite)
- `worker/`: Cloudflare Worker (Hono + TypeScript). Handles the API and ephemeral storage.
- `client/`: React + Vite + TypeScript. Handles all cryptography, UI, and WebAuthn interactions.

## 5. Security Constraints
- **Keys:** `extractable: true` is required for the ephemeral keys to be used in `wrapKey`, but they never leave the client memory unencrypted.
- **Storage:** No unencrypted data is ever written to disk (localStorage/Cookies).
- **Transport:** All transfers must occur over HTTPS to prevent MITM attacks swapping the Public Keys.
