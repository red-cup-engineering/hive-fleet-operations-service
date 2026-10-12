import assert from "node:assert/strict";
import test from "node:test";
import { cycleSpace } from "../src/analysis/graph.mjs";
test("a tree has b1 = 0 and one component", ()=>{
    const reading = cycleSpace([
        "a",
        "b",
        "c"
    ], [
        {
            a: "a",
            b: "b"
        },
        {
            a: "b",
            b: "c"
        }
    ]);
    assert.equal(reading.nodes, 3);
    assert.equal(reading.edges, 2);
    assert.equal(reading.components, 1);
    assert.equal(reading.b1, 0);
});
test("a triangle has one independent cycle", ()=>{
    const reading = cycleSpace([], [
        {
            a: "a",
            b: "b"
        },
        {
            a: "b",
            b: "c"
        },
        {
            a: "c",
            b: "a"
        }
    ]);
    assert.equal(reading.nodes, 3);
    assert.equal(reading.edges, 3);
    assert.equal(reading.components, 1);
    assert.equal(reading.b1, 1);
});
test("two disjoint components are counted separately, and a self-loop is dropped", ()=>{
    const reading = cycleSpace([
        "isolated"
    ], [
        {
            a: "a",
            b: "b"
        },
        {
            a: "c",
            b: "c"
        }
    ]);
    assert.equal(reading.nodes, 4);
    assert.equal(reading.edges, 1);
    assert.equal(reading.components, 3);
    assert.equal(reading.b1, 0);
});
test("an empty graph has zero of everything", ()=>{
    const reading = cycleSpace([], []);
    assert.deepEqual(reading, {
        nodes: 0,
        edges: 0,
        components: 0,
        b1: 0,
        cycleDensity: 0
    });
});
