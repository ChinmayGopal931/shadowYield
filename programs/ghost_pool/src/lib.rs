use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer, transfer};

// Circuit URLs on IPFS (v4 - 2 deposits, EncData output, fits callback limit)
const INIT_POOL_STATE_URL: &str = "https://gateway.pinata.cloud/ipfs/bafkreig7wc7tesauxb2hbrr5ypbej7z3yoblrzm6iziuvxnybmlz7oidbq";
const PROCESS_DEPOSIT_URL: &str = "https://gateway.pinata.cloud/ipfs/bafybeigw3az26fvgrr6jlgjxkcbbfx26i2tsqwp3m3clmfzcxphlytgf34";
const CHECK_INVESTMENT_NEEDED_URL: &str = "https://gateway.pinata.cloud/ipfs/bafkreickglqz4lr4p5dihj55iobzbmkedqcdxkjlffeu7xwi75t7lf4pl4";
const RECORD_INVESTMENT_URL: &str = "https://gateway.pinata.cloud/ipfs/bafybeiaznsrclf6sy6e2iiwwnubmzx57tdysu3syvpbm2nsa2zsdj2uljq";
const RECORD_YIELD_URL: &str = "https://gateway.pinata.cloud/ipfs/bafybeia3up67csa37rbv3fxzgk3zpcja6ow2la5kb6jo43qancffgn5k54";
const AUTHORIZE_WITHDRAWAL_URL: &str = "https://gateway.pinata.cloud/ipfs/bafybeidkmrkn4r6mgwquuwqkhxbw66nzu6y2vgojbqpyan5ln7nhcohv2q";
const PROCESS_WITHDRAWAL_URL: &str = "https://gateway.pinata.cloud/ipfs/bafybeihqlyozdkqbwv7vy2cfdkzdtqb4yxwf4jtzoucjkof3pabzbh36c4";

const COMP_DEF_OFFSET_INIT_POOL: u32 = comp_def_offset("init_pool_state");
const COMP_DEF_OFFSET_DEPOSIT: u32 = comp_def_offset("process_deposit");
const COMP_DEF_OFFSET_CHECK_INVESTMENT: u32 = comp_def_offset("check_investment_needed");
const COMP_DEF_OFFSET_RECORD_INVESTMENT: u32 = comp_def_offset("record_investment");
const COMP_DEF_OFFSET_RECORD_YIELD: u32 = comp_def_offset("record_yield");
const COMP_DEF_OFFSET_AUTHORIZE_WITHDRAWAL: u32 = comp_def_offset("authorize_withdrawal");
const COMP_DEF_OFFSET_PROCESS_WITHDRAWAL: u32 = comp_def_offset("process_withdrawal");

// Mock Kamino Lending program ID (devnet) - use for testing
pub const KAMINO_LENDING_PROGRAM_ID: Pubkey = pubkey!("B4HMWFxLVtCiv9cxbsqRo77LGdcZa6P1tt8YcmEWNwC2");

// Optimized version with lazy yield accumulation
declare_id!("JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3");

#[arcium_program]
pub mod ghost_pool {
    use super::*;

    /// Initialize computation definitions for all circuits
    pub fn init_pool_comp_def(ctx: Context<InitPoolCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: INIT_POOL_STATE_URL.to_string(),
                hash: circuit_hash!("init_pool_state"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_deposit_comp_def(ctx: Context<InitDepositCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: PROCESS_DEPOSIT_URL.to_string(),
                hash: circuit_hash!("process_deposit"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_check_investment_needed_comp_def(ctx: Context<InitCheckInvestmentNeededCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: CHECK_INVESTMENT_NEEDED_URL.to_string(),
                hash: circuit_hash!("check_investment_needed"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_record_investment_comp_def(ctx: Context<InitRecordInvestmentCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: RECORD_INVESTMENT_URL.to_string(),
                hash: circuit_hash!("record_investment"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_record_yield_comp_def(ctx: Context<InitRecordYieldCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: RECORD_YIELD_URL.to_string(),
                hash: circuit_hash!("record_yield"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_authorize_withdrawal_comp_def(ctx: Context<InitAuthorizeWithdrawalCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: AUTHORIZE_WITHDRAWAL_URL.to_string(),
                hash: circuit_hash!("authorize_withdrawal"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_process_withdrawal_comp_def(ctx: Context<InitProcessWithdrawalCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: PROCESS_WITHDRAWAL_URL.to_string(),
                hash: circuit_hash!("process_withdrawal"),
            })),
            None,
        )?;
        Ok(())
    }

    /// Initialize the Ghost Pool
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        computation_offset: u64,
        nonce: u128,
        investment_threshold: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.ghost_pool;
        pool.bump = ctx.bumps.ghost_pool;
        pool.authority = ctx.accounts.authority.key();
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.vault_bump = ctx.bumps.vault;
        pool.investment_threshold = investment_threshold;
        pool.last_investment_time = 0;
        pool.state_nonce = nonce;
        // Initialize encrypted_state with zeros (avoid large stack array)
        // v4: 13 field elements (2 deposits × 4 FE + 5 globals = 416 bytes)
        for i in 0..13 {
            pool.encrypted_state[i] = [0u8; 32];
        }
        pool.total_deposits = 0;
        pool.total_withdrawals = 0;
        pool.total_invested = 0;
        pool.pending_investment_amount = 0;
        pool.collateral_token_account = Pubkey::default();
        pool.total_collateral_received = 0;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .plaintext_u128(nonce)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitPoolStateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.ghost_pool.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_pool_state")]
    pub fn init_pool_state_callback(
        ctx: Context<InitPoolStateCallback>,
        output: SignedComputationOutputs<InitPoolStateOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitPoolStateOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let pool = &mut ctx.accounts.ghost_pool;
        // EncData output: only ciphertexts, no nonce (nonce managed by MXE)
        pool.encrypted_state = o.ciphertexts;
        // CRITICAL: MXE increments nonce by 1 when re-encrypting outputs
        // We must update state_nonce to match for future operations
        pool.state_nonce = pool.state_nonce.wrapping_add(1);

        let pool_key = pool.key();
        let authority_key = pool.authority;

        emit!(PoolInitializedEvent {
            pool: pool_key,
            authority: authority_key,
        });

        Ok(())
    }

    /// User deposits USDC into the pool
    pub fn deposit(
        ctx: Context<Deposit>,
        computation_offset: u64,
        amount: u64,
        encrypted_password_hash: [u8; 32],  // Will be interpreted as u128
        user_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Transfer USDC from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc_token.to_account_info(),
            to: ctx.accounts.vault_usdc_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer(cpi_ctx, amount)?;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Convert encrypted_password_hash to u128
        let mut hash_bytes = [0u8; 16];
        hash_bytes.copy_from_slice(&encrypted_password_hash[..16]);
        let _password_hash_u128 = u128::from_le_bytes(hash_bytes);

        // Queue MPC computation
        let args = ArgBuilder::new()
            .x25519_pubkey(user_pubkey)
            .plaintext_u128(nonce)
            .encrypted_u128(encrypted_password_hash)
            .plaintext_u64(amount)
            .plaintext_u128(ctx.accounts.ghost_pool.state_nonce)
            .account(
                ctx.accounts.ghost_pool.key(),
                106, // Offset to encrypted_state (8 disc + 1 bump + 32 auth + 32 mint + 1 vault_bump + 8 threshold + 8 time + 16 nonce = 106)
                416, // 13 * 32 bytes (2 deposits, v4)
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ProcessDepositCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.ghost_pool.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "process_deposit")]
    pub fn process_deposit_callback(
        ctx: Context<ProcessDepositCallback>,
        output: SignedComputationOutputs<ProcessDepositOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ProcessDepositOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let pool = &mut ctx.accounts.ghost_pool;
        // EncData output: only ciphertexts, no nonce (nonce managed by MXE)
        pool.encrypted_state = o.ciphertexts;
        // CRITICAL: MXE increments nonce by 1 when re-encrypting outputs
        pool.state_nonce = pool.state_nonce.wrapping_add(1);
        pool.total_deposits += 1;

        let pool_key = pool.key();
        let deposit_count = pool.total_deposits;

        emit!(DepositEvent {
            pool: pool_key,
            deposit_count,
        });

        Ok(())
    }

    /// Check if investment threshold reached and invest in Kamino
    pub fn check_and_invest(
        ctx: Context<CheckAndInvest>,
        computation_offset: u64,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let threshold = ctx.accounts.ghost_pool.investment_threshold;

        let args = ArgBuilder::new()
            .plaintext_u128(ctx.accounts.ghost_pool.state_nonce)
            .account(
                ctx.accounts.ghost_pool.key(),
                106, // Offset to encrypted_state
                416, // 13 * 32 bytes (2 deposits, v4)
            )
            .plaintext_u64(threshold)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CheckInvestmentNeededCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.ghost_pool.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "check_investment_needed")]
    pub fn check_investment_needed_callback(
        ctx: Context<CheckInvestmentNeededCallback>,
        output: SignedComputationOutputs<CheckInvestmentNeededOutput>,
    ) -> Result<()> {
        let decision = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckInvestmentNeededOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // If should invest, store the pending investment amount
        // Actual Kamino CPI happens in a separate instruction
        if decision.field_0 && decision.field_1 > 0 {
            msg!("Investment approved by MPC: {} USDC", decision.field_1);

            let pool = &mut ctx.accounts.ghost_pool;
            pool.pending_investment_amount = decision.field_1;

            emit!(InvestmentApprovedEvent {
                pool: pool.key(),
                amount: decision.field_1,
            });
        } else {
            msg!("Investment not needed at this time");
        }

        Ok(())
    }

    /// Withdraw USDC from the pool (with password verification)
    pub fn withdraw(
        ctx: Context<Withdraw>,
        computation_offset: u64,
        amount: u64,
        encrypted_password_hash: [u8; 32],
        user_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(user_pubkey)
            .plaintext_u128(nonce)
            .encrypted_u128(encrypted_password_hash)
            .plaintext_u64(amount)
            .plaintext_u128(ctx.accounts.ghost_pool.state_nonce)
            .account(
                ctx.accounts.ghost_pool.key(),
                106, // Offset to encrypted_state
                416, // 13 * 32 bytes (2 deposits, v4)
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![AuthorizeWithdrawalCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.ghost_pool.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.vault.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.user_token_account.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.token_program.key(),
                        is_writable: false,
                    },
                ],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "authorize_withdrawal")]
    pub fn authorize_withdrawal_callback(
        ctx: Context<AuthorizeWithdrawalCallback>,
        output: SignedComputationOutputs<AuthorizeWithdrawalOutput>,
    ) -> Result<()> {
        let auth = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(AuthorizeWithdrawalOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Store authorization result temporarily (in a real implementation,
        // you'd need a separate account to store this between instructions)
        // For now, we'll just emit an event if authorized
        if auth.field_0 && auth.field_1 > 0 {
            let amount = auth.field_1;
            msg!("Withdrawal authorized for amount: {} at idx: {}", amount, auth.field_2);

            // Get pool info for PDA signer
            let pool = &mut ctx.accounts.ghost_pool;
            let pool_key = pool.key();
            let pool_bump = pool.bump;
            let authority = pool.authority;

            // Transfer USDC from vault to user
            let seeds = &[
                b"ghost_pool",
                authority.as_ref(),
                &[pool_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = anchor_spl::token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: pool.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
            anchor_spl::token::transfer(cpi_ctx, amount)?;

            msg!("Transferred {} USDC to user", amount);

            // Increment withdrawal counter
            pool.total_withdrawals += 1;

            emit!(WithdrawalAuthorizedEvent {
                pool: pool_key,
                amount,
                idx: auth.field_2,
            });
        } else {
            return Err(ErrorCode::WithdrawalUnauthorized.into());
        }

        Ok(())
    }

    /// Execute Kamino deposit after MPC approval
    /// Uses Mock Kamino's deposit_reserve_liquidity instruction
    pub fn invest_in_kamino(ctx: Context<InvestInKamino>) -> Result<()> {
        let pool = &ctx.accounts.ghost_pool;
        let amount = pool.pending_investment_amount;

        require!(amount > 0, ErrorCode::NoPendingInvestment);

        msg!("Executing Mock Kamino deposit: {} USDC", amount);

        // Mock Kamino's deposit_reserve_liquidity discriminator (anchor generated)
        // sha256("global:deposit_reserve_liquidity")[0..8] = a9c91e7e06cd6644
        let discriminator: [u8; 8] = [0xa9, 0xc9, 0x1e, 0x7e, 0x06, 0xcd, 0x66, 0x44];

        let mut data = discriminator.to_vec();
        data.extend_from_slice(&amount.to_le_bytes());

        // Build account metas matching Mock Kamino's DepositReserveLiquidity struct
        let accounts = vec![
            AccountMeta::new(ctx.accounts.vault.key(), true), // owner (signer) - vault PDA signs
            AccountMeta::new_readonly(ctx.accounts.kamino_lending_market.key(), false),
            AccountMeta::new_readonly(ctx.accounts.kamino_lending_market_authority.key(), false),
            AccountMeta::new(ctx.accounts.kamino_reserve.key(), false),
            AccountMeta::new_readonly(ctx.accounts.reserve_liquidity_mint.key(), false),
            AccountMeta::new(ctx.accounts.reserve_collateral_mint.key(), false),
            AccountMeta::new(ctx.accounts.reserve_liquidity_supply.key(), false),
            AccountMeta::new(ctx.accounts.vault.key(), false), // user_liquidity (our vault is source)
            AccountMeta::new(ctx.accounts.user_destination_collateral.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        ];

        let ix = Instruction {
            program_id: KAMINO_LENDING_PROGRAM_ID,
            accounts,
            data,
        };

        // Sign with vault PDA
        let pool_key = ctx.accounts.ghost_pool.key();
        let vault_seeds = &[
            b"vault".as_ref(),
            pool_key.as_ref(),
            &[ctx.accounts.ghost_pool.vault_bump],
        ];

        invoke_signed(
            &ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.kamino_lending_market.to_account_info(),
                ctx.accounts.kamino_lending_market_authority.to_account_info(),
                ctx.accounts.kamino_reserve.to_account_info(),
                ctx.accounts.reserve_liquidity_mint.to_account_info(),
                ctx.accounts.reserve_collateral_mint.to_account_info(),
                ctx.accounts.reserve_liquidity_supply.to_account_info(),
                ctx.accounts.user_destination_collateral.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.kamino_program.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        // Update pool state
        let pool = &mut ctx.accounts.ghost_pool;
        pool.total_invested += amount;
        pool.pending_investment_amount = 0;
        pool.last_investment_time = Clock::get()?.unix_timestamp;
        pool.collateral_token_account = ctx.accounts.user_destination_collateral.key();

        emit!(InvestmentExecutedEvent {
            pool: pool.key(),
            amount,
        });

        Ok(())
    }

    /// Set the collateral token account for receiving Kamino cTokens
    pub fn set_collateral_account(ctx: Context<SetCollateralAccount>) -> Result<()> {
        let pool = &mut ctx.accounts.ghost_pool;
        pool.collateral_token_account = ctx.accounts.collateral_token_account.key();

        msg!("Collateral token account set: {}", pool.collateral_token_account);
        Ok(())
    }

}

/// Ghost Pool account
#[account]
pub struct GhostPool {
    pub bump: u8,
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault_bump: u8,

    // Investment settings
    pub investment_threshold: u64,
    pub last_investment_time: i64,

    // Encrypted state (v4: 2 deposits with EncData output)
    pub state_nonce: u128,
    pub encrypted_state: [[u8; 32]; 13],  // PoolState with 2 deposits = 13 field elements (416 bytes, fits callback limit)

    // Public stats
    pub total_deposits: u64,
    pub total_withdrawals: u64,
    pub total_invested: u64,

    // Kamino integration
    pub pending_investment_amount: u64,      // Amount approved by MPC for investment
    pub collateral_token_account: Pubkey,    // Kamino collateral token account (cTokens)
    pub total_collateral_received: u64,      // Total cTokens received from Kamino
}

#[queue_computation_accounts("init_pool_state", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 1 + 32 + 32 + 1 + 8 + 8 + 16 + (32 * 13) + 8 + 8 + 8 + 8 + 32 + 8,  // v4: + Kamino fields
        seeds = [b"ghost_pool", authority.key().as_ref()],
        bump,
    )]
    pub ghost_pool: Box<Account<'info, GhostPool>>,

    pub usdc_mint: Account<'info, Mint>,

    /// Vault PDA to hold USDC
    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = ghost_pool,
        seeds = [b"vault", ghost_pool.key().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_POOL))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,

    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_pool_state")]
#[derive(Accounts)]
pub struct InitPoolStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_POOL))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,
}

#[queue_computation_accounts("process_deposit", user)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,

    #[account(mut)]
    pub user_usdc_token: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub vault_usdc_token: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Account<'info, Mint>,

    // Arcium accounts...
    #[account(
        init_if_needed,
        space = 9,
        payer = user,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DEPOSIT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,

    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("process_deposit")]
#[derive(Accounts)]
pub struct ProcessDepositCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DEPOSIT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,
}

// Similar structs for CheckAndInvest, Withdraw, etc.
// (Abbreviated for brevity - you can generate these following the same pattern)

#[queue_computation_accounts("check_investment_needed", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckAndInvest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,
    // ... (same Arcium accounts as above)
    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: execpool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: comp
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_INVESTMENT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("check_investment_needed")]
#[derive(Accounts)]
pub struct CheckInvestmentNeededCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_INVESTMENT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,
}

#[queue_computation_accounts("authorize_withdrawal", user)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,
    /// Vault token account (source for withdrawal)
    #[account(
        mut,
        seeds = [b"vault", ghost_pool.key().as_ref()],
        bump = ghost_pool.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// User's token account (destination for withdrawal)
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    // ... Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = user,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: execpool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: comp
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_AUTHORIZE_WITHDRAWAL))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("authorize_withdrawal")]
#[derive(Accounts)]
pub struct AuthorizeWithdrawalCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_AUTHORIZE_WITHDRAWAL))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,
    /// Vault token account (source)
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    /// User's token account (destination)
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// Init comp def structs
#[init_computation_definition_accounts("init_pool_state", payer)]
#[derive(Accounts)]
pub struct InitPoolCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("process_deposit", payer)]
#[derive(Accounts)]
pub struct InitDepositCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("check_investment_needed", payer)]
#[derive(Accounts)]
pub struct InitCheckInvestmentNeededCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("record_investment", payer)]
#[derive(Accounts)]
pub struct InitRecordInvestmentCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("record_yield", payer)]
#[derive(Accounts)]
pub struct InitRecordYieldCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("authorize_withdrawal", payer)]
#[derive(Accounts)]
pub struct InitAuthorizeWithdrawalCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("process_withdrawal", payer)]
#[derive(Accounts)]
pub struct InitProcessWithdrawalCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}


#[queue_computation_accounts("process_withdrawal", user)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ProcessWithdrawForQueue<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub ghost_pool: Box<Account<'info, GhostPool>>,
    #[account(
        mut,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: execpool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_WITHDRAWAL))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

/// Accounts for investing in Mock Kamino after MPC approval
#[derive(Accounts)]
pub struct InvestInKamino<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = ghost_pool.pending_investment_amount > 0 @ ErrorCode::NoPendingInvestment,
    )]
    pub ghost_pool: Box<Account<'info, GhostPool>>,

    /// Pool's USDC vault (source of liquidity)
    #[account(
        mut,
        seeds = [b"vault", ghost_pool.key().as_ref()],
        bump = ghost_pool.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// Mock Kamino Lending Market
    /// CHECK: Validated by Mock Kamino program
    pub kamino_lending_market: UncheckedAccount<'info>,

    /// Mock Kamino Lending Market Authority PDA
    /// CHECK: Validated by Mock Kamino program
    pub kamino_lending_market_authority: UncheckedAccount<'info>,

    /// Mock Kamino Reserve account
    /// CHECK: Validated by Mock Kamino program
    #[account(mut)]
    pub kamino_reserve: UncheckedAccount<'info>,

    /// Reserve liquidity mint (USDC)
    pub reserve_liquidity_mint: Box<Account<'info, Mint>>,

    /// Reserve collateral mint (cToken)
    /// CHECK: Validated by Mock Kamino program
    #[account(mut)]
    pub reserve_collateral_mint: UncheckedAccount<'info>,

    /// Reserve liquidity supply vault
    /// CHECK: Validated by Mock Kamino program
    #[account(mut)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,

    /// Destination for collateral tokens (cTokens)
    #[account(mut)]
    pub user_destination_collateral: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,

    /// CHECK: Mock Kamino Lending program
    #[account(address = KAMINO_LENDING_PROGRAM_ID)]
    pub kamino_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts for setting the collateral token account
#[derive(Accounts)]
pub struct SetCollateralAccount<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub ghost_pool: Box<Account<'info, GhostPool>>,

    /// Collateral token account (owned by vault PDA)
    pub collateral_token_account: Box<Account<'info, TokenAccount>>,
}

// Events
#[event]
pub struct PoolInitializedEvent {
    pub pool: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct DepositEvent {
    pub pool: Pubkey,
    pub deposit_count: u64,
}

#[event]
pub struct InvestmentApprovedEvent {
    pub pool: Pubkey,
    pub amount: u64,
}

#[event]
pub struct InvestmentExecutedEvent {
    pub pool: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WithdrawalAuthorizedEvent {
    pub pool: Pubkey,
    pub amount: u64,
    pub idx: u8,
}

#[event]
pub struct WithdrawalCompletedEvent {
    pub pool: Pubkey,
}

// Error codes
#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("The cluster is not set")]
    ClusterNotSet,
    #[msg("Withdrawal not authorized - invalid password")]
    WithdrawalUnauthorized,
    #[msg("No pending investment amount")]
    NoPendingInvestment,
    #[msg("Unauthorized - only pool authority can call this")]
    Unauthorized,
}
