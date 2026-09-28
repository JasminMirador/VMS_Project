import forge from "node-forge";

export async function encryptPassword(password, pubKeyStr) {
  if (!pubKeyStr) {
      throw new Error("Public key is missing");
  }
  
  const publicKey = forge.pki.publicKeyFromPem(pubKeyStr);
  
  // Use RSA-OAEP with SHA-256 for both the main hash and MGF1
  const encrypted = publicKey.encrypt(password, "RSA-OAEP", {
    md: forge.md.sha256.create(),
    mgf1: {
      md: forge.md.sha256.create()
    }
  });
  
  // Return standard Base64 string
  return forge.util.encode64(encrypted);
}

let cachedPublicKey = null;

export async function getPublicKey(apiBase = "") {
  if (cachedPublicKey) return cachedPublicKey;
  
  try {
    const res = await fetch(`${apiBase}/api/auth/public-key`);
    if (!res.ok) throw new Error("Failed to fetch public key");
    const data = await res.json();
    cachedPublicKey = data.public_key;
    return cachedPublicKey;
  } catch (err) {
    console.error("Error fetching public key:", err);
    throw err;
  }
}
