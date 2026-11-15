# Crypto Signal Desk — Selective RSI14 AMD/FVG V4 (simulation only)

## Baseline restored: strict V2, not loose V3

Reinstated the historical V2 implementation from commit `20155e795dbc0180e033944e580c18e689d22536`, which required monthly/weekly/daily RSI bias, completed 5-minute RSI divergence and recovery, a 1-minute accumulation and liquidity sweep, 3-candle FVG, and a directional high-volume retest entry.

**Only the following V2 qualifiers have been loosened:**
- LONG: weekly RSI > 50 and monthly RSI > 45 (originally > 50); SHORT: weekly RSI < 50 and monthly RSI < 55 (originally < 50).
- LONG daily RSI pullback 38–48 (original 40–45); SHORT 52–62 (original 55–60).
- RSI recovery across 35 for LONG and across 65 for SHORT (original 30/70), checked over the last 45 completed 5-minute candles instead of 30.
- All RSI filters above are **still mandatory**; particularly **5m confirmed price/RSI divergence** is mandatory and must precede the liquidity manipulation sweep.

**Original strict V2 structure retained:**
- Accumulation is 16 consecutive completed 1m candles, with nonzero range less than 6% of midpoint.
- A manipulation candle must wick below range low (LONG), or above range high (SHORT), and close back inside.
- Within 14 more completed 1m candles, a three-candle directional FVG is formed by displacement with body > 1.3× prior accumulation average. Gap width > 0.01% of midpoint.
- A subsequent **completed 1m retest candle** must touch the FVG, close in the trade direction with a meaningful body and volume > 1.10× average volume of previous five 1-minute candles.
- The FVG entry must be recent (within 3m of candle close), the setup's stop must not have been hit, and the initial stop distance is capped at 2% to reject overly wide scalp risk.
- Initial SL stays beyond the manipulation wick plus buffer, take-profit is one 3R distribution target. Previous 25%-toward-TP confirmation rule stays removed.
- No exchange orders are placed. Broker arming and automatic real Binance Futures order submission remain disabled in the laptop code. The browser's Binance risk panel is a **local draft only**, not a real execution control.

## Existing data and version separation

Strategy ID: `RSI14_AMD_FVG_STRICT_SCALP_1M_V4`. V3's less selective results are not loaded as current model signals. Previous simulated open trades and closed trade history are retained rather than erased or backdated, and older entries should not be interpreted as V4 confirmations.

## Limitations

The revised strategy is still demanding and can go hours without signals. Scanning 500 symbols over monthly, weekly, daily, 5m and 1m exchange series may take substantial time and trigger rate-limit cooldowns. Coins lacking 20 closed monthly candles will not qualify, even if they move sharply. Tests are controlled LONG/SHORT examples, not historical signal frequency, false-positive rate or profitability estimates.

The user reported false signals in V3. This change intentionally prioritizes selectivity over frequent signals; more signals are not guaranteed.
