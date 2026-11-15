# Crypto Signal Desk — Balanced RSI(14) AMD/FVG Scalping V5

## Why this release exists

The user requested a strategy slightly softer than Selective V4 but **not** a return to loose V3, whose simulated entries were reported to produce false signals. V5 is derived from strict V2 / selective V4. All signal decisions remain research/simulation-only.

## Balanced V5 gate logic

| Rule | LONG | SHORT | Required |
|---|---|---|---|
| Monthly RSI(14), completed candles | >42 | <58 | Yes |
| Weekly RSI(14), completed candles | >50 | <50 | Yes |
| Daily RSI(14) pullback | 35–50 | 50–65 | Yes |
| 5m RSI price pivot divergence | Bullish | Bearish | **Yes** |
| 5m RSI recovery **OR** momentum | Cross back above 35 **or** latest RSI >=45 | Cross below 65 **or** latest RSI <=55 | **Yes: either method** |
| 1m accumulation range | 16 consecutive closed bars | Same | Yes |
| 1m manipulation | Wick below range and close inside | Wick above range and close inside | **Yes** |
| 1m displacement FVG | Three-candle directional gap, strong middle body | Mirror | **Yes** |
| 1m FVG retest | Touch the gap, close bullish | Touch the gap, close bearish | **Yes** |
| Retest volume | >1.10× preceding five 1m candle average | Same | **Yes** |
| Risk | Initial stop beyond sweep with <=2% entry distance | Mirror | Yes |
| TP | Exactly 3R from entry | Mirror | Yes |

The price/RSI divergence is required and must precede the sweep. The displacement body must exceed 1.3× accumulation mean body and the gap width exceed 0.01% of midpoint. An initial stop invalidation before retest rejects the setup. The confirmed retest candle must be recent (3-minute maximum lag). The previous 25%-toward-target wait remains removed.

## Changes versus V4 (the only relaxed gates)

- Monthly RSI LONG threshold 45→42, SHORT threshold 55→58.
- Daily RSI LONG zone 38–48→35–50, SHORT zone 52–62→50–65.
- 5m RSI recovery is no longer the **only** confirmation option: when there is a mandatory confirmed RSI divergence, established weekly/monthly/daily bias, and complete mandatory AMD/FVG structure, sufficiently directional 5m RSI momentum may substitute for a recent RSI 35/65 crossing.

**Not relaxed:** weekly RSI bias, mandatory price/RSI divergence, liquidity sweep/reclaim, directional FVG displacement, FVG retest candle with volume, structural stop, 3R target.

## Deployment, saved data and risk

Strategy version: `RSI14_AMD_FVG_BALANCED_SCALP_1M_V5`. Older V3/V4 open simulated trade history is preserved, not rewritten or relabeled as V5. Current candidate signals use the V5 rules. The browser scanner can attempt up to 500 symbols, but scanning all required monthly, weekly, daily, 5m and 1m series may be slow or rate-limited. Coins with fewer than 20 completed monthly candles cannot pass.

Live Binance order submission is disabled and real trading cannot be armed from the laptop server. Browser Binance risk inputs remain a local draft only.

Synthetic long/short tests verify qualifying signals, 3R sizing, alternative 5m momentum path, and rejection without sweep or volume. **No actual daily signal-rate, win-rate, or real-market profit improvement has been established.** False positives may remain.
