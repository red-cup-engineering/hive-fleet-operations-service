const str = (v)=>typeof v === "string" ? v : "";
const ACTION_PATTERNS = [
    {
        kind: "comment",
        re: /\b(comment|reply|drop a comment|leave a comment|tell us|share your)\b/i
    },
    {
        kind: "reblog",
        re: /\b(reblog|resteem|re-?blog)\b/i
    },
    {
        kind: "vote",
        re: /\b(upvote|up-?vote|vote for|give it a vote)\b/i
    },
    {
        kind: "follow",
        re: /\b(follow us|follow me|follow the account|give a follow)\b/i
    },
    {
        kind: "delegate",
        re: /\b(delegate|delegation)\b/i
    },
    {
        kind: "post",
        re: /\b(make a post|write a post|create a post|submit a post|enter with a post)\b/i
    }
];
const REWARD_AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*([A-Z][A-Z0-9._-]{1,14})\b/;
const REWARD_VERB_RE = /\b(win|get|earn|receive|reward(?:ed)?|prize|paid|share of)\b/i;
const DEADLINE_RE = /\b(?:deadline|ends?|closes?|until|before)\b[^.\n]{0,40}?(\d{1,2}\s*(?:hours?|days?|h|d)|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\s+\d{1,2})/i;
const NON_REWARD_TOKENS = new Set([
    "I",
    "A",
    "USD",
    "USA",
    "HF",
    "AI",
    "NFT",
    "DAO",
    "OK",
    "PS",
    "TLDR",
    "FYI"
]);
function communityOf(post) {
    const cat = str(post["category"]) || (post.tags ?? []).find(tag => tag.startsWith("hive-")) || "";
    return cat.startsWith("hive-") ? cat : undefined;
}
function extractReward(text) {
    const verbIdx = text.search(REWARD_VERB_RE);
    const scan = verbIdx >= 0 ? text.slice(verbIdx, verbIdx + 80) : text;
    const m = REWARD_AMOUNT_RE.exec(scan) ?? REWARD_AMOUNT_RE.exec(text);
    if (m) {
        const token = (m[2] ?? "").toUpperCase();
        if (!NON_REWARD_TOKENS.has(token)) {
            const amount = Number(m[1].replace(",", "."));
            return Number.isFinite(amount) ? {
                token,
                ...amount > 0 ? {
                    amount
                } : {}
            } : {
                token
            };
        }
    }
    if (verbIdx >= 0) {
        const t = /\b([A-Z][A-Z0-9._-]{2,14})\b/.exec(text.slice(verbIdx, verbIdx + 40));
        if (t && !NON_REWARD_TOKENS.has(t[1])) return {
            token: t[1].toUpperCase()
        };
    }
    return null;
}
function detectActions(text) {
    const actions = [];
    for (const { kind, re } of ACTION_PATTERNS){
        const m = re.exec(text);
        if (m) actions.push(kind);
    }
    return actions;
}
export function parseOffer(post) {
    const author = str(post["author"]);
    const permlink = str(post["permlink"]);
    if (!author || !permlink) return null;
    const title = str(post["title"]);
    const body = str(post["body"]).slice(0, 4000);
    const text = `${title}\n${body}`;
    const actions = detectActions(text);
    const reward = extractReward(text);
    if (actions.length === 0 || reward === null && !REWARD_VERB_RE.test(text)) return null;
    const sentence = (title + ". " + body).split(/(?<=[.!?])\s/).find((s)=>REWARD_VERB_RE.test(s) || ACTION_PATTERNS.some((p)=>p.re.test(s))) ?? title;
    const deadlineMatch = DEADLINE_RE.exec(text);
    const community = communityOf(post);
    return Object.freeze({
        id: `hive.offer.${author}/${permlink}`,
        source: {
            author,
            permlink,
            ...community ? {
                community
            } : {}
        },
        requiredActions: Object.freeze(actions),
        reward,
        ...deadlineMatch ? {
            deadline: deadlineMatch[1]
        } : {},
        rawText: sentence.slice(0, 280),
        evidenceText: text
    });
}
export function ingestOffers(posts = []) {
    const out = [];
    const seen = new Set();
    for (const post of posts){
        const offer = parseOffer(post);
        if (offer && !seen.has(offer.id)) {
            seen.add(offer.id);
            out.push(offer);
        }
    }
    return Object.freeze(out);
}
