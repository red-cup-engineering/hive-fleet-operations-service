import { createJsonRpcTransport, callJsonRpc } from "@red-cup-engineering/http-services-section/json-rpc";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function createSerializedHiveEngineRpc(options) {
    if (options.nodes.length === 0 || new Set(options.nodes).size !== options.nodes.length || options.nodes.some((node)=>!/^https:\/\//u.test(node)) || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 250 || !Number.isSafeInteger(options.attemptsPerNode ?? 1) || (options.attemptsPerNode ?? 1) < 1 || (options.attemptsPerNode ?? 1) > 3) {
        throw new TypeError("serialized Hive Engine RPC options are malformed");
    }
    const fetchImpl = options.fetch ?? fetch;
    const attempts = options.attemptsPerNode ?? 1;
    let nextId = 1;
    let tail = Promise.resolve();
    async function withSlot(read) {
        const predecessor = tail;
        let release;
        tail = new Promise((resolvePromise)=>{
            release = resolvePromise;
        });
        await predecessor;
        try {
            return await read();
        } finally{
            release();
        }
    }
    async function find(contract, table, query, limit, offset = 0, indexes) {
        if (!/^[A-Za-z0-9.-]{1,50}$/u.test(contract) || !/^[A-Za-z0-9.-]{1,80}$/u.test(table) || !isRecord(query) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000 || !Number.isSafeInteger(offset) || offset < 0) throw new TypeError("Hive Engine find request is malformed");
        return await withSlot(async ()=>{
            let lastError;
            for (const node of options.nodes){
                for(let attempt = 0; attempt < attempts; attempt += 1){
                    try {
                        const result = await callJsonRpc(createJsonRpcTransport({
                            fetchImpl,
                            timeout: options.timeoutMs
                        }), node, {
                            jsonrpc: "2.0",
                            id: nextId++,
                            method: "find",
                            params: {
                                contract,
                                table,
                                query,
                                limit,
                                offset,
                                ...indexes ? {
                                    indexes
                                } : {}
                            }
                        });
                        if (!Array.isArray(result) || !result.every(isRecord)) {
                            throw new Error(`Hive Engine ${contract}.${table} returned malformed rows`);
                        }
                        return Object.freeze(result);
                    } catch (error) {
                        lastError = error;
                    }
                }
            }
            throw lastError instanceof Error ? lastError : new Error(String(lastError));
        });
    }
    return Object.freeze({
        find
    });
}
