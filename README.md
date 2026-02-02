# Shawdow Yield - https://youtu.be/IUGF6dpyz-Q

Privacy-preserving yield protocol powered by Arcium MPC. Deposit from any wallet, withdraw to any wallet using only a cryptographic secret.

## Test Status

| Environment | Tests | Status |
|-------------|-------|--------|
| Localnet | 9/9 | Passing |
| Devnet | 14/14 | Passing |

## Overview

Ghost Pool breaks the on-chain link between deposit and withdrawal addresses while earning yield on Kamino:

```
Wallet A deposits 1000 USDC + SHA256(secret)
            ↓
    [Arcium MPC Network]
    Encrypted state - no single party can decrypt
            ↓
    Pool → Kamino → Yield
            ↓
Wallet B withdraws with SHA256(secret) → 1000 USDC + Yield

On-chain: Wallet A deposited, Wallet B withdrew
Hidden: A and B are the same person
```

## Architecture

| Component | Description |
|-----------|-------------|
| Ghost Pool Program | Anchor program with Arcium CPI for encrypted state |
| MPC Circuits | 7 Arcis circuits for deposit, withdrawal, yield tracking |
| Kamino Integration | Yield generation via Kamino reserves |
| Frontend | React app with x25519 encryption |

## MPC Circuits

| Circuit | Purpose |
|---------|---------|
| `init_pool_state` | Initialize encrypted pool state |
| `process_deposit` | Store encrypted deposit with password hash |
| `check_investment_needed` | Threshold check for Kamino investment |
| `record_investment` | Track Kamino investment in encrypted state |
| `record_yield` | O(1) lazy yield accumulation |
| `authorize_withdrawal` | Password verification via MPC comparison |
| `process_withdrawal` | Update state post-withdrawal |

## Cryptographic Protocol

**Key Exchange**: x25519 Diffie-Hellman with MXE public key

```
user_sk = x25519.generateSecretKey()
mxe_pk = getMXEPublicKey(program_id)  // From MXE account at offset 95
shared_secret = x25519.getSharedSecret(user_sk, mxe_pk)
```

**Encryption**: Rescue Prime cipher (MPC-friendly)

```
password_hash = SHA256(user_password)[0:16]  // Truncate to u128
cipher = RescueCipher(shared_secret)
encrypted_hash = cipher.encrypt([password_hash], nonce)
```

**Yield Distribution**: O(1) lazy accumulation

```rust
// On yield event:
yield_per_share += (yield_amount * 1e9) / total_deposited;

// On withdrawal (lazy evaluation):
accrued_yield = (principal * (yield_per_share - checkpoint)) / 1e9;
```

## Program IDs (Devnet)

| Program | Address |
|---------|---------|
| Ghost Pool | `JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3` |
| Kamino Integration | `B4HMWFxLVtCiv9cxbsqRo77LGdcZa6P1tt8YcmEWNwC2` |

## Quick Start

```bash
# Install Arcium CLI
curl -sSfL https://install.arcium.com | bash
arcup install 0.6.3

# Build
yarn install
arcium build

# Test (localnet)
arcium test

# Test (devnet)
ARCIUM_CLUSTER_OFFSET=456 arcium test --cluster devnet
```

## Project Structure

```
├── programs/
│   ├── ghost_pool/           # Main Anchor program
│   └── kamino_integration/   # Kamino CPI wrapper
├── encrypted-ixs/            # Arcis MPC circuits
├── tests/                    # Localnet + devnet tests
├── scripts/                  # Deployment utilities
└── frontend/                 # React application
```

## Tech Stack

| Component | Version |
|-----------|---------|
| Anchor | 0.30.1 |
| Arcium | 0.6.3 |
| Arcis | 0.6.3 |
| x25519 | noble/curves |
| Rescue Prime | MPC cipher |

---

Built with Arcium MPC.
