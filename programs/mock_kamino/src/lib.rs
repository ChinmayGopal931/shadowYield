use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn, Transfer};

declare_id!("F7rKnHPcXGW3tEeuvMvaTdd9j1B79uL9tFFE3fwetNng");

/// Mock Kamino Lending Program
/// Simulates Kamino's deposit/withdraw flow with cToken issuance and mock yield
#[program]
pub mod mock_kamino {
    use super::*;

    /// Initialize a new lending market
    pub fn init_lending_market(ctx: Context<InitLendingMarket>) -> Result<()> {
        let market = &mut ctx.accounts.lending_market;
        market.bump = ctx.bumps.lending_market;
        market.authority = ctx.accounts.authority.key();

        msg!("Lending market initialized");
        Ok(())
    }

    /// Initialize a new reserve (e.g., USDC reserve)
    pub fn init_reserve(
        ctx: Context<InitReserve>,
        initial_exchange_rate: u64, // e.g., 1_000_000 = 1:1
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        reserve.bump = ctx.bumps.reserve;
        reserve.lending_market = ctx.accounts.lending_market.key();
        reserve.liquidity_mint = ctx.accounts.liquidity_mint.key();
        reserve.collateral_mint = ctx.accounts.collateral_mint.key();
        reserve.liquidity_supply = ctx.accounts.liquidity_supply.key();
        reserve.exchange_rate = initial_exchange_rate; // liquidity per cToken (scaled by 1e6)
        reserve.last_update_slot = Clock::get()?.slot;
        reserve.total_liquidity = 0;
        reserve.total_collateral = 0;
        reserve.yield_rate_bps = 500; // 5% APY in basis points (for mock)

        msg!("Reserve initialized for mint: {}", ctx.accounts.liquidity_mint.key());
        Ok(())
    }

    /// Deposit liquidity and receive collateral tokens (cTokens)
    /// This matches Kamino's `deposit_reserve_liquidity` instruction
    pub fn deposit_reserve_liquidity(
        ctx: Context<DepositReserveLiquidity>,
        liquidity_amount: u64,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;

        // Update exchange rate based on time passed (mock yield accrual)
        let current_slot = Clock::get()?.slot;
        let slots_passed = current_slot.saturating_sub(reserve.last_update_slot);

        // Mock yield: increase exchange rate by ~5% APY
        // Assuming ~2 slots/second, ~63M slots/year
        // 5% APY = 5e-8 per slot approximately
        if slots_passed > 0 && reserve.total_collateral > 0 {
            let yield_factor = 1_000_000u64 + (slots_passed * reserve.yield_rate_bps / 63_000_000);
            reserve.exchange_rate = reserve.exchange_rate
                .checked_mul(yield_factor)
                .unwrap()
                .checked_div(1_000_000)
                .unwrap();
        }
        reserve.last_update_slot = current_slot;

        // Calculate collateral to mint based on exchange rate
        // collateral = liquidity * 1e6 / exchange_rate
        let collateral_amount = liquidity_amount
            .checked_mul(1_000_000)
            .unwrap()
            .checked_div(reserve.exchange_rate)
            .unwrap();

        require!(collateral_amount > 0, ErrorCode::ZeroCollateral);

        // Transfer liquidity from user to reserve supply
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_liquidity.to_account_info(),
            to: ctx.accounts.reserve_liquidity_supply.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), liquidity_amount)?;

        // Mint collateral tokens to user
        let market_key = ctx.accounts.lending_market.key();
        let seeds = &[
            b"lending_market_authority",
            market_key.as_ref(),
            &[ctx.accounts.lending_market.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let mint_accounts = MintTo {
            mint: ctx.accounts.collateral_mint.to_account_info(),
            to: ctx.accounts.user_collateral.to_account_info(),
            authority: ctx.accounts.lending_market_authority.to_account_info(),
        };
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                mint_accounts,
                signer_seeds,
            ),
            collateral_amount,
        )?;

        // Update reserve state
        reserve.total_liquidity = reserve.total_liquidity.checked_add(liquidity_amount).unwrap();
        reserve.total_collateral = reserve.total_collateral.checked_add(collateral_amount).unwrap();

        msg!(
            "Deposited {} liquidity, minted {} cTokens (rate: {})",
            liquidity_amount,
            collateral_amount,
            reserve.exchange_rate
        );

        emit!(DepositEvent {
            reserve: reserve.key(),
            liquidity_amount,
            collateral_amount,
            exchange_rate: reserve.exchange_rate,
        });

        Ok(())
    }

    /// Redeem collateral tokens for liquidity (with yield)
    /// This matches Kamino's `redeem_reserve_collateral` instruction
    pub fn redeem_reserve_collateral(
        ctx: Context<RedeemReserveCollateral>,
        collateral_amount: u64,
    ) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;

        // Update exchange rate based on time passed (mock yield accrual)
        let current_slot = Clock::get()?.slot;
        let slots_passed = current_slot.saturating_sub(reserve.last_update_slot);

        if slots_passed > 0 && reserve.total_collateral > 0 {
            let yield_factor = 1_000_000u64 + (slots_passed * reserve.yield_rate_bps / 63_000_000);
            reserve.exchange_rate = reserve.exchange_rate
                .checked_mul(yield_factor)
                .unwrap()
                .checked_div(1_000_000)
                .unwrap();
        }
        reserve.last_update_slot = current_slot;

        // Calculate liquidity to return based on exchange rate
        // liquidity = collateral * exchange_rate / 1e6
        let liquidity_amount = collateral_amount
            .checked_mul(reserve.exchange_rate)
            .unwrap()
            .checked_div(1_000_000)
            .unwrap();

        require!(liquidity_amount > 0, ErrorCode::ZeroLiquidity);
        require!(
            liquidity_amount <= reserve.total_liquidity,
            ErrorCode::InsufficientLiquidity
        );

        // Burn collateral tokens from user
        let burn_accounts = Burn {
            mint: ctx.accounts.collateral_mint.to_account_info(),
            from: ctx.accounts.user_collateral.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token::burn(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_accounts),
            collateral_amount,
        )?;

        // Transfer liquidity from reserve to user
        let market_key = ctx.accounts.lending_market.key();
        let seeds = &[
            b"lending_market_authority",
            market_key.as_ref(),
            &[ctx.accounts.lending_market.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_accounts = Transfer {
            from: ctx.accounts.reserve_liquidity_supply.to_account_info(),
            to: ctx.accounts.user_liquidity.to_account_info(),
            authority: ctx.accounts.lending_market_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_accounts,
                signer_seeds,
            ),
            liquidity_amount,
        )?;

        // Update reserve state
        reserve.total_liquidity = reserve.total_liquidity.checked_sub(liquidity_amount).unwrap();
        reserve.total_collateral = reserve.total_collateral.checked_sub(collateral_amount).unwrap();

        msg!(
            "Redeemed {} cTokens for {} liquidity (rate: {})",
            collateral_amount,
            liquidity_amount,
            reserve.exchange_rate
        );

        emit!(RedeemEvent {
            reserve: reserve.key(),
            collateral_amount,
            liquidity_amount,
            exchange_rate: reserve.exchange_rate,
        });

        Ok(())
    }

    /// Admin function to manually accrue yield (for testing)
    pub fn accrue_yield(ctx: Context<AccrueYield>, additional_liquidity: u64) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;

        // Mint additional liquidity to the reserve (simulating yield from borrowers)
        let market_key = ctx.accounts.lending_market.key();
        let seeds = &[
            b"lending_market_authority",
            market_key.as_ref(),
            &[ctx.accounts.lending_market.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // For testing, we just increase the exchange rate directly
        // In reality, yield comes from borrower interest payments
        let old_rate = reserve.exchange_rate;
        let rate_increase = additional_liquidity
            .checked_mul(1_000_000)
            .unwrap()
            .checked_div(reserve.total_collateral.max(1))
            .unwrap();

        reserve.exchange_rate = reserve.exchange_rate.checked_add(rate_increase).unwrap();
        reserve.total_liquidity = reserve.total_liquidity.checked_add(additional_liquidity).unwrap();

        msg!(
            "Accrued yield: {} liquidity, rate {} -> {}",
            additional_liquidity,
            old_rate,
            reserve.exchange_rate
        );

        Ok(())
    }
}

// ============ Accounts ============

#[account]
pub struct LendingMarket {
    pub bump: u8,
    pub authority: Pubkey,
}

#[account]
pub struct Reserve {
    pub bump: u8,
    pub lending_market: Pubkey,
    pub liquidity_mint: Pubkey,      // e.g., USDC
    pub collateral_mint: Pubkey,     // cToken (cUSDC)
    pub liquidity_supply: Pubkey,    // Token account holding deposited liquidity
    pub exchange_rate: u64,          // Liquidity per cToken * 1e6 (increases with yield)
    pub last_update_slot: u64,
    pub total_liquidity: u64,
    pub total_collateral: u64,
    pub yield_rate_bps: u64,         // Annual yield in basis points
}

// ============ Contexts ============

#[derive(Accounts)]
pub struct InitLendingMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 1 + 32,
        seeds = [b"lending_market", authority.key().as_ref()],
        bump,
    )]
    pub lending_market: Account<'info, LendingMarket>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitReserve<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
    )]
    pub lending_market: Account<'info, LendingMarket>,

    /// CHECK: PDA for signing
    #[account(
        seeds = [b"lending_market_authority", lending_market.key().as_ref()],
        bump,
    )]
    pub lending_market_authority: AccountInfo<'info>,

    /// The liquidity token mint (e.g., USDC)
    pub liquidity_mint: Account<'info, Mint>,

    /// The collateral token mint (cToken) - must be created beforehand with market authority as mint authority
    #[account(mut)]
    pub collateral_mint: Account<'info, Mint>,

    /// Token account to hold reserve liquidity
    #[account(
        init,
        payer = authority,
        token::mint = liquidity_mint,
        token::authority = lending_market_authority,
        seeds = [b"reserve_liquidity", lending_market.key().as_ref(), liquidity_mint.key().as_ref()],
        bump,
    )]
    pub liquidity_supply: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        space = 8 + 1 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8,
        seeds = [b"reserve", lending_market.key().as_ref(), liquidity_mint.key().as_ref()],
        bump,
    )]
    pub reserve: Account<'info, Reserve>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositReserveLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub lending_market: Account<'info, LendingMarket>,

    /// CHECK: PDA for signing
    #[account(
        seeds = [b"lending_market_authority", lending_market.key().as_ref()],
        bump,
    )]
    pub lending_market_authority: AccountInfo<'info>,

    #[account(
        mut,
        has_one = lending_market,
        has_one = liquidity_mint,
        has_one = collateral_mint,
    )]
    pub reserve: Account<'info, Reserve>,

    pub liquidity_mint: Account<'info, Mint>,

    #[account(mut)]
    pub collateral_mint: Account<'info, Mint>,

    /// Reserve's liquidity supply vault
    #[account(
        mut,
        address = reserve.liquidity_supply,
    )]
    pub reserve_liquidity_supply: Account<'info, TokenAccount>,

    /// User's liquidity token account (source)
    #[account(
        mut,
        token::mint = liquidity_mint,
        token::authority = owner,
    )]
    pub user_liquidity: Account<'info, TokenAccount>,

    /// User's collateral token account (destination)
    #[account(
        mut,
        token::mint = collateral_mint,
    )]
    pub user_collateral: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemReserveCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub lending_market: Account<'info, LendingMarket>,

    /// CHECK: PDA for signing
    #[account(
        seeds = [b"lending_market_authority", lending_market.key().as_ref()],
        bump,
    )]
    pub lending_market_authority: AccountInfo<'info>,

    #[account(
        mut,
        has_one = lending_market,
        has_one = liquidity_mint,
        has_one = collateral_mint,
    )]
    pub reserve: Account<'info, Reserve>,

    pub liquidity_mint: Account<'info, Mint>,

    #[account(mut)]
    pub collateral_mint: Account<'info, Mint>,

    /// Reserve's liquidity supply vault
    #[account(
        mut,
        address = reserve.liquidity_supply,
    )]
    pub reserve_liquidity_supply: Account<'info, TokenAccount>,

    /// User's liquidity token account (destination)
    #[account(
        mut,
        token::mint = liquidity_mint,
    )]
    pub user_liquidity: Account<'info, TokenAccount>,

    /// User's collateral token account (source)
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = owner,
    )]
    pub user_collateral: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AccrueYield<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub lending_market: Account<'info, LendingMarket>,

    #[account(
        mut,
        has_one = lending_market,
    )]
    pub reserve: Account<'info, Reserve>,
}

// ============ Events ============

#[event]
pub struct DepositEvent {
    pub reserve: Pubkey,
    pub liquidity_amount: u64,
    pub collateral_amount: u64,
    pub exchange_rate: u64,
}

#[event]
pub struct RedeemEvent {
    pub reserve: Pubkey,
    pub collateral_amount: u64,
    pub liquidity_amount: u64,
    pub exchange_rate: u64,
}

// ============ Errors ============

#[error_code]
pub enum ErrorCode {
    #[msg("Collateral amount would be zero")]
    ZeroCollateral,
    #[msg("Liquidity amount would be zero")]
    ZeroLiquidity,
    #[msg("Insufficient liquidity in reserve")]
    InsufficientLiquidity,
}
