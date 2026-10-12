const EARLY_WINDOW_SECONDS = 24 * 3600;
const MID_WINDOW_SECONDS = 72 * 3600;
export const CASHOUT_WINDOW_SECONDS = 7 * 24 * 3600;
export function curationWindow(ageSeconds) {
    if (ageSeconds < EARLY_WINDOW_SECONDS) return "early";
    if (ageSeconds < MID_WINDOW_SECONDS) return "mid";
    if (ageSeconds < CASHOUT_WINDOW_SECONDS) return "late";
    return "closed";
}
export function curationPenaltyDivisor(window) {
    switch(window){
        case "early":
            return 1;
        case "mid":
            return 2;
        case "late":
            return 8;
        case "closed":
            return 0;
    }
}
export function curationWindowFactor(ageSeconds) {
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 1;
    if (ageSeconds >= CASHOUT_WINDOW_SECONDS) return 0;
    const divisor = curationPenaltyDivisor(curationWindow(ageSeconds));
    return divisor > 0 ? 1 / divisor : 0;
}
function normalisedEntropy(weights) {
    const total = weights.reduce((s, w)=>s + w, 0);
    if (total <= 0 || weights.length <= 1) return 0;
    let h = 0;
    for (const w of weights){
        if (w <= 0) continue;
        const p = w / total;
        h -= p * Math.log(p);
    }
    return h / Math.log(weights.length);
}
function gapRegularity(sortedTimesMs) {
    if (sortedTimesMs.length < 4) return {
        regularity: 0,
        entropy: 1
    };
    const gaps = [];
    for(let i = 1; i < sortedTimesMs.length; i++){
        const g = sortedTimesMs[i] - sortedTimesMs[i - 1];
        gaps.push(g > 0 ? g : 1);
    }
    const buckets = new Array(16).fill(0);
    for (const g of gaps){
        const secs = g / 1000;
        const idx = Math.max(0, Math.min(15, Math.floor(Math.log2(secs + 1))));
        buckets[idx] += 1;
    }
    const entropy = normalisedEntropy(buckets);
    return {
        regularity: 1 - entropy,
        entropy
    };
}
export function readTiming(author, permlink, createdIso, votes, nowMs = Date.now()) {
    const created = Date.parse(createdIso);
    const timed = votes.map((v)=>Date.parse(v.time ?? "")).filter((t)=>Number.isFinite(t)).sort((a, b)=>a - b);
    const ageSeconds = Number.isFinite(created) ? Math.max(0, (nowMs - created) / 1000) : Number.NaN;
    const windowFactor = curationWindowFactor(ageSeconds);
    const windowPhase = Number.isFinite(ageSeconds) ? curationWindow(ageSeconds) : "early";
    const { regularity, entropy } = gapRegularity(timed);
    const likelyCartelTrail = timed.length >= 8 && regularity > 0.6;
    const organic = 1 - regularity;
    const timingScore = windowFactor * (0.7 + 0.3 * organic);
    return Object.freeze({
        author,
        permlink,
        voteCount: timed.length,
        ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : 0,
        windowPhase,
        trainRegularity: regularity,
        timingEntropy: entropy,
        likelyCartelTrail,
        timingScore: Math.max(0, Math.min(1, timingScore))
    });
}
export function readTimingOf(post, nowMs) {
    return readTiming(post.author, post.permlink, post.created, post.votes ?? [], nowMs);
}
