// analysis/spectral — the spectral ceiling on durable alpha.
//
// The alpha radar gives total mispricing energy E(r) and the capturable sinks,
// approximating decay with a component count. This computes the real Laplacian
// spectrum of the attention graph, and from it the algebraic connectivity λ₂
// (the Fiedler value).
//
// Why λ₂ is the number for durable alpha: expand the reward field in the
// Laplacian eigenbasis, E(r) = Σ_k λ_k ⟨r,φ_k⟩². The market corrects mispricing
// by diffusion, and the diffusion rate on the slowest non-trivial mode is λ₂. So
// λ₂ is the decay constant on every edge found:
//   • large λ₂ (well-mixed attention) → fast correction → thin, fleeting alpha;
//   • small λ₂ → slow correction → fat, persistent alpha;
//   • λ₂ = 0 (the graph is disconnected: cartels, whale silos) → never corrects.
// The number of zero eigenvalues is exactly the component count.
//
// Computed by a Jacobi eigenvalue sweep over the dense symmetric Laplacian in
// native numbers — exact enough at the fleet's graph scale (tens-low-hundreds
// of nodes).

export interface WeightedEdge {
  readonly a: string;
  readonly b: string;
  readonly w: number;
}

export interface SpectralReading {
  readonly nodes: number;
  readonly eigenvalues: readonly number[];
  readonly components: number;
  readonly fiedler: number;
  readonly lambdaMax: number;
  readonly decayHalfLife: number;
  readonly durable: boolean;
}

const ZERO_TOL = 1e-9;

function laplacianEigenvalues(nodeIndex: ReadonlyMap<string, number>, edges: readonly WeightedEdge[]): number[] {
  const n = nodeIndex.size;
  if (n === 0) return [];
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const e of edges) {
    const i = nodeIndex.get(e.a);
    const j = nodeIndex.get(e.b);
    if (i === undefined || j === undefined || i === j) continue;
    const w = e.w;
    L[i]![j]! -= w;
    L[j]![i]! -= w;
    L[i]![i]! += w;
    L[j]![j]! += w;
  }
  return jacobiEigenvalues(L, n);
}

function jacobiEigenvalues(A: number[][], n: number): number[] {
  if (n === 1) return [A[0]![0]!];
  const M = A.map((row) => row.slice());
  const maxSweeps = 100;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += M[p]![q]! * M[p]![q]!;
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = M[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const app = M[p]![p]!;
        const aqq = M[q]![q]!;
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let k = 0; k < n; k++) {
          const mkp = M[k]![p]!;
          const mkq = M[k]![q]!;
          M[k]![p]! = c * mkp - s * mkq;
          M[k]![q]! = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = M[p]![k]!;
          const mqk = M[q]![k]!;
          M[p]![k]! = c * mpk - s * mqk;
          M[q]![k]! = s * mpk + c * mqk;
        }
      }
    }
  }
  const eig: number[] = [];
  for (let i = 0; i < n; i++) eig.push(M[i]![i]!);
  return eig.sort((x, y) => x - y);
}

/** Read the spectral decay structure of a weighted attention graph. */
export function readSpectral(nodes: Iterable<string>, edges: readonly WeightedEdge[]): SpectralReading {
  const nodeIndex = new Map<string, number>();
  for (const node of nodes) if (!nodeIndex.has(node)) nodeIndex.set(node, nodeIndex.size);
  for (const e of edges) {
    if (!nodeIndex.has(e.a)) nodeIndex.set(e.a, nodeIndex.size);
    if (!nodeIndex.has(e.b)) nodeIndex.set(e.b, nodeIndex.size);
  }
  const eig = laplacianEigenvalues(nodeIndex, edges).map((x) => (Math.abs(x) < ZERO_TOL ? 0 : x));
  const components = eig.filter((x) => x === 0).length || (nodeIndex.size > 0 ? 1 : 0);
  const fiedler = eig.length > 1 ? eig[components] ?? 0 : 0;
  const lambdaMax = eig.length > 0 ? eig[eig.length - 1]! : 0;
  const decayHalfLife = fiedler > ZERO_TOL ? Math.log(2) / fiedler : Infinity;
  return Object.freeze({
    nodes: nodeIndex.size,
    eigenvalues: Object.freeze(eig),
    components,
    fiedler,
    lambdaMax,
    decayHalfLife,
    durable: fiedler <= ZERO_TOL,
  });
}
