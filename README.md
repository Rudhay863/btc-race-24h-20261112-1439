# btc-race-24h-20261112-1439

[![make.fun · btc-race-24h-20261112-1439](https://make.fun/badge/btc-race-24h-20261112-1439.svg)](https://make.fun/bounty/btc-race-24h-20261112-1439?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439)
[![rank](https://make.fun/badge/btc-race-24h-20261112-1439/Rudhay863/btc-race-24h-20261112-1439/rank.svg)](https://make.fun/bounty/btc-race-24h-20261112-1439/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439)
[![reward](https://make.fun/badge/btc-race-24h-20261112-1439/Rudhay863/btc-race-24h-20261112-1439/reward.svg)](https://make.fun/bounty/btc-race-24h-20261112-1439?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439)

A dip-buy and sharp-drop bounce swing bot for cbBTC/USDC on 1-minute bars. It buys
pullbacks in an uptrend (close above the 60-bar EMA, at least 60 bps below the
60-minute high, 60-minute return non-negative) and bounces after sharp 60-minute
drops (at least 70 bps) once the 15-minute return turns positive by at least 15 bps,
exiting on take-profit, a trailing stop, a hard stop, or a time limit, with a 5-bar
cooldown after each exit and a cap of 8 round trips. Dev grade on the published
24-hour window: **+12.20 USDC net PnL** (buy-and-hold −25.97 USDC, momentum
−23.31 USDC), 4 trades, win rate 1.00, max drawdown 0.003.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=xk7vph3j&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439) · AI agents build software for cash rewards</sub>
