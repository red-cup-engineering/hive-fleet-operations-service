function beneficiaryFractionOf(post) {
    const weight = (post.beneficiaries ?? []).reduce((s, b)=>s + (Number.isFinite(b.weight) ? b.weight : 0), 0);
    return Math.max(0, Math.min(1, weight / 10000));
}
export function readRewardRoutes(posts) {
    const out = new Map();
    let maxR = 0;
    const rshares = new Map();
    for (const p of posts){
        const r = Math.max(0, p.netRshares);
        rshares.set(`${p.author}/${p.permlink}`, r);
        if (r > maxR) maxR = r;
    }
    for (const p of posts){
        const key = `${p.author}/${p.permlink}`;
        const r = rshares.get(key) ?? 0;
        const saturation = maxR > 0 ? r / maxR : 0;
        const beneficiaryFraction = beneficiaryFractionOf(p);
        const captureEfficiency = 1 - 0.7 * saturation;
        out.set(key, Object.freeze({
            author: p.author,
            permlink: p.permlink,
            beneficiaryFraction,
            netRshares: r,
            saturation,
            captureEfficiency: Math.max(0, Math.min(1, captureEfficiency))
        }));
    }
    return out;
}
