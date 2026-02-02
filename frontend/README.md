# Ghost Pool Frontend

React frontend for Ghost Pool — privacy-preserving yield protocol with x25519 encryption and MPC-verified withdrawals.

## Features

- **Wallet Adapter Integration** — Phantom, Solflare, Backpack support
- **Client-Side Encryption** — x25519 ECDH + Rescue Prime cipher
- **MPC Transaction Builder** — Arcium computation queue integration
- **Real-Time Pool Stats** — TVL, yield rates, position tracking

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| React | 18.2 | UI framework |
| TypeScript | 5.6 | Type safety |
| Vite | 6.0 | Build tooling |
| TailwindCSS | 3.4 | Styling |
| Radix UI | — | Accessible components |
| @arcium-hq/client | 0.6.5 | MPC encryption |
| @noble/curves | 2.0 | x25519 implementation |
| @solana/web3.js | 1.91 | Solana RPC |
| TanStack Query | 5.24 | Data fetching |
| Zustand | 4.5 | State management |

## Project Structure

```
src/
├── App.tsx                 # Router + providers
├── main.tsx               # Entry point + polyfills
├── components/
│   └── ui/                # Radix primitives (Button, Dialog, etc.)
├── config/
│   └── constants.ts       # Program IDs, pool addresses
├── hooks/
│   ├── useGhostPool.ts    # Program interaction hook
│   ├── useEncryption.ts   # x25519 + Rescue cipher
│   └── useWallet.ts       # Wallet adapter wrapper
├── lib/
│   ├── encryption.ts      # Password hashing, key derivation
│   ├── arcium.ts          # MXE public key fetching
│   └── utils.ts           # BN conversions, formatting
├── mutations/
│   ├── deposit.ts         # Deposit transaction builder
│   └── withdraw.ts        # Withdrawal transaction builder
├── pages/
│   ├── Deposit.tsx        # Deposit flow UI
│   ├── Withdraw.tsx       # Withdrawal flow UI
│   └── Dashboard.tsx      # Pool stats + positions
└── styles/
    └── globals.css        # Tailwind base
```

## Cryptographic Flow

### Deposit

```typescript
// 1. Hash password
const passwordHash = SHA256(password).slice(0, 16);  // u128

// 2. Generate ephemeral x25519 keypair
const userSk = x25519.utils.randomSecretKey();
const userPk = x25519.getPublicKey(userSk);

// 3. Derive shared secret with MXE
const mxePk = await getMXEPublicKey(provider, programId);
const sharedSecret = x25519.getSharedSecret(userSk, mxePk);

// 4. Encrypt with Rescue Prime
const cipher = new RescueCipher(sharedSecret);
const nonce = randomBytes(16);
const encryptedHash = cipher.encrypt([passwordHash], nonce);

// 5. Build transaction
const tx = program.methods.deposit(
  computationOffset,
  amount,
  encryptedHash,
  userPk,
  nonce
);
```

### Withdrawal

```typescript
// Same encryption flow, different circuit
const tx = program.methods.withdraw(
  computationOffset,
  amount,
  encryptedHash,  // Same password, new ephemeral key
  userPk,
  nonce
);

// MPC verifies: decrypt(stored_hash) == decrypt(provided_hash)
// If match: callback transfers USDC
```

## Configuration

### Environment Variables

```env
VITE_RPC_URL=https://api.devnet.solana.com
VITE_GHOST_POOL_PROGRAM_ID=JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3
```

### Pool Addresses (`src/config/constants.ts`)

```typescript
export const GHOST_POOL_PROGRAM_ID = new PublicKey(
  'JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3'
);
export const USDC_MINT = new PublicKey(
  '6Rne9h8p8maqR1Ts5SaCcRE9eaxyVXBfRs8zH62goDSo'
);
export const GHOST_POOL_PDA = new PublicKey(
  '5jmBRB2QSCkDWxUwGeeYSKM64t79FJcNawHKv2ACWR7m'
);
export const VAULT_PDA = new PublicKey(
  'AHKERJBbWGg64ZappKcmUcTzRjuP6k8NKTwS6wezVTAw'
);
```

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (hot reload)
pnpm dev

# Type checking
pnpm tsc --noEmit

# Lint
pnpm lint

# Production build
pnpm build

# Preview production
pnpm preview
```

## Key Implementation Details

### MXE Public Key Extraction

```typescript
// MXE account stores x25519 public key at byte offset 95
const mxeAccount = getMXEAccAddress(programId);
const accountInfo = await connection.getAccountInfo(mxeAccount);
const mxePk = accountInfo.data.slice(95, 127);  // 32 bytes
```

### Computation Offset

```typescript
// Random u64 to uniquely identify MPC computation
const computationOffset = new BN(randomBytes(8), 'hex');
const computationAccount = getComputationAccAddress(
  CLUSTER_OFFSET,  // 456 for devnet
  computationOffset
);
```

### Awaiting MPC Callback

```typescript
const txSig = await program.methods.deposit(...).rpc();
// Transaction queues computation, doesn't complete it

// Wait for MPC nodes to process and callback
const finalizeSig = await awaitComputationFinalization(
  provider,
  computationOffset,
  programId,
  'confirmed'
);
// Now deposit is complete
```

## Build Output

```bash
pnpm build
# Outputs to dist/
# Deploy to Vercel, Netlify, or any static host
```

---

Part of the [Ghost Pool](../shadowyield) protocol.
