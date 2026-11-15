# Crypto Signal Desk — RSI(14) + AMD + 5m FVG (simulation only)

## Origin and scope

This model combines the RSI principles in the user's November 2026 video
transcript with the user's requested **Accumulation → Manipulation → FVG entry
→ Distribution target** framework.

**Transcript-derived RSI rules:** RSI(14) measures momentum; RSI > 50 is
bullish, RSI < 50 bearish; entering RSI 70 or 30 is NOT itself an opposite-side
entry; recovery above 30 or drop below 70, price/RSI divergence, aligned
higher-timeframe trends, confirmation candles and volume matter. The source
presents a bullish strategy using monthly/weekly RSI >50 and daily RSI ~40–45.

**Implementation additions, not verbatim transcript rules:** mirrored bearish
daily RSI 55–60, 16-candle accumulation range, sweep/reclaim, FVG gap sizing,
volume multiplier, staleness limits, 3R target, and explicit 5m candle
definitions.

## Exact programmatic rules

- RSI: Wilder's smoothed 14-period RSI, calculated separately on **completed**
  monthly (1M), weekly (1w), daily (1d), and 5-minute (5m) candles.
- LONG trend: monthly and weekly RSI both strictly above 50; latest daily RSI
  40–45 inclusive.
- SHORT trend: monthly and weekly RSI both strictly below 50; latest daily RSI
  55–60 inclusive (mirrored design assumption).
- Intraday divergence: two confirmed pivot lows where the latter price low
  is lower but the RSI low higher by >1 point (LONG); two confirmed pivot highs
  where price is higher and RSI lower by >1 point (SHORT).
- LONG must have crossed RSI back above 30 from below in the last 30 closed
  5m candles. SHORT must have crossed back below 70 from above.
- Accumulation: 16 consecutive 5m candles with measurable high-low range
  narrower than 6% of its midpoint.
- Manipulation: a 5m candle wicks through the accumulation low (LONG) or
  high (SHORT), but **closes back inside** the accumulated range.
- The confirmed RSI divergence must precede this manipulation candle and
  be within the preceding 40 completed 5m candles.
- Within 14 candles after manipulation, three consecutive 5m candles
  establish a directionally aligned FVG: bullish third low > first high,
  bearish third high < first low. Its width must exceed 0.01% of range midpoint.
  The middle candle has a body >1.3x the accumulation average body and
  closes beyond the range in the intended trade direction.
- Price must **later** return into the FVG. The 5m retest candle must close
  in the trade direction with a hammer/engulfing-like directional body and
  volume >1.1x the prior five 5m bars' average volume. This is the
  **CONFIRMED simulated entry event**. No extra 25% TP progress gate.
- Initial stop is beyond the swept manipulation extreme plus a 0.015% price
  buffer. Target is a single **3R** at the observed simulated entry price.
  Distribution is the anticipated move toward this target, NOT a mandatory
  pre-entry phase and not a guaranteed market outcome.
- Only a near-current completed signal is eligible for new simulated tracking;
  both stop-wick invalidation and fresh-price limits apply. Previously
  recorded simulated and real-account history is not automatically erased.
- Profit locks from the earlier model remain unchanged: at 50% progress to
  TP, protect 5% of planned entry-TP price distance; at 75%, protect 50%.
  These are not guaranteed fills.

## Live-order safety

The deployed scanner calls only `register(result)` for simulation.
The Binance real-order call has been removed. The server rejects requests to
`/api/binance-live/arm`, and a locally started broker is disarmed.
**Existing Binance positions or exchange orders are not automatically closed.**
Users must review existing exchange positions in Binance.

## Limitations

- Assets without at least 20 *completed monthly* candles cannot pass strict
  validation. Other history minimums: 20 weekly, 20 daily, 100 five-minute.
- The scan is intentionally strict and might produce few or no signals.
- Scanning many symbols across four timeframes can take significant time,
  especially on the first run; higher timeframe candles are cached.
- A 5m retest candle is identified only after closing. The actual observed
  simulated entry can differ from the candle close. Excessive price drift
  prevents registration.
- Scanner price sampling can miss brief intra-candle stops or gaps. Signals
  are hypotheses, not evidence of institutional orders or proven win rate.
- Tests include unit/controlled fixture scenarios, **not historical or
  live-exchange backtests**. Do not use this as evidence of profitability.

## Testing

Run `node tests/strategy.test.js` (Node.js >=20). This covers RSI extremes,
closed-history guardrails, LONG/SHORT AMD/FVG fixtures under controlled RSI
inputs, volume and liquidity-sweep rejection, 3R calculations and static
real-order safety checks.

## Local installation

After stopping the laptop scanner, download the latest project source and
replace only application code files. Preserve `laptop-config.json`,
`laptop-state.json`, the locally encrypted Binance credential vault, logs,
and backups. Restart with `node laptop-server.js` after running the tests.
