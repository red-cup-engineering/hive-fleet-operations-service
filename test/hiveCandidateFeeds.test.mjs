import assert from "node:assert/strict";
import test from "node:test";
import { createHiveClient } from "../src/integrations/hive/hive.adapter.mjs";
test("Hive candidate reads route account feeds and blogs through get_account_posts", async ()=>{
    const calls = [];
    const fetchImpl = async (_input, init)=>{
        const request = JSON.parse(String(init?.body));
        calls.push({
            method: request.method,
            params: request.params
        });
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [
                {
                    author: request.method === "bridge.get_account_posts" ? String(request.params.account) : `tag-${request.params.tag || "all"}`,
                    permlink: `${request.params.sort}-post`,
                    title: "live candidate",
                    body: "candidate body",
                    category: "hive",
                    json_metadata: JSON.stringify({
                        tags: [
                            "hive"
                        ]
                    }),
                    pending_payout_value: "0.100 HBD",
                    net_rshares: "10000",
                    children: 1,
                    created: "2026-07-22T00:00:00",
                    active_votes: []
                }
            ]
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const wallet = {
        account: "michael561",
        strategy: {
            feeds: [
                "following",
                "blog:emsenn0",
                "hive-167922",
                "trending"
            ]
        }
    };
    const hive = createHiveClient({
        nodes: [
            "https://example.invalid"
        ],
        timeoutMs: 1000,
        perSourceLimit: 7,
        fetch: fetchImpl
    });
    const posts = await hive.readCandidateField(wallet);
    assert.equal(posts.length, 4);
    assert.deepEqual(calls, [
        {
            method: "bridge.get_account_posts",
            params: {
                sort: "feed",
                account: "michael561",
                limit: 7
            }
        },
        {
            method: "bridge.get_account_posts",
            params: {
                sort: "blog",
                account: "emsenn0",
                limit: 7
            }
        },
        {
            method: "bridge.get_ranked_posts",
            params: {
                sort: "trending",
                tag: "hive-167922",
                observer: "michael561",
                limit: 7
            }
        },
        {
            method: "bridge.get_ranked_posts",
            params: {
                sort: "trending",
                tag: "",
                observer: "michael561",
                limit: 7
            }
        }
    ]);
});
