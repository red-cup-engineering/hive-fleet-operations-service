const EMPTY_RESULT = Object.freeze({
    funded: Object.freeze([]),
    totalCost: 0,
    totalBenefit: 0,
    consideredCount: 0,
    fundedCount: 0,
    choiceBits: 0,
    exact: true
});
const MAX_EXACT_CANDIDATES = 20;
const TIE_TOLERANCE = 0.0001;
function exactAllocate(candidates, budget) {
    const n = candidates.length;
    let bestBenefit = -Infinity;
    let bestMask = 0;
    const feasibleMasks = [];
    for(let mask = 0; mask < 1 << n; mask += 1){
        let cost = 0;
        let benefit = 0;
        for(let i = 0; i < n; i += 1){
            if ((mask & 1 << i) === 0) continue;
            cost += candidates[i].cost;
            benefit += candidates[i].benefit;
        }
        if (cost > budget) continue;
        feasibleMasks.push(mask);
        if (benefit > bestBenefit) {
            bestBenefit = benefit;
            bestMask = mask;
        }
    }
    if (feasibleMasks.length === 0) return EMPTY_RESULT;
    const threshold = bestBenefit * (1 - TIE_TOLERANCE);
    let tieSetSize = 0;
    for (const mask of feasibleMasks){
        let benefit = 0;
        for(let i = 0; i < n; i += 1){
            if ((mask & 1 << i) !== 0) benefit += candidates[i].benefit;
        }
        if (benefit >= threshold) tieSetSize += 1;
    }
    const funded = [];
    let totalCost = 0;
    for(let i = 0; i < n; i += 1){
        if ((bestMask & 1 << i) === 0) continue;
        funded.push(candidates[i].id);
        totalCost += candidates[i].cost;
    }
    return Object.freeze({
        funded: Object.freeze(funded),
        totalCost,
        totalBenefit: bestBenefit,
        consideredCount: n,
        fundedCount: funded.length,
        choiceBits: tieSetSize > 0 ? Math.log2(tieSetSize) : 0,
        exact: true
    });
}
function greedyAllocate(candidates, budget) {
    const ranked = [
        ...candidates
    ].sort((a, b)=>b.benefit / b.cost - a.benefit / a.cost);
    const funded = [];
    let totalCost = 0;
    let totalBenefit = 0;
    for (const candidate of ranked){
        if (totalCost + candidate.cost > budget) continue;
        funded.push(candidate.id);
        totalCost += candidate.cost;
        totalBenefit += candidate.benefit;
    }
    return Object.freeze({
        funded: Object.freeze(funded),
        totalCost,
        totalBenefit,
        consideredCount: candidates.length,
        fundedCount: funded.length,
        choiceBits: null,
        exact: false
    });
}
export function allocateBudget(candidates, budget) {
    const positive = candidates.filter((c)=>c.cost > 0 && c.benefit > 0 && Number.isFinite(c.cost) && Number.isFinite(c.benefit));
    if (!(budget > 0) || positive.length === 0) return EMPTY_RESULT;
    return positive.length <= MAX_EXACT_CANDIDATES ? exactAllocate(positive, budget) : greedyAllocate(positive, budget);
}
