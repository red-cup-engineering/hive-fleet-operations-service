const ZERO_TOL = 1e-9;
function laplacianEigenvalues(nodeIndex, edges) {
    const n = nodeIndex.size;
    if (n === 0) return [];
    const L = Array.from({
        length: n
    }, ()=>new Array(n).fill(0));
    for (const e of edges){
        const i = nodeIndex.get(e.a);
        const j = nodeIndex.get(e.b);
        if (i === undefined || j === undefined || i === j) continue;
        const w = e.w;
        L[i][j] -= w;
        L[j][i] -= w;
        L[i][i] += w;
        L[j][j] += w;
    }
    return jacobiEigenvalues(L, n);
}
function jacobiEigenvalues(A, n) {
    if (n === 1) return [
        A[0][0]
    ];
    const M = A.map((row)=>row.slice());
    const maxSweeps = 100;
    for(let sweep = 0; sweep < maxSweeps; sweep++){
        let off = 0;
        for(let p = 0; p < n; p++)for(let q = p + 1; q < n; q++)off += M[p][q] * M[p][q];
        if (off < 1e-18) break;
        for(let p = 0; p < n; p++){
            for(let q = p + 1; q < n; q++){
                const apq = M[p][q];
                if (Math.abs(apq) < 1e-300) continue;
                const app = M[p][p];
                const aqq = M[q][q];
                const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
                const c = Math.cos(phi);
                const s = Math.sin(phi);
                for(let k = 0; k < n; k++){
                    const mkp = M[k][p];
                    const mkq = M[k][q];
                    M[k][p] = c * mkp - s * mkq;
                    M[k][q] = s * mkp + c * mkq;
                }
                for(let k = 0; k < n; k++){
                    const mpk = M[p][k];
                    const mqk = M[q][k];
                    M[p][k] = c * mpk - s * mqk;
                    M[q][k] = s * mpk + c * mqk;
                }
            }
        }
    }
    const eig = [];
    for(let i = 0; i < n; i++)eig.push(M[i][i]);
    return eig.sort((x, y)=>x - y);
}
export function readSpectral(nodes, edges) {
    const nodeIndex = new Map();
    for (const node of nodes)if (!nodeIndex.has(node)) nodeIndex.set(node, nodeIndex.size);
    for (const e of edges){
        if (!nodeIndex.has(e.a)) nodeIndex.set(e.a, nodeIndex.size);
        if (!nodeIndex.has(e.b)) nodeIndex.set(e.b, nodeIndex.size);
    }
    const eig = laplacianEigenvalues(nodeIndex, edges).map((x)=>Math.abs(x) < ZERO_TOL ? 0 : x);
    const components = eig.filter((x)=>x === 0).length || (nodeIndex.size > 0 ? 1 : 0);
    const fiedler = eig.length > 1 ? eig[components] ?? 0 : 0;
    const lambdaMax = eig.length > 0 ? eig[eig.length - 1] : 0;
    const decayHalfLife = fiedler > ZERO_TOL ? Math.log(2) / fiedler : null;
    return Object.freeze({
        nodes: nodeIndex.size,
        eigenvalues: Object.freeze(eig),
        components,
        fiedler,
        lambdaMax,
        decayHalfLife,
        durable: fiedler <= ZERO_TOL
    });
}
