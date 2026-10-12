// analysis/content — information-theoretic content fitness.
//
// A document's value has a novelty term D_KL(P_d || P_corpus) - the extra
// bits to encode this document's topic mix under the ambient corpus model -
// and a coherence term (low scatter). Genuinely novel-yet-coherent content is
// systematically under-recognised early (the crowd hasn't priced topics it
// hasn't seen), which is precisely where a curation sink hides. Pure noise
// also scores "novel" on KL alone, so novelty is gated by focus (the post is
// about something, not a scattershot tag dump).
//
// Works over the tag distribution — the topic signal already captured in the
// snapshot — so this is feasible without NLP over bodies. KL and entropy in
// nats.

import type { PostCandidate } from "../core/core.adapter.ts";

export interface ContentReading {
  readonly author: string;
  readonly permlink: string;
  readonly novelty: number;
  readonly focus: number;
  readonly fitness: number;
}

function corpusTopicMass(posts: readonly PostCandidate[]): Map<string, number> {
  const mass = new Map<string, number>();
  for (const p of posts) {
    const share = p.tags.length > 0 ? 1 / p.tags.length : 0;
    for (const t of p.tags) mass.set(t, (mass.get(t) ?? 0) + share);
  }
  return mass;
}

function normalisedTagEntropy(tags: readonly string[]): number {
  if (tags.length <= 1) return 0;
  const counts = new Map<string, number>();
  for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const total = tags.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  return h / Math.log(counts.size);
}

/** Read content fitness over a cohort. Corpus topic distribution is built
 *  from the whole cohort, so the set is needed at once. */
export function readContent(posts: readonly PostCandidate[]): Map<string, ContentReading> {
  const out = new Map<string, ContentReading>();
  const corpus = corpusTopicMass(posts);
  const corpusTotal = [...corpus.values()].reduce((s, m) => s + m, 0);
  const SMOOTH = 1e-3;
  const vocab = corpus.size + 1;

  for (const p of posts) {
    const k = p.tags.length;
    let novelty = 0;
    if (k > 0) {
      const pPost = 1 / k;
      for (const t of p.tags) {
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
      fitness,
    }));
  }
  return out;
}
