# Ghost Pool Scripts

Utility scripts for managing and testing the Ghost Pool deployment.

## Scripts Overview

### Core Operations

| Script | Purpose |
|--------|---------|
| `init-comp-defs.ts` | Initialize all 7 computation definitions |
| `init-pool-for-frontend.ts` | Initialize pool for frontend testing |
| `trigger-investment.ts` | Trigger investment threshold check |
| `upload-circuits.ts` | Upload circuits to Arcium |
| `upload-to-pinata.ts` | Upload circuits to IPFS via Pinata |

### Testing

| Script | Purpose |
|--------|---------|
| `test-existing-pool.ts` | Test deposit/withdraw on existing pool |
| `test-deposit-withdraw.ts` | Full deposit + withdraw test |
| `test-deposit.ts` | Single deposit test |
| `test-full-flow.ts` | Complete integration test |
| `test-kamino-integration.ts` | Kamino reserve integration test |
| `test-init-callback.ts` | Test MPC callback handling |
| `test-cipher-consistency.ts` | Verify Rescue cipher compatibility |

### Verification & Diagnostics

| Script | Purpose |
|--------|---------|
| `verify-devnet.ts` | Verify devnet deployment status |
| `verify-deployment.ts` | Verify program deployment |
| `check-circuits.ts` | Monitor circuit deployment status |
| `check-new-comp-defs.ts` | Check computation definition accounts |

### Kamino Integration

| Script | Purpose |
|--------|---------|
| `find-kamino-reserves.ts` | Find available Kamino reserves |
| `find-usdc-reserve.ts` | Find USDC-specific Kamino reserve |
| `init-check-investment-comp-def.ts` | Initialize investment check circuit |

### CompDef Management

| Script | Purpose |
|--------|---------|
| `init-offchain-comp-defs.ts` | Initialize comp defs with offchain circuits |
| `reinit-comp-defs-offchain.ts` | Reinitialize comp defs after circuit update |

## Usage

### Check Circuit Status

```bash
yarn check-circuits
# or
npx ts-node scripts/check-circuits.ts
```

Shows deployment status for all 7 MPC circuits.

### Verify Devnet Deployment

```bash
ARCIUM_CLUSTER_OFFSET=456 \
ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
ANCHOR_WALLET="~/.config/solana/id.json" \
npx ts-node scripts/verify-devnet.ts
```

Checks:
- Program deployment
- MXE account
- Pool PDA
- Vault balance
- Comp def accounts

### Test Existing Pool

```bash
ARCIUM_CLUSTER_OFFSET=456 \
ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
ANCHOR_WALLET="~/.config/solana/id.json" \
npx ts-node scripts/test-existing-pool.ts
```

Tests deposit and withdrawal on the existing devnet pool.

### Initialize Pool for Frontend

```bash
npx ts-node scripts/init-pool-for-frontend.ts
```

Sets up a fresh pool instance for frontend testing.

### Trigger Investment

```bash
npx ts-node scripts/trigger-investment.ts
```

Triggers the investment threshold check to move funds to Kamino.

## Environment Variables

All scripts require:

```bash
ARCIUM_CLUSTER_OFFSET=456          # Devnet cluster
ANCHOR_PROVIDER_URL="..."          # RPC endpoint
ANCHOR_WALLET="~/.config/solana/id.json"  # Keypair path
```
