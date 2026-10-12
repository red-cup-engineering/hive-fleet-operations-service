import assert from "node:assert/strict";
import test from "node:test";
import { createSerializedHiveEngineRpc } from "../src/integrations/hive-engine/serializedRpc.mjs";
test("shared Hive Engine reader serializes simultaneous callers and retries a non-JSON gateway response", async ()=>{
    let inFlight = 0;
    let maximumInFlight = 0;
    let calls = 0;
    const fetchMock = async ()=>{
        calls += 1;
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await new Promise((resolvePromise)=>setTimeout(resolvePromise, 5));
        inFlight -= 1;
        if (calls === 1) return new Response("<html>gateway</html>", {
            status: 200
        });
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: calls,
            result: [
                {
                    _id: calls
                }
            ]
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const rpc = createSerializedHiveEngineRpc({
        nodes: [
            "https://one.example/contracts"
        ],
        timeoutMs: 1_000,
        attemptsPerNode: 2,
        fetch: fetchMock
    });
    const rows = await Promise.all(Array.from({
        length: 5
    }, (_, index)=>rpc.find("nft", `TOKEN${index}instances`, {}, 10)));
    assert.equal(maximumInFlight, 1);
    assert.equal(calls, 6);
    assert.equal(rows.length, 5);
});
test("shared Hive Engine reader fails over providers without widening malformed requests", async ()=>{
    const seen = [];
    const rpc = createSerializedHiveEngineRpc({
        nodes: [
            "https://one.example/contracts",
            "https://two.example/contracts"
        ],
        timeoutMs: 1_000,
        fetch: async (input)=>{
            seen.push(String(input));
            return String(input).includes("one.example") ? new Response("down", {
                status: 503
            }) : new Response(JSON.stringify({
                result: [
                    {
                        symbol: "SIM"
                    }
                ]
            }), {
                status: 200
            });
        }
    });
    assert.deepEqual(await rpc.find("tokens", "tokens", {
        symbol: "SIM"
    }, 2), [
        {
            symbol: "SIM"
        }
    ]);
    assert.equal(seen.length, 2);
    await assert.rejects(rpc.find("nft", "bad/table", {}, 1), /malformed/u);
});
