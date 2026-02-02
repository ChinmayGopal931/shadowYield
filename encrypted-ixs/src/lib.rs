use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// Maximum number of concurrent depositors
    /// Reduced to 2 to fit MPC callback size limit (~500 bytes)
    /// 2 deposits × 4 FE + 5 globals = 13 FE = 416 bytes
    pub const MAX_DEPOSITS: usize = 2;

    /// Individual deposit entry in the private ledger
    #[derive(Copy, Clone)]
    pub struct DepositEntry {
        pub password_hash: u128,        // Hash of user's secret password
        pub principal: u64,              // Original deposit amount (6 decimals)
        pub last_yield_checkpoint: u64,  // Yield index when last updated (scaled by 1e9)
        pub is_active: bool,             // Whether this slot is occupied
    }

    /// Private pool state (MXE-only, never revealed)
    /// Size: 2 deposits × 4 FE + 5 globals = 13 FE = 416 bytes
    #[derive(Copy, Clone)]
    pub struct PoolState {
        pub deposits: [DepositEntry; MAX_DEPOSITS],
        pub total_deposited: u64,
        pub total_invested: u64,
        pub pending_deposits: u64,
        pub yield_per_share: u64,        // Cumulative yield per deposited token (scaled by 1e9)
        pub deposit_count: u8,
    }

    // Note: DepositRequest and WithdrawalRequest are not needed as structs
    // because password_hash is encrypted via Enc<Shared, u128> and amount is plaintext

    /// Investment decision (revealed to trigger on-chain action)
    #[derive(Copy, Clone)]
    pub struct InvestmentDecision {
        pub should_invest: bool,
        pub amount_to_invest: u64,
    }

    /// Withdrawal authorization (revealed to trigger transfer)
    #[derive(Copy, Clone)]
    pub struct WithdrawalAuth {
        pub authorized: bool,
        pub amount: u64,
        pub found_idx: u8,
    }

    /// Initialize empty pool state
    /// Returns EncData to minimize callback size (no pubkey/nonce overhead)
    #[instruction]
    pub fn init_pool_state(mxe: Mxe) -> EncData<PoolState> {
        let empty_entry = DepositEntry {
            password_hash: 0u128,
            principal: 0,
            last_yield_checkpoint: 0,
            is_active: false,
        };

        let initial_state = PoolState {
            deposits: [empty_entry; MAX_DEPOSITS],
            total_deposited: 0,
            total_invested: 0,
            pending_deposits: 0,
            yield_per_share: 0,
            deposit_count: 0,
        };

        mxe.from_arcis(initial_state).data
    }

    /// Process a user deposit
    /// Password hash is encrypted, amount is plaintext (visible in token transfer anyway)
    /// Returns EncData to minimize callback size
    #[instruction]
    pub fn process_deposit(
        password_hash_ctxt: Enc<Shared, u128>,
        amount: u64,
        state_ctxt: Enc<Mxe, PoolState>,
    ) -> EncData<PoolState> {
        let password_hash = password_hash_ctxt.to_arcis();
        let mut state = state_ctxt.to_arcis();

        // Find first inactive slot
        let mut found_slot = false;
        let mut slot_idx = 0u8;

        for i in 0..MAX_DEPOSITS {
            if !state.deposits[i].is_active && !found_slot {
                found_slot = true;
                slot_idx = i as u8;
            }
        }

        // Add deposit if slot found
        if found_slot {
            let idx = slot_idx as usize;
            state.deposits[idx] = DepositEntry {
                password_hash,
                principal: amount,
                last_yield_checkpoint: state.yield_per_share,
                is_active: true,
            };
            state.total_deposited += amount;
            state.pending_deposits += amount;
            state.deposit_count += 1;
        }

        state_ctxt.owner.from_arcis(state).data
    }

    /// Check if investment threshold reached
    #[instruction]
    pub fn check_investment_needed(
        state_ctxt: Enc<Mxe, PoolState>,
        threshold: u64,
    ) -> InvestmentDecision {
        let state = state_ctxt.to_arcis();

        let should_invest = state.pending_deposits >= threshold;

        InvestmentDecision {
            should_invest,
            amount_to_invest: if should_invest { state.pending_deposits } else { 0 },
        }.reveal()
    }

    /// Record investment in Kamino
    /// Returns EncData to minimize callback size
    #[instruction]
    pub fn record_investment(
        state_ctxt: Enc<Mxe, PoolState>,
        amount: u64,
    ) -> EncData<PoolState> {
        let mut state = state_ctxt.to_arcis();

        state.total_invested += amount;
        state.pending_deposits -= amount;

        state_ctxt.owner.from_arcis(state).data
    }

    /// Record yield and distribute proportionally (lazy accumulation)
    /// This now uses O(1) complexity instead of O(n) - no loop needed!
    /// Returns EncData to minimize callback size
    #[instruction]
    pub fn record_yield(
        state_ctxt: Enc<Mxe, PoolState>,
        yield_amount: u64,
    ) -> EncData<PoolState> {
        let mut state = state_ctxt.to_arcis();

        // Update global yield index (scaled by 1e9 for precision)
        // Users claim their proportional share when they withdraw
        if state.total_deposited > 0 {
            // Calculate yield per token: (yield_amount * 1e9) / total_deposited
            // This avoids expensive per-user calculations in MPC
            let yield_per_token = (yield_amount * 1_000_000_000) / state.total_deposited;
            state.yield_per_share += yield_per_token;
            state.total_deposited += yield_amount;
        }

        state_ctxt.owner.from_arcis(state).data
    }

    /// Authorize withdrawal by verifying password (step 1: check only)
    /// Password hash is encrypted, amount is plaintext (visible anyway)
    /// Now calculates accrued yield on-demand for the withdrawing user
    #[instruction]
    pub fn authorize_withdrawal(
        password_hash_ctxt: Enc<Shared, u128>,
        amount: u64,
        state_ctxt: Enc<Mxe, PoolState>,
    ) -> WithdrawalAuth {
        let password_hash = password_hash_ctxt.to_arcis();
        let state = state_ctxt.to_arcis();

        // Find matching password (O(n) search)
        let mut found = false;
        let mut found_idx = 0u8;
        let mut actual_balance = 0u64;

        for i in 0..MAX_DEPOSITS {
            let matches = state.deposits[i].is_active &&
                         state.deposits[i].password_hash == password_hash;

            if matches && !found {
                found = true;
                found_idx = i as u8;

                // Calculate accrued yield ONLY for this user (lazy evaluation)
                let principal = state.deposits[i].principal;
                let checkpoint = state.deposits[i].last_yield_checkpoint;
                let yield_delta = state.yield_per_share - checkpoint;

                // Unscale: (principal * yield_delta) / 1e9
                let accrued_yield = (principal * yield_delta) / 1_000_000_000;
                actual_balance = principal + accrued_yield;
            }
        }

        // Check sufficient balance (including accrued yield)
        let sufficient = found && actual_balance >= amount;

        WithdrawalAuth {
            authorized: sufficient,
            amount: if sufficient { amount } else { 0 },
            found_idx,
        }.reveal()
    }

    /// Update state after successful withdrawal (step 2: update)
    /// Note: This should only be called after authorize_withdrawal returns true
    /// Returns EncData to minimize callback size
    #[instruction]
    pub fn process_withdrawal(
        state_ctxt: Enc<Mxe, PoolState>,
        idx: u8,
        amount: u64,
    ) -> EncData<PoolState> {
        let mut state = state_ctxt.to_arcis();

        // Assume idx is valid (checked by authorize_withdrawal)
        // Update the deposit entry
        for i in 0..MAX_DEPOSITS {
            if i == idx as usize {
                // Calculate current balance with accrued yield
                let principal = state.deposits[i].principal;
                let checkpoint = state.deposits[i].last_yield_checkpoint;
                let yield_delta = state.yield_per_share - checkpoint;
                let accrued_yield = (principal * yield_delta) / 1_000_000_000;
                let current_balance = principal + accrued_yield;

                // Deduct withdrawal amount
                let new_balance = current_balance - amount;

                // Update principal and checkpoint
                state.deposits[i].principal = new_balance;
                state.deposits[i].last_yield_checkpoint = state.yield_per_share;

                // Mark inactive if balance is now zero
                let is_zero = new_balance == 0;
                if is_zero {
                    state.deposits[i].is_active = false;
                    state.deposit_count -= 1;
                }
            }
        }

        state.total_deposited -= amount;

        state_ctxt.owner.from_arcis(state).data
    }
}
