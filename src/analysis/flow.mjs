const BALANCE_TOLERANCE = 0.05;
export function detailedBalance(symbol, fills) {
    let buyVolume = 0;
    let sellVolume = 0;
    for (const fill of fills){
        if (fill.type === "buy") buyVolume += fill.volumeSwapHive;
        else sellVolume += fill.volumeSwapHive;
    }
    const totalVolume = buyVolume + sellVolume;
    const netFlux = buyVolume - sellVolume;
    return Object.freeze({
        symbol,
        fillCount: fills.length,
        buyVolume,
        sellVolume,
        netFlux,
        balanced: totalVolume <= 0 || Math.abs(netFlux) / totalVolume <= BALANCE_TOLERANCE
    });
}
