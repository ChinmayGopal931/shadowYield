/**
 * Test RescueCipher consistency:
 * Does encrypting [a] produce the same ciphertext[0] as encrypting [a, b]?
 */
import {
  x25519,
  RescueCipher,
  deserializeLE,
} from '@arcium-hq/client';
import { createHash, randomBytes } from 'crypto';

// Frontend-style password hash
function hashPasswordFrontendStyle(password: string): Uint8Array {
  const hash = createHash('sha256').update(password).digest();
  return new Uint8Array(hash.slice(0, 16));
}

function deserializeLECustom(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  return value;
}

async function main() {
  console.log('=== RescueCipher Consistency Test ===\n');

  // Test password
  const TEST_PASSWORD = 'testpassword123';
  const passwordHash = hashPasswordFrontendStyle(TEST_PASSWORD);
  const passwordHashBigInt = deserializeLECustom(passwordHash);
  console.log('Password hash (bigint):', passwordHashBigInt.toString(16));

  // Mock MXE public key (32 bytes)
  const mxePublicKey = randomBytes(32);

  // Generate X25519 keypair
  const userPrivateKey = x25519.utils.randomSecretKey();
  const userPublicKey = x25519.getPublicKey(userPrivateKey);
  const sharedSecret = x25519.getSharedSecret(userPrivateKey, mxePublicKey);
  console.log('Shared secret:', Buffer.from(sharedSecret).toString('hex'));

  // Same nonce for both tests
  const nonceBytes = randomBytes(16);
  console.log('Nonce:', Buffer.from(nonceBytes).toString('hex'));

  // Create cipher
  const cipher = new RescueCipher(sharedSecret);

  // Test 1: Encrypt just the password hash
  const plaintext1 = [passwordHashBigInt];
  const ciphertext1 = cipher.encrypt(plaintext1, new Uint8Array(nonceBytes));
  console.log('\n--- Test 1: Encrypt [passwordHash] ---');
  console.log('Plaintext:', plaintext1.map(p => p.toString(16)));
  console.log('Ciphertext length:', ciphertext1.length);
  console.log('Ciphertext[0]:', Buffer.from(ciphertext1[0]).toString('hex'));

  // Test 2: Encrypt password hash + amount (like test-full-flow.ts)
  const amount = BigInt(10_000_000);  // 10 USDC
  const plaintext2 = [passwordHashBigInt, amount];

  // Need a fresh cipher because the internal state changes
  const cipher2 = new RescueCipher(sharedSecret);
  const ciphertext2 = cipher2.encrypt(plaintext2, new Uint8Array(nonceBytes));
  console.log('\n--- Test 2: Encrypt [passwordHash, amount] ---');
  console.log('Plaintext:', plaintext2.map(p => p.toString(16)));
  console.log('Ciphertext length:', ciphertext2.length);
  console.log('Ciphertext[0]:', Buffer.from(ciphertext2[0]).toString('hex'));
  console.log('Ciphertext[1]:', Buffer.from(ciphertext2[1]).toString('hex'));

  // Compare
  const match = Buffer.from(ciphertext1[0]).equals(Buffer.from(ciphertext2[0]));
  console.log('\n=== RESULT ===');
  console.log('Ciphertext[0] matches:', match ? '✅ YES' : '❌ NO');

  if (!match) {
    console.log('\n⚠️ The ciphertexts are DIFFERENT!');
    console.log('This means encrypting [a] produces a different result than encrypting [a, b].');
    console.log('The test-full-flow.ts encrypts [hash, amount] but the frontend only encrypts [hash].');
    console.log('This could be the cause of the withdrawal failure!');
  }

  // Test 3: What happens if we use the ciphertext from Test 2 for just the password hash?
  console.log('\n--- Additional Analysis ---');
  console.log('If the circuit expects the password hash to be encrypted as part of a 2-element array,');
  console.log('but we only encrypt 1 element, the decryption would fail.');

  // Let's also check the nonce impact
  console.log('\n--- Test 3: Different nonce, same plaintext ---');
  const nonceBytes2 = randomBytes(16);
  const cipher3 = new RescueCipher(sharedSecret);
  const ciphertext3 = cipher3.encrypt(plaintext1, new Uint8Array(nonceBytes2));
  console.log('Nonce 2:', Buffer.from(nonceBytes2).toString('hex'));
  console.log('Ciphertext[0] with nonce2:', Buffer.from(ciphertext3[0]).toString('hex'));
  console.log('This should decrypt to the same value by MPC.');
}

main().catch(console.error);
