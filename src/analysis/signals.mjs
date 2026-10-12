function signedMass(votes) {
    let up = 0;
    let down = 0;
    for (const v of votes){
        const r = v.rshares;
        if (r >= 0) up += r;
        else down += -r;
    }
    return {
        up,
        down
    };
}
export function readSignals(posts) {
    const out = new Map();
    const maxChildren = Math.max(1, ...posts.map((p)=>p.comments));
    for (const p of posts){
        const { up, down } = signedMass(p.votes ?? []);
        const total = up + down;
        const downvotePressure = total > 0 ? down / total : 0;
        const frustration = 4 * downvotePressure * (1 - downvotePressure);
        out.set(`${p.author}/${p.permlink}`, Object.freeze({
            author: p.author,
            permlink: p.permlink,
            downvotePressure,
            frustration,
            downvoted: downvotePressure > 0.5,
            engagement: p.comments / maxChildren
        }));
    }
    return out;
}
