import test from "node:test";
import assert from "node:assert/strict";
import { detectHolonomy } from "../src/analysis/holonomy.mjs";
function quotedPair(from, to, venue, rate, feeBps = 0) {
    return Object.freeze([
        Object.freeze({
            from,
            to,
            venue,
            rate,
            feeBps
        }),
        Object.freeze({
            from: to,
            to: from,
            venue,
            rate: 1 / rate,
            feeBps
        })
    ]);
}
test("a losing constructed cycle is reversed as hops, not made profitable with an absolute value", ()=>{
    const edges = Object.freeze([
        ...quotedPair("A", "B", "ab", 2),
        ...quotedPair("B", "C", "bc", 2),
        ...quotedPair("C", "A", "ca", 0.2)
    ]);
    const cycles = detectHolonomy(edges, {
        minNetHolonomyBps: 1,
        limit: 10
    });
    assert.equal(cycles.length, 1);
    const cycle = cycles[0];
    const product = cycle.hops.reduce((value, hop)=>value * hop.rate, 1);
    assert.ok(Math.abs(product - 1.25) < 1e-12);
    assert.equal(cycle.path[0], cycle.path.at(-1));
    assert.deepEqual(cycle.path, [
        cycle.hops[0].from,
        ...cycle.hops.map((hop)=>hop.to)
    ]);
    assert.ok(cycle.hops.every((hop, index)=>hop.from === cycle.path[index] && hop.to === cycle.path[index + 1]));
    assert.equal(cycle.grossReturnBps, 2500);
    assert.ok(Math.abs(cycle.holonomyBps - Math.log(1.25) * 10_000) < 0.001);
    assert.equal(cycle.executionAdmissible, false);
    assert.ok(cycle.evidenceGaps.includes("edge-observations-do-not-share-a-proven-atomic-snapshot"));
});
test("parallel venue routes over the same assets remain distinct", ()=>{
    const edges = Object.freeze([
        ...quotedPair("A", "B", "baseline", 2),
        ...quotedPair("A", "B", "venue-two", 3),
        ...quotedPair("A", "B", "venue-three", 4)
    ]);
    const cycles = detectHolonomy(edges, {
        minNetHolonomyBps: 1,
        limit: 10
    });
    assert.equal(cycles.length, 2);
    assert.deepEqual(cycles.map((cycle)=>cycle.grossReturnBps).sort((a, b)=>a - b), [
        5000,
        10000
    ]);
    assert.ok(cycles.some((cycle)=>cycle.venues.includes("venue-two")));
    assert.ok(cycles.some((cycle)=>cycle.venues.includes("venue-three")));
    assert.ok(cycles.every((cycle)=>cycle.venues.includes("baseline")));
});
test("the exact tree quote and its reciprocal do not manufacture a cycle", ()=>{
    assert.deepEqual(detectHolonomy(quotedPair("A", "B", "only", 2), {
        minNetHolonomyBps: 0
    }), []);
});
