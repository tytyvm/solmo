# Solana momentum bot

Automated Raydium CPMM trade monitoring, momentum screening, Jupiter quote-based paper execution, and opt-in live execution. Market signals come from confirmed Solana transactions through a Helius WebSocket. No DEX Screener dependency.

## Setup

Requires Node 20+, a Helius API key with `transactionSubscribe` access on mainnet, and a Jupiter API key. Copy `.env.example` to `.env`, add keys, then run:

```bash
npm install
npm start
```

The default mode is **paper**. `npm run status` prints current positions and cash; `data/paper-events.jsonl` contains swaps, signals and fills. `WATCH_TOKENS` accepts comma-separated mint addresses to restrict *local processing*; the stream always observes Raydium CPMM transactions, so a watchlist does not reduce provider bandwidth. The program stream can consume considerable provider credits. The stream must accumulate ten uninterrupted minutes of events before entry is possible. After reconnect, signal history resets and builds again. Entries pause on stale or disconnected streams; existing positions still receive live exit quotes.

## Strategy and accounting

The initial thresholds live in `.env`. The bot calculates five-minute buy/sell volume, distinct buying wallets, price movement, and volume acceleration compared with the preceding five minutes. Market cap is the RPC token supply multiplied by the last unambiguous on-chain trade price. It screens mint/freeze authorities and rejects mints with Token-2022 extensions. It checks buy and round-trip sell quotes before entry. Paper fills use Jupiter's fresh quotes; paper balances and realized SOL P&L persist across restarts. Stop, trailing, profit and time exits are checked against a new executable sell quote every poll.

On-chain trade decoding is deliberately conservative: a swap must have a single trader token delta and opposing SOL or USDC delta. Complex routes, sponsored fee payers, and ambiguous multi-token transactions are omitted. This can undercount volume and buyers. Estimated SOL amounts from lamport changes may include account rent; the quote gate provides an independent execution check. Liquidity is controlled by quote round-trip cost and price impact rather than an inferred pool reserve value. SOL price comes from a Jupiter SOL/USDC quote. These choices can be refined in the signal module without changing the stream, storage, execution, or mode boundaries.

## Live mode

Use a **dedicated small wallet**, never your primary wallet. Set `MODE=live`, `BS58_PRIVATE_KEY`, `LIVE_TRADING_ENABLED=true`, and `LIVE_CONFIRM=I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK`. All four are needed. The private key is loaded only in live mode and is never logged. `MAX_POSITION_SOL`, `MAX_OPEN_POSITIONS`, and `MAX_DAILY_LOSS_SOL` cap exposure. Orders use Jupiter Swap V2 `/order` and `/execute` and record the returned wallet amounts and signature. If an execution returns an uncertain result or an HTTP failure, live trading pauses with a `pending` record. Inspect the transaction, wallet balance and state before clearing `pending` and resuming; **do not blindly resubmit**. A live restart with an existing pending order never opens another position.

Network fees, token account rent, and priority fees are not fully reflected in reported swap P&L. Record them from transaction metadata before relying on reported net profit. This is a functional trading engine, but no automated strategy is proven profitable by installation or by the included unit tests. Start in paper mode and compare logs with chain transactions before enabling real funds.

## Commands

```bash
npm test
npm run once
npm run status
npm start
```

`once` is a setup smoke check; it connects and checks the quote service, then exits. It cannot accumulate the ten-minute signal window.
