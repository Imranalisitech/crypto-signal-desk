# Crypto Signal Desk — RSI(14) AMD/FVG Scalping V3 (simulation only)

## Current active model

**Direction:** 15-minute RSI(14): LONG only when RSI > 50; SHORT only when RSI < 50.

**Momentum:** 5-minute RSI(14) must be >= 45 for LONG or <= 55 for SHORT.

**1-minute setup:** RSI(14) must be >= 46 for LONG or <= 54 for SHORT. 1-minute RSI divergence and crosses back through 30/70 are additional confluences, not mandatory blockers. This is a deliberate **scalping adaptation**, not a direct quote from the original RSI transcript.

**Accumulation:** A 12-candle 1m range narrower than 3.5% of midpoint. **Manipulation:** a 1m candle wicks beyond range high/low, then closes back inside. **Displacement:** within 12 bars, a directional three-candle FVG forms; the middle candle's body exceeds 1.15x the accumulation average. **Entry:** a later 1m candle revisits the FVG, closes in the trade direction and has volume >= 1.05x the preceding five 1m candles. **Distribution:** anticipated move toward 3R TP. SL is beyond manipulation wick with a small buffer, capped at 2% of the planned entry price.

The 25% move-toward-TP gate is removed. Both LONG and SHORT setups run in **simulation-only** mode. Real Binance order submission and arming remain blocked.

## Why the previous model was too restrictive

The older V2 required RSI alignment across monthly, weekly, daily and 5-minute charts, daily RSI confined to 40–45 or 55–60, and a strict RSI divergence plus 30/70 recovery before even evaluating the 1m AMD/FVG. These filters are more suitable for selective intraday/swing opportunities than active 1-minute scalps.

## Source and implementation distinction

The user's RSI transcript explains RSI(14), directional RSI >/< 50, divergence, 30/70 recovery and multi-timeframe reading. Accumulation → Manipulation → FVG → Distribution and the numerical scalping thresholds are **user-requested methodology plus engineering assumptions**, not a formula given verbatim in the video.

## Trade limits and caveats

- New setups require only completed 15m, 5m and 1m bars. 40 15m, 40 5m and 90 1m completed bars are the minimum.
- The browser fallback can attempt up to 500 eligible USDT perpetual markets but may require many minutes because of exchange rate limits. It runs only while the app stays open.
- A completed scan is not a guarantee of timely simulated entries: the observed price may have moved by the time the scanner reaches a coin. The simulated-trade tracker refuses fills that are stale or too far from signal price.
- More qualifying setups are possible than with the strict V2, but higher frequency also risks false signals; no historical win rate or full-day forward performance has been established.
- An entry signal is not proof of institutional activity or a guaranteed profit. Real trading stays disabled.
- Existing stored history and prior-model open simulations are preserved; the current active strategy has a new version tag so signals are not silently mixed.

## Testing

Run `node tests/strategy.test.js` in the source directory. The fixture checks LONG and SHORT scalp structure, mandatory volume and sweep, RSI(14) arithmetic, a 3R planned target and no real Binance submission path. The test scenarios use controlled RSI inputs, so they do not establish real-market frequency or profitability.
