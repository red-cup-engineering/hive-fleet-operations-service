function corpusTopicMass(posts) {
    const mass = new Map();
    for (const p of posts){
        const share = p.tags.length > 0 ? 1 / p.tags.length : 0;
        for (const t of p.tags)mass.set(t, (mass.get(t) ?? 0) + share);
    }
    return mass;
}
function normalisedTagEntropy(tags) {
    if (tags.length <= 1) return 0;
    const counts = new Map();
    for (const t of tags)counts.set(t, (counts.get(t) ?? 0) + 1);
    const total = tags.length;
    let h = 0;
    for (const c of counts.values()){
        const p = c / total;
        h -= p * Math.log(p);
    }
    return h / Math.log(counts.size);
}
export function readContent(posts) {
    const out = new Map();
    const corpus = corpusTopicMass(posts);
    const corpusTotal = [
        ...corpus.values()
    ].reduce((s, m)=>s + m, 0);
    const SMOOTH = 1e-3;
    const vocab = corpus.size + 1;
    for (const p of posts){
        const k = p.tags.length;
        let novelty = 0;
        if (k > 0) {
            const pPost = 1 / k;
            for (const t of p.tags){
                const qMass = (corpus.get(t) ?? 0) + SMOOTH;
                const q = qMass / (corpusTotal + SMOOTH * vocab);
                novelty += pPost * Math.log(pPost / q);
            }
        }
        const focus = 1 - normalisedTagEntropy(p.tags);
        const fitness = Math.max(0, novelty) * (0.5 + 0.5 * focus);
        out.set(`${p.author}/${p.permlink}`, Object.freeze({
            author: p.author,
            permlink: p.permlink,
            novelty,
            focus,
            fitness
        }));
    }
    return out;
}
