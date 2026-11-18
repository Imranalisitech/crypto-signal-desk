# 1-minute crypto scalping: 500 LONG and 500 SHORT winning historical examples

## Important distinction

**Completed real-candle historical research, NOT live-trade results and NOT a profitable strategy validation.**
The two downloadable lists each contain 500 distinct, dated historical examples that hit the
**gross 2R take-profit target** and also have **positive estimated net R after fees and slippage**.
They were selected from the historical winners **after the outcome was known**. Do not use the
winning-only samples to estimate win rate or expected returns.

**These records come from a third-party public GitHub repository containing BTCUSDT and ETHUSDT
1-minute OHLCV CSVs. Spot versus USD-M futures market provenance was NOT independently verified.**
Therefore this report does not assert that these are proven Binance Futures fills.

Historical period: **2025-01-01 through 2025-08-31 UTC** (8 monthly files per symbol).
Universe: **BTCUSDT, ETHUSDT**.
Research strategy: **5m EMA trend + 1m EMA21 pullback + closed 1m breakout with RSI and volume confirmation**.
This 1-minute *research* setup is separate from the production dashboard's 5-minute V2 scanner;
the deployed software and Binance live execution were NOT modified.

## Files

- [500 LONG target-winning examples](long_500_target_winners.csv)
- [500 SHORT target-winning examples](short_500_target_winners.csv)
- [Reproducible JavaScript study engine](scalp_1m_research_engine.js)
- Complete **all-outcomes** month files:
  [Jan](outcomes_2025-01.csv), [Feb](outcomes_2025-02.csv),
  [Mar](outcomes_2025-03.csv), [Apr](outcomes_2025-04.csv),
  [May](outcomes_2025-05.csv), [Jun](outcomes_2025-06.csv),
  [Jul](outcomes_2025-07.csv), [Aug](outcomes_2025-08.csv).

The full sample is indispensable. Do not draw conclusions based on the winners-only lists.

## Full-sample results (including losses)

| Metric | LONG | SHORT | Combined |
| --- | ---: | ---: | ---: |
| All qualifying 1m trades | 2,131 | 1,818 | 3,949 |
| Any positive after-cost exit | 724 | 585 | 1,309 |
| Hit 2R gross target, positive after cost | 629 | 512 | 1,141 |
| Curated profitable 2R target examples | 500 | 500 | 1,000 |
| After-cost mean R | -0.649 | -0.644 | **-0.646** |
| Combined after-cost R | -1,382.4 | -1,170.4 | **-2,552.8** |

**Full-sample estimated net win rate: 33.1%.**
TP outcomes 1,141; stop-loss outcomes 2,444; time exits 364.
Historical baseline **lost money under the stated assumptions** despite the 1,000 successful examples.

### Month-by-month results

| UTC month | All signals | LONG profitable TP | SHORT profitable TP | Full-sample net R |
| --- | ---: | ---: | ---: | ---: |
| Jan 2025 | 572 | 103 | 72 | -337.47 |
| Feb 2025 | 473 | 78 | 84 | -216.48 |
| Mar 2025 | 569 | 80 | 70 | -363.14 |
| Apr 2025 | 520 | 74 | 58 | -343.64 |
| May 2025 | 520 | 98 | 56 | -322.82 |
| Jun 2025 | 441 | 75 | 60 | -312.75 |
| Jul 2025 | 405 | 61 | 57 | -302.08 |
| Aug 2025 | 449 | 60 | 55 | -354.38 |

## Entry and confirmation structure

### LONG

1. Last **completed** 5-minute candles show 5m EMA21 above EMA55 with upward EMA21 slope.
2. On the 1m timeframe EMA9 > EMA21, with EMA21 rising.
3. One of the preceding five 1m candles taps the EMA21 pullback zone.
4. Completed 1m bullish trigger closes above the preceding 1m high by at least 0.015 ATR14,
   body >=0.27 ATR14, close in top 37% of candle, RSI14 in [51,75],
   and volume >=1.03x the average of the preceding 20 candles.
5. Confirmed signal filled at **next 1m opening price** with 0.01% adverse entry slippage.
6. Stop beyond the pullback low with 0.12 ATR14 buffer. Gross target = 2x initial risk.

### SHORT

Reverse every direction and candle condition: 5m EMA21 < EMA55 and declining;
1m EMA9 < EMA21; prior pullback touches the EMA21 zone; bearish 1m close below prior low;
RSI14 in [25,49], same ATR and volume requirements; stop above pullback high; 2R target.

Only risk distances between **0.045% and 0.8% of entry price** qualify.
There is at most **one simulated position per symbol** at a time and a maximum
holding period of 36 minutes. Entries use next-minute open after a fully closed confirmation
bar; the backtest does **not** enter at the earlier signal candle's close.

## Costs and limitations

- Taker commission: **0.04% per side = 0.08% round trip** (assumption).
- Slippage: **0.01% adverse per side** (assumption).
- Stop/target touching in the same 1m candle: **stop first** (conservative).
- No funding fees, latency, order book spread measurements, market depth, liquidation,
  margin mechanics, dynamic leverage, outages or exchange order-size filters.
- 5m trend only updated from **fully completed 5m candles**.
- CSV data may have unverified spot/perpetual provenance.
- No independent forward/live testing, transaction-level exchange fill verification, or
  statistically reliable profitability claim.
- Candle-level bar testing cannot establish the exact intrabar fill sequence.
- The source has 8 monthly segments; signals and positions are restarted across
  month boundaries, so month boundary edges are not continuously simulated.

**Full-sample verdict: unprofitable under the assumed costs. No live-money recommendation.**

## Descriptive research lead — NOT a validated signal

An *exploratory post-hoc* subset requiring **ATR14 >=0.12% of price and volume
>=2.0x the preceding 20-bar average** had 182 trades with mean net **+0.031 R**.
Within Jul-Aug, only 29 such cases occurred, mean **+0.136 R**.
This apparent edge was identified **after observing the results** and must be tested
on new, untouched data before any trading decisions. The tiny Jul-Aug subsample
is not adequate evidence.

## Two example dated TP outcomes

| Side | Entry (UTC) | Coin | Entry | SL | 2R target | Net R (assumed costs) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| LONG | 2025-01-01 14:00 | ETHUSDT | 3343.43431 | 3338.10782 | 3354.08728 | +1.4349 |
| SHORT | 2025-01-01 09:07 | ETHUSDT | 3333.97657 | 3340.05179 | 3321.82613 | +1.5063 |
| LONG | 2025-01-01 15:43 | BTCUSDT | 94175.5166 | 94111.0934 | 94304.3631 | +0.6842 |
| SHORT | 2025-01-03 00:50 | BTCUSDT | 96842.6148 | 96930.4486 | 96666.9471 | +1.0079 |

The **two CSVs include all 1,000 confirmed winner examples** with exact timestamps,
price levels, exit values, volume ratio, RSI, ATR, 5m EMAs, and source links.

## Source

Third-party data files from [worldtradingchampion-source/btcdata](https://github.com/worldtradingchampion-source/btcdata),
specifically BTCUSDT-1m-YYYY-MM.csv and ETHUSDT-1m-YYYY-MM.csv for Jan-Aug 2025.

For comparison, Binance's [official public-data documentation](https://github.com/binance/binance-public-data)
describes the native 1m market-candle format; **the third-party files used here were not
cross-checked candle-by-candle against the official archive**.

Research created 2026-11-18.
