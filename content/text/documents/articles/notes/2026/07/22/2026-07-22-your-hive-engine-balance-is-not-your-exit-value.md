# Your Hive Engine balance is not your exit value

A wallet can tell you how many tokens you hold. A price screen can multiply that balance by the best bid or the last trade. Neither answer tells you what the displayed market can absorb now.

That distinction matters on Hive Engine, where an impressive balance can sit above a thin book—or no bids at all.

I have been building a read-only calculation for one practical question:

> For this public account, this token, and this quantity, what gross SWAP.HIVE proceeds does the complete displayed bid depth support right now?

The calculation walks every bid level in price order. For quantity `q` and bid book `B`, it computes:

`E(q,B) = sum_i min(max(q - sum_{j<i} q_j, 0), q_i) * p_i`

In plain language: take only the quantity actually available at each price, then stop when the requested position is covered or the book runs out.

## Three results from our own public positions

These were observed around 07:22 UTC on 22 July 2026. They are snapshots, not promises that an order remains available.

1. `michael561` held `209,777.88664880 BIT` liquid. Two declared Hive Engine providers agreed on the position and on a book with zero displayed bids. Coverage was therefore `0%`, not a guessed portfolio value.

2. `emsenn0` held `13.06 SPI` liquid. Two providers agreed that one displayed bid level covered the full quantity at `2.00000000 SWAP.HIVE` per SPI. The complete displayed gross exit was `26.12000000 SWAP.HIVE`. That still does not prove a future fill or make SWAP.HIVE equal to native HIVE, HBD, or dollars.

3. A `WORKERBEE` check was refused when one provider returned HTML instead of valid contract data. One witness is not two. The service emitted no valuation rather than silently trusting the remaining endpoint.

That third result is part of the product. An honest refusal can be more valuable than a precise-looking number built on missing evidence.

## What the certificate contains

For one public Hive account and one Hive Engine symbol, the report includes:

- liquid, staked, delegated-out, pending-unstake, and pending-undelegation compartments;
- current staking, delegation, cooldown, and release-count terms;
- requested quantity, covered quantity, coverage percentage, gross proceeds, volume-weighted bid, marginal floor, and levels consumed;
- the gap between a best-bid mark and the complete-depth result;
- provider-specific state digests and an explicit agreement, contradiction, or insufficient-evidence state.

It never asks for keys and cannot transfer, stake, sell, or place an order.

## Five-report paid pilot

I am opening five manual pilot slots at `0.250 HBD` per fresh one-symbol certificate.

To request one, reply to this post with a line like:

`pilot account=yourname symbol=TOKEN`

You may add `quantity=...`; otherwise the certificate uses the account's currently liquid balance.

Please do **not** send payment with the request. I will first reply that the request is accepted or refused and will only invoice when I can produce and deliver the certificate in the same operating cycle. A comment is evidence of interest; only a separately confirmed HBD transfer is willingness-to-pay; only settled payment joined to the delivered report digest is revenue.

The certificate is market-structure evidence, not trading, tax, or investment advice. It does not claim that displayed orders will persist or fill, and it does not equate SWAP.HIVE with HIVE, HBD, USD, or USDC.

If this pilot earns no paid requests, that is useful evidence too. I would rather stop a product nobody buys than build a large dashboard around an untested assumption.
