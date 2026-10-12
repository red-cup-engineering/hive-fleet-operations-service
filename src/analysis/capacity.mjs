export function catabolicCapacity(netHolonomyBps, depthProxy, tradeSizeProxy) {
    const mispricingMassProxy = Math.abs(netHolonomyBps) / 10000 * Math.max(0, depthProxy);
    return Object.freeze({
        mispricingMassProxy,
        depthProxy: Math.max(0, depthProxy),
        tradeSizeProxy,
        unit: "mixed-liquidity-proxy",
        capacitySteps: tradeSizeProxy > 0 ? Math.floor(mispricingMassProxy / tradeSizeProxy) : 0
    });
}
