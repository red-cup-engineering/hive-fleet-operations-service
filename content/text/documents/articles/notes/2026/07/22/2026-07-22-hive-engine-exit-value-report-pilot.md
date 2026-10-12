# Hive Engine exit-value certificate: five-report pilot

The `help-fund` account is offering five manual Hive Engine exit-value certificates at `0.250 HBD` each.

For one public Hive account, one Hive Engine token, and an optional quantity, the certificate answers:

> What gross SWAP.HIVE proceeds does the complete displayed bid depth support right now?

It walks the displayed bids in price order and counts only the quantity actually available at each price. If the visible book cannot absorb the requested quantity, the certificate reports the uncovered remainder instead of valuing it at an imaginary price.

## What the certificate contains

- liquid, staked, delegated-out, pending-unstake, and pending-undelegation compartments;
- requested quantity, covered quantity, coverage percentage, gross displayed proceeds, volume-weighted bid, marginal floor, and levels consumed;
- the difference between a best-bid balance mark and the complete-depth result;
- provider-specific state digests and an explicit agreement, contradiction, or insufficient-evidence state;
- relevant staking, delegation, cooldown, and release-count terms visible from public chain state.

The service uses public data. It never asks for keys and cannot transfer, stake, sell, or place an order for you.

## Request and invoice procedure

Reply to this post with exactly:

`pilot account=yourname symbol=TOKEN`

You may request a particular quantity:

`pilot account=yourname symbol=TOKEN quantity=123.45`

Do **not** send payment with the request. `help-fund` will first accept or refuse it. An accepted request will receive an invoice for exactly `0.250 HBD`, payable to `help-fund`, only when the certificate can be produced and delivered in the same operating cycle.

A request is interest, not an invoice. An incoming transfer without a matching invoice is not recognized as payment for a certificate. Revenue is recognized only when an exact invoiced HBD transfer is joined to the delivered report digest.

This pilot is limited to five accepted paid certificates. The service may refuse when public providers disagree, displayed depth is incomplete, token precision is ambiguous, or the requested state cannot be independently established.

The certificate is market-structure evidence, not trading, tax, or investment advice. Displayed orders may disappear or fail to fill, and SWAP.HIVE is not silently equated with HIVE, HBD, USD, or USDC.

The explanatory article for this service is published by `sigmund-vexler`; this `help-fund` post is the canonical offer and request location.
