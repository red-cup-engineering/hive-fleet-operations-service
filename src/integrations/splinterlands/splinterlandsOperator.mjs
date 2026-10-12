import { createHash } from "node:crypto";
import { accountsWithLane } from "../../core/accountStrategy.mjs";
export const SPLINTERLANDS_OPERATOR_POLICY = Object.freeze({
    account: accountsWithLane("splinterlands")[0] ?? "",
    format: "modern",
    matchType: "Modern Ranked",
    minimumEnergy: 40,
    maximumMatchesPerRun: 1,
    minimumSubmitWindowMs: 25_000,
    authority: "posting",
    inventory: "owned-only"
});
const OWNED_UID = /^C\d+-\d+-[A-Z0-9]+$/u;
const BATTLE_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const SECRET = /^[A-Za-z0-9]{10}$/u;
const CONSERVATIVE_TRANSFER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;
const ELEMENTS = Object.freeze([
    "Red",
    "Blue",
    "Green",
    "White",
    "Black",
    "Gold",
    "Gray"
]);
const ELEMENT_SET = new Set(ELEMENTS);
const BASIC_ELEMENTS = Object.freeze([
    "Red",
    "Blue",
    "Green",
    "White",
    "Black"
]);
const KNOWN_RULES = new Set([
    "Standard",
    "Lost Legendaries",
    "Little League",
    "Rise of the Commons",
    "Taking Sides",
    "Even Stevens",
    "Odd Ones Out",
    "Up Close & Personal",
    "Going the Distance",
    "Wands Out",
    "Keep Your Distance",
    "Broken Arrows",
    "Lost Magic",
    "Picket Lines",
    "Silenced Archons",
    "Are You Not Entertained?",
    "Shades of Gray",
    "FiveAlive",
    "FabFour",
    "Back to Basics",
    "Fog of War",
    "Healed Out",
    "Unprotected",
    "Armored Up",
    "Heavy Metal",
    "Need for Speed",
    "Beefcakes",
    "Might Makes Right",
    "Four’s a Crowd",
    "Four's a Crowd",
    "High Five",
    "Junior Varsity",
    "Elite Force",
    "Fallen Legends",
    "Blood Moon",
    "Rise of the Exemplars",
    "Frostbite",
    "Outsider",
    "Shapeshift Happens",
    "Power of Three"
]);
function record(value, field) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Splinterlands ${field} must be an object`);
    return value;
}
function nonempty(value, field) {
    if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Splinterlands ${field} must be nonempty text`);
    return value.trim();
}
function integer(value, field, minimum = 0) {
    const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Splinterlands ${field} must be an integer of at least ${minimum}`);
    return parsed;
}
function nullableText(value, field) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw new Error(`Splinterlands ${field} must be text or null`);
    return value;
}
function scalarAtLevel(value, level, field, minimum = 0) {
    const candidate = Array.isArray(value) ? value[Math.max(0, level - 1)] ?? value[0] : value;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < minimum) throw new Error(`Splinterlands ${field} is unavailable at card level ${level}`);
    return candidate;
}
function abilitiesAtLevel(value, level) {
    if (value === undefined) return Object.freeze([]);
    if (!Array.isArray(value)) throw new Error("Splinterlands card abilities must be an array");
    if (value.every((ability)=>typeof ability === "string")) return Object.freeze([
        ...new Set(value)
    ]);
    const rows = value.slice(0, level);
    const flattened = rows.flatMap((row)=>{
        if (!Array.isArray(row) || !row.every((ability)=>typeof ability === "string")) throw new Error("Splinterlands card abilities contain malformed level data");
        return row;
    });
    return Object.freeze([
        ...new Set(flattened)
    ]);
}
export function parseSplinterlandsOperatorOwnedCard(value) {
    const row = record(value, "owned card");
    const uid = nonempty(row["uid"], "owned card UID");
    if (!OWNED_UID.test(uid)) throw new Error("invalid owned Splinterlands card UID");
    const delegatedTo = nullableText(row["delegated_to"], "delegated_to");
    const marketIdRaw = row["market_id"];
    const marketId = marketIdRaw === null || marketIdRaw === undefined || marketIdRaw === "" ? null : String(marketIdRaw);
    const listingRaw = row["market_listing_status"];
    const marketListingStatus = listingRaw === null || listingRaw === undefined ? null : integer(listingRaw, "market listing status");
    return Object.freeze({
        uid,
        cardDetailId: integer(row["card_detail_id"], "owned card detail id", 1),
        edition: integer(row["edition"], "owned card edition"),
        level: integer(row["level"], "owned card level", 1),
        delegatedTo,
        marketId,
        marketListingStatus,
        stakeStartDate: nullableText(row["stake_start_date"], "stake_start_date"),
        stakeEndDate: nullableText(row["stake_end_date"], "stake_end_date"),
        lastTransferredDate: nullableText(row["last_transferred_date"], "last_transferred_date")
    });
}
export function parseSplinterlandsOperatorCardDetail(value, level = 1) {
    const row = record(value, "card detail");
    const type = row["type"];
    if (type !== "Summoner" && type !== "Monster") throw new Error("Splinterlands card type must be Summoner or Monster");
    const color = nonempty(row["color"], "card color");
    if (!ELEMENT_SET.has(color)) throw new Error("invalid Splinterlands card color");
    const secondaryRaw = row["secondary_color"];
    const secondaryColor = secondaryRaw === null || secondaryRaw === undefined ? null : nonempty(secondaryRaw, "secondary color");
    if (secondaryColor !== null && !ELEMENT_SET.has(secondaryColor)) throw new Error("invalid Splinterlands secondary color");
    const editions = nonempty(row["editions"], "card editions").split(",").map((edition)=>integer(edition, "card edition"));
    const stats = record(row["stats"], "card stats");
    return Object.freeze({
        id: integer(row["id"], "card detail id", 1),
        name: nonempty(row["name"], "card name"),
        type,
        color,
        secondaryColor,
        rarity: integer(row["rarity"], "card rarity", 1),
        editions: Object.freeze(editions),
        mana: scalarAtLevel(stats["mana"], level, "mana"),
        attack: scalarAtLevel(stats["attack"] ?? 0, level, "attack", Number.NEGATIVE_INFINITY),
        ranged: scalarAtLevel(stats["ranged"] ?? 0, level, "ranged", Number.NEGATIVE_INFINITY),
        magic: scalarAtLevel(stats["magic"] ?? 0, level, "magic", Number.NEGATIVE_INFINITY),
        armor: scalarAtLevel(stats["armor"] ?? 0, level, "armor", Number.NEGATIVE_INFINITY),
        health: scalarAtLevel(stats["health"] ?? 0, level, "health", Number.NEGATIVE_INFINITY),
        speed: scalarAtLevel(stats["speed"] ?? 0, level, "speed", Number.NEGATIVE_INFINITY),
        abilities: abilitiesAtLevel(stats["abilities"], level)
    });
}
function stringList(value, field) {
    if (Array.isArray(value)) {
        if (!value.every((entry)=>typeof entry === "string")) throw new Error(`Splinterlands ${field} must contain text`);
        return Object.freeze(value.map((entry)=>entry.trim()).filter(Boolean));
    }
    if (value === null || value === undefined || value === "") return Object.freeze([]);
    if (typeof value !== "string") throw new Error(`Splinterlands ${field} must be text or an array`);
    return Object.freeze(value.split(/[|,]/u).map((entry)=>entry.trim()).filter(Boolean));
}
export function parseSplinterlandsRuleCatalog(value) {
    if (!Array.isArray(value) || value.length === 0) throw new Error("Splinterlands rule catalog must be a nonempty array");
    const names = new Set();
    return Object.freeze(value.map((entry)=>{
        const row = record(entry, "rule metadata");
        const name = nonempty(row["name"], "rule name");
        if (names.has(name)) throw new Error(`duplicate Splinterlands rule '${name}'`);
        names.add(name);
        if (typeof row["active"] !== "boolean") throw new Error(`Splinterlands rule '${name}' lacks an active flag`);
        const type = row["type"] === null || row["type"] === undefined ? null : nonempty(row["type"], "rule type");
        const excludes = stringList(row["excludeFormats"], "excluded formats").map((format)=>format.toLowerCase());
        return Object.freeze({
            name,
            active: row["active"],
            type,
            minRankedLeague: row["minRankedLeague"] === null || row["minRankedLeague"] === undefined ? 0 : integer(row["minRankedLeague"], "minimum ranked league"),
            excludeFormats: Object.freeze(excludes),
            invalid: stringList(row["invalid"], "invalid rules"),
            invalidTypes: stringList(row["invalidTypes"], "invalid rule types")
        });
    }));
}
export function parseSplinterlandsRankedMatch(value, now = new Date(), ruleCatalog) {
    const row = record(value, "match");
    const id = nonempty(row["id"], "match id");
    if (!BATTLE_ID.test(id)) throw new Error("invalid Splinterlands battle id");
    if (row["match_type"] !== "Ranked") throw new Error("Splinterlands operator accepts Ranked matches only");
    if (String(row["format"] ?? "").toLowerCase() !== "modern") throw new Error("Splinterlands operator accepts Modern matches only");
    const rules = stringList(row["ruleset"], "ruleset");
    const admittedRules = ruleCatalog === undefined ? KNOWN_RULES : new Set(parseSplinterlandsRuleCatalog(ruleCatalog).filter((rule)=>rule.active && !rule.excludeFormats.includes("modern")).map((rule)=>rule.name));
    for (const rule of rules){
        if (!admittedRules.has(rule)) throw new Error(`inactive, excluded, or unknown Splinterlands ruleset '${rule}'`);
    }
    const inactive = stringList(row["inactive"], "inactive elements");
    if (!inactive.every((element)=>ELEMENT_SET.has(element))) throw new Error("Splinterlands match contains an unknown inactive element");
    const submitExpiration = nonempty(row["submit_expiration_date"], "submit expiration");
    const expirationMs = Date.parse(submitExpiration);
    if (!Number.isFinite(expirationMs) || expirationMs - now.getTime() < SPLINTERLANDS_OPERATOR_POLICY.minimumSubmitWindowMs) {
        throw new Error("Splinterlands match lacks the protected submission window");
    }
    return Object.freeze({
        id,
        matchType: "Ranked",
        format: "modern",
        manaCap: integer(row["mana_cap"], "mana cap", 1),
        rules,
        inactive,
        submitExpiration
    });
}
export function admitOneSplinterlandsQueue(input) {
    if (input.account !== SPLINTERLANDS_OPERATOR_POLICY.account) return Object.freeze({
        kind: "refuse",
        reason: "the first operator is hard-bound to michael561"
    });
    if (!Number.isFinite(input.energy) || input.energy < SPLINTERLANDS_OPERATOR_POLICY.minimumEnergy) return Object.freeze({
        kind: "refuse",
        reason: `energy is below the hard ${SPLINTERLANDS_OPERATOR_POLICY.minimumEnergy} floor`
    });
    if (!Number.isSafeInteger(input.outstandingMatches) || input.outstandingMatches !== 0) return Object.freeze({
        kind: "refuse",
        reason: "an outstanding or malformed battle queue exists"
    });
    if (!input.collectionReady) return Object.freeze({
        kind: "refuse",
        reason: "no owned-only Modern team core is ready"
    });
    if (!input.coverageReady) return Object.freeze({
        kind: "refuse",
        reason: "the owned-only roster does not cover every tested live match scenario"
    });
    if (!Number.isSafeInteger(input.alreadyAttempted) || input.alreadyAttempted !== 0) return Object.freeze({
        kind: "refuse",
        reason: "the one-match run budget is already spent"
    });
    return Object.freeze({
        kind: "queue-one",
        reason: "one owned-only Modern Ranked match is admitted under posting authority"
    });
}
function isAvailable(card, account, now) {
    const transferredAt = card.lastTransferredDate === null ? null : Date.parse(card.lastTransferredDate);
    const transferCooled = transferredAt === null || Number.isFinite(transferredAt) && now.getTime() - transferredAt >= CONSERVATIVE_TRANSFER_COOLDOWN_MS;
    return (card.delegatedTo === null || card.delegatedTo === account) && card.marketId === null && card.marketListingStatus === null && card.stakeStartDate === null && card.stakeEndDate === null && transferCooled;
}
function activeSummonerChoices(detail, inactive) {
    if (detail.color === "Gold" || detail.color === "Gray") {
        return BASIC_ELEMENTS.filter((element)=>!inactive.has(element)).map((element)=>Object.freeze({
                elements: Object.freeze([
                    element
                ]),
                element,
                allyColor: element
            }));
    }
    const elements = [
        detail.color,
        ...detail.secondaryColor ? [
            detail.secondaryColor
        ] : []
    ].filter((element)=>!inactive.has(element));
    return elements.length === 0 ? Object.freeze([]) : Object.freeze([
        Object.freeze({
            elements: Object.freeze(elements),
            element: elements[0],
            allyColor: null
        })
    ]);
}
function ruleAllows(detail, rules, summoner) {
    if (rules.has("Little League") && detail.mana > 4) return false;
    if (rules.has("Junior Varsity") && detail.mana > 6) return false;
    if (summoner) return !(rules.has("Fallen Legends") && detail.rarity === 4);
    if (rules.has("Lost Legendaries") && detail.rarity === 4) return false;
    if (rules.has("Rise of the Commons") && detail.rarity > 2) return false;
    if (rules.has("Elite Force") && detail.rarity < 2) return false;
    if (rules.has("Shades of Gray") && detail.color !== "Gray") return false;
    if (rules.has("Taking Sides") && detail.color === "Gray") return false;
    if (rules.has("Even Stevens") && detail.mana % 2 !== 0) return false;
    if (rules.has("Odd Ones Out") && detail.mana % 2 === 0) return false;
    if (rules.has("Up Close & Personal") && detail.attack === 0) return false;
    if (rules.has("Going the Distance") && detail.ranged === 0) return false;
    if (rules.has("Wands Out") && detail.magic === 0) return false;
    if (rules.has("Keep Your Distance") && detail.attack > 0) return false;
    if (rules.has("Broken Arrows") && detail.ranged > 0) return false;
    if (rules.has("Lost Magic") && detail.magic > 0) return false;
    if (rules.has("Picket Lines") && detail.color !== "Gray") return false;
    if (rules.has("Heavy Metal") && detail.armor === 0) return false;
    if (rules.has("Beefcakes") && detail.health < 5) return false;
    if (rules.has("Need for Speed") && detail.speed < 3) return false;
    if (rules.has("Might Makes Right") && Math.max(detail.attack, detail.ranged, detail.magic) < 3) return false;
    return true;
}
function unitScore(detail) {
    return detail.health * 2 + detail.armor * 2 + detail.speed + (detail.attack + detail.ranged + detail.magic) * 3 + detail.abilities.length * 2 + detail.mana / 100;
}
function teamLimit(rules) {
    if (rules.has("FabFour") || rules.has("Four’s a Crowd") || rules.has("Four's a Crowd")) return 4;
    if (rules.has("FiveAlive") || rules.has("High Five")) return 5;
    return 6;
}
function better(left, right) {
    const score = (cards)=>cards.reduce((sum, entry)=>sum + unitScore(entry.detail), 0);
    const leftScore = score(left);
    const rightScore = score(right);
    if (leftScore !== rightScore) return leftScore > rightScore ? left : right;
    const leftMana = left.reduce((sum, entry)=>sum + entry.detail.mana, 0);
    const rightMana = right.reduce((sum, entry)=>sum + entry.detail.mana, 0);
    if (leftMana !== rightMana) return leftMana > rightMana ? left : right;
    const leftIds = left.map((entry)=>entry.card.uid).sort().join(",");
    const rightIds = right.map((entry)=>entry.card.uid).sort().join(",");
    return leftIds <= rightIds ? left : right;
}
function selectUnits(candidates, mana, limit) {
    const unique = [
        ...new Map([
            ...candidates
        ].sort((left, right)=>right.card.level - left.card.level || left.card.uid.localeCompare(right.card.uid)).map((entry)=>[
                entry.card.cardDetailId,
                entry
            ])).values()
    ];
    const states = new Map();
    states.set("0:0", Object.freeze([]));
    for (const candidate of unique){
        const snapshot = [
            ...states.entries()
        ];
        for (const [key, chosen] of snapshot){
            const [usedText = "0", countText = "0"] = key.split(":");
            const used = Number(usedText);
            const count = Number(countText);
            const nextMana = used + candidate.detail.mana;
            if (count >= limit || nextMana > mana) continue;
            const next = Object.freeze([
                ...chosen,
                candidate
            ]);
            const nextKey = `${nextMana}:${count + 1}`;
            const prior = states.get(nextKey);
            states.set(nextKey, prior ? better(prior, next) : next);
        }
    }
    return [
        ...states.values()
    ].reduce((best, cards)=>cards.length === 0 ? best : better(best, cards), Object.freeze([]));
}
function orderUnits(units) {
    return Object.freeze([
        ...units
    ].sort((left, right)=>{
        const leftFront = left.detail.health * 3 + left.detail.armor * 3 + left.detail.attack * 2 - left.detail.ranged;
        const rightFront = right.detail.health * 3 + right.detail.armor * 3 + right.detail.attack * 2 - right.detail.ranged;
        return rightFront - leftFront || right.detail.speed - left.detail.speed || left.card.uid.localeCompare(right.card.uid);
    }));
}
function prepareOwnedModernCandidates(input) {
    if (input.account !== SPLINTERLANDS_OPERATOR_POLICY.account) throw new Error("Splinterlands team selection is hard-bound to michael561");
    const modern = new Set(input.modernEditions.map((edition)=>integer(edition, "Modern edition", 1)));
    if (modern.size === 0) throw new Error("Splinterlands Modern edition set is empty");
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("Splinterlands selection time is invalid");
    const owned = input.owned.map(parseSplinterlandsOperatorOwnedCard).filter((card)=>modern.has(card.edition) && isAvailable(card, input.account, now));
    const rawDetails = new Map(input.details.map((value)=>{
        const row = record(value, "card detail");
        return [
            integer(row["id"], "card detail id", 1),
            value
        ];
    }));
    const candidates = [];
    for (const card of owned){
        const raw = rawDetails.get(card.cardDetailId);
        if (!raw) continue;
        const detail = parseSplinterlandsOperatorCardDetail(raw, card.level);
        if (!detail.editions.includes(card.edition)) continue;
        candidates.push(Object.freeze({
            card,
            detail
        }));
    }
    return Object.freeze(candidates);
}
function selectTeamFromCandidates(match, candidates) {
    const inactive = new Set(match.inactive);
    const rules = new Set(match.rules);
    const summoners = candidates.filter((candidate)=>candidate.detail.type === "Summoner" && ruleAllows(candidate.detail, rules, true) && activeSummonerChoices(candidate.detail, inactive).length > 0);
    let best = null;
    for (const summoner of summoners){
        for (const choice of activeSummonerChoices(summoner.detail, inactive)){
            const monsters = candidates.filter((candidate)=>candidate.detail.type === "Monster" && ruleAllows(candidate.detail, rules, false) && (candidate.detail.color === "Gray" || choice.elements.includes(candidate.detail.color) || candidate.detail.secondaryColor !== null && choice.elements.includes(candidate.detail.secondaryColor)));
            const remainingMana = match.manaCap - summoner.detail.mana;
            if (remainingMana < 0) continue;
            const selected = orderUnits(selectUnits(monsters, remainingMana, teamLimit(rules)));
            if (selected.length === 0) continue;
            const mana = summoner.detail.mana + selected.reduce((sum, entry)=>sum + entry.detail.mana, 0);
            const score = selected.reduce((sum, entry)=>sum + unitScore(entry.detail), 0);
            const team = Object.freeze({
                summoner: summoner.card,
                monsters: Object.freeze(selected.map((entry)=>entry.card)),
                mana,
                score,
                element: choice.element,
                allyColor: choice.allyColor
            });
            if (!best || team.score > best.score || team.score === best.score && team.summoner.uid < best.summoner.uid) best = team;
        }
    }
    if (!best) throw new Error("no legal owned-only Modern team exists for this match");
    return best;
}
export function selectOwnedModernTeam(input) {
    return selectTeamFromCandidates(input.match, prepareOwnedModernCandidates(input));
}
export function assessOwnedModernCoverage(input) {
    const manaCap = input.manaCap ?? 20;
    if (!Number.isSafeInteger(manaCap) || manaCap < 1 || manaCap > 99) throw new Error("Splinterlands coverage mana cap must be an integer from 1 through 99");
    const match = (rules, inactive)=>Object.freeze({
            id: "coverage_12345678",
            matchType: "Ranked",
            format: "modern",
            manaCap,
            rules: Object.freeze([
                ...rules
            ]),
            inactive: Object.freeze([
                ...inactive
            ]),
            submitExpiration: "9999-12-31T23:59:59.000Z"
        });
    const candidates = prepareOwnedModernCandidates(input);
    const playable = (rules, inactive)=>{
        try {
            selectTeamFromCandidates(match(rules, inactive), candidates);
            return true;
        } catch  {
            return false;
        }
    };
    const rankedLeague = input.rankedLeague ?? 0;
    if (!Number.isSafeInteger(rankedLeague) || rankedLeague < 0) throw new Error("Splinterlands ranked league must be a nonnegative integer");
    const catalog = input.ruleCatalog === undefined ? [
        ...KNOWN_RULES
    ].sort().map((name)=>Object.freeze({
            name,
            active: true,
            type: null,
            minRankedLeague: 0,
            excludeFormats: Object.freeze([]),
            invalid: Object.freeze([]),
            invalidTypes: Object.freeze([])
        })) : parseSplinterlandsRuleCatalog(input.ruleCatalog).filter((rule)=>rule.active && !rule.excludeFormats.includes("modern") && rule.minRankedLeague <= rankedLeague).sort((left, right)=>left.name.localeCompare(right.name));
    const compatible = (left, right)=>{
        if (left.name === "Standard" || right.name === "Standard") return false;
        return !left.invalid.includes(right.name) && !right.invalid.includes(left.name) && !(right.type !== null && left.invalidTypes.includes(right.type)) && !(left.type !== null && right.invalidTypes.includes(left.type));
    };
    const ruleCombinations = (()=>{
        const combinations = catalog.map((rule)=>[
                rule
            ]);
        const nonstandard = catalog.filter((rule)=>rule.name !== "Standard");
        for(let left = 0; left < nonstandard.length; left += 1){
            for(let right = left + 1; right < nonstandard.length; right += 1){
                const pair = [
                    nonstandard[left],
                    nonstandard[right]
                ];
                if (!compatible(pair[0], pair[1])) continue;
                combinations.push(pair);
                for(let third = right + 1; third < nonstandard.length; third += 1){
                    const candidate = nonstandard[third];
                    if (pair.every((rule)=>compatible(rule, candidate))) combinations.push([
                        ...pair,
                        candidate
                    ]);
                }
            }
        }
        return combinations;
    })();
    const labels = ruleCombinations.map((rules)=>rules.map((rule)=>rule.name).join("|"));
    const ruleNames = ruleCombinations.map((rules)=>rules.map((rule)=>rule.name));
    const singleRules = catalog.map((rule)=>rule.name);
    const playableSingleRules = singleRules.filter((rule)=>playable([
            rule
        ], []));
    const unplayableSingleRules = singleRules.filter((rule)=>!playable([
            rule
        ], []));
    const unplayableRuleCombinations = labels.filter((_label, index)=>!playable(ruleNames[index], []));
    const splinters = [
        ...BASIC_ELEMENTS,
        "Gold"
    ];
    const pairs = [];
    for(let left = 0; left < splinters.length; left += 1){
        for(let right = left + 1; right < splinters.length; right += 1)pairs.push([
            splinters[left],
            splinters[right]
        ]);
    }
    const pairLabel = (pair)=>pair.join("+");
    const playableInactivePairs = pairs.filter((pair)=>playable([
            "Standard"
        ], pair)).map(pairLabel);
    const unplayableInactivePairs = pairs.filter((pair)=>!playable([
            "Standard"
        ], pair)).map(pairLabel);
    const unplayableCombinedScenarios = [];
    for(let ruleIndex = 0; ruleIndex < ruleNames.length; ruleIndex += 1){
        for (const inactive of pairs){
            if (!playable(ruleNames[ruleIndex], inactive)) {
                unplayableCombinedScenarios.push(`${labels[ruleIndex]} @ ${pairLabel(inactive)}`);
            }
        }
    }
    return Object.freeze({
        readyForUnattendedQueue: unplayableCombinedScenarios.length === 0,
        manaCap,
        singleRulesTested: singleRules.length,
        playableSingleRules: Object.freeze(playableSingleRules),
        unplayableSingleRules: Object.freeze(unplayableSingleRules),
        ruleCombinationsTested: ruleCombinations.length,
        unplayableRuleCombinations: Object.freeze(unplayableRuleCombinations),
        inactivePairsTested: pairs.length,
        playableInactivePairs: Object.freeze(playableInactivePairs),
        unplayableInactivePairs: Object.freeze(unplayableInactivePairs),
        combinedScenariosTested: ruleCombinations.length * pairs.length,
        unplayableCombinedScenarios: Object.freeze(unplayableCombinedScenarios),
        limitation: "live active league-applicable legal combinations of one through three rules are crossed with every two-inactive-splinter pair at the stated mana cap; lower mana caps and future protocol semantics remain separate admission work"
    });
}
export function splinterlandsTeamHash(team, secret) {
    if (!SECRET.test(secret)) throw new Error("Splinterlands team secret must be exactly ten alphanumeric characters");
    const uids = [
        team.summoner.uid,
        ...team.monsters.map((monster)=>monster.uid)
    ];
    if (new Set(uids).size !== uids.length) throw new Error("Splinterlands team contains a duplicate card UID");
    return createHash("md5").update(`${uids.join(",")},${secret}`, "utf8").digest("hex");
}
export function buildSplinterlandsSubmitTeamData(match, team, secret) {
    if (team.monsters.length < 1 || team.monsters.length > teamLimit(new Set(match.rules))) throw new Error("Splinterlands team violates the match unit limit");
    if (team.mana > match.manaCap) throw new Error("Splinterlands team exceeds the match mana cap");
    return Object.freeze({
        trx_id: match.id,
        team_hash: splinterlandsTeamHash(team, secret),
        summoner: team.summoner.uid,
        monsters: Object.freeze(team.monsters.map((monster)=>monster.uid)),
        secret,
        match_type: "Ranked Modern",
        allyColor: team.allyColor
    });
}
function operationEnvelope(account, id, data, version, nonce) {
    if (account !== SPLINTERLANDS_OPERATOR_POLICY.account) throw new Error("Splinterlands battle operation is hard-bound to michael561");
    if (!/^0\.\d+\.\d+$/u.test(version)) throw new Error("invalid Splinterlands client version");
    if (!SECRET.test(nonce)) throw new Error("Splinterlands operation nonce must be exactly ten alphanumeric characters");
    const requiredAuths = Object.freeze([]);
    const requiredPostingAuths = Object.freeze([
        account
    ]);
    return Object.freeze([
        "custom_json",
        Object.freeze({
            required_auths: requiredAuths,
            required_posting_auths: requiredPostingAuths,
            id,
            json: JSON.stringify({
                ...data,
                app: `splinterlands/${version}`,
                n: nonce
            })
        })
    ]);
}
export function splinterlandsFindMatchOperation(account, version, nonce) {
    return operationEnvelope(account, "sm_find_match", Object.freeze({
        match_type: "Modern Ranked"
    }), version, nonce);
}
export function splinterlandsSubmitTeamOperation(account, version, nonce, data) {
    return operationEnvelope(account, "sm_submit_team", data, version, nonce);
}
export function splinterlandsSurrenderOperation(account, version, nonce, battleQueueId) {
    if (!BATTLE_ID.test(battleQueueId)) throw new Error("invalid Splinterlands surrender battle id");
    return operationEnvelope(account, "sm_surrender", Object.freeze({
        battle_queue_id: battleQueueId
    }), version, nonce);
}
export function buildSplinterlandsUnsignedBattleTransaction(operation, chainProps) {
    const props = record(chainProps, "chain properties");
    const refBlockNum = integer(props["ref_block_num"], "reference block number", 1);
    const refBlockPrefix = integer(props["ref_block_prefix"], "reference block prefix");
    if (refBlockPrefix > 0xffff_ffff) throw new Error("Splinterlands reference block prefix exceeds uint32");
    const chainTime = nonempty(props["time"], "chain time");
    const chainTimeMs = Date.parse(`${chainTime.endsWith("Z") ? chainTime : `${chainTime}Z`}`);
    if (!Number.isFinite(chainTimeMs)) throw new Error("invalid Splinterlands chain time");
    const [kind, payload] = operation;
    if (kind !== "custom_json" || payload.required_auths.length !== 0 || payload.required_posting_auths.length !== 1 || payload.required_posting_auths[0] !== SPLINTERLANDS_OPERATOR_POLICY.account || ![
        "sm_find_match",
        "sm_submit_team",
        "sm_surrender"
    ].includes(payload.id)) {
        throw new Error("Splinterlands transaction requires exactly one admitted posting-only battle operation");
    }
    const operations = Object.freeze([
        operation
    ]);
    const extensions = Object.freeze([]);
    return Object.freeze({
        ref_block_num: refBlockNum & 0xffff,
        ref_block_prefix: refBlockPrefix,
        expiration: new Date(chainTimeMs + 10 * 60 * 1_000).toISOString().replace(/\.\d{3}Z$/u, ""),
        operations,
        extensions
    });
}
export function reconcileSplinterlandsBattle(input) {
    if (input.account !== SPLINTERLANDS_OPERATOR_POLICY.account) throw new Error("Splinterlands settlement account mismatch");
    if (!BATTLE_ID.test(input.battleId)) throw new Error("invalid Splinterlands settlement battle id");
    for (const [field, value] of [
        [
            "before rating",
            input.beforeRating
        ],
        [
            "after rating",
            input.afterRating
        ],
        [
            "before energy",
            input.beforeEnergy
        ],
        [
            "after energy",
            input.afterEnergy
        ]
    ]){
        if (!Number.isFinite(value)) throw new Error(`Splinterlands ${field} must be finite`);
    }
    if (input.afterEnergy > input.beforeEnergy) throw new Error("Splinterlands energy increased across a supposedly bound battle");
    const row = record(input.result, "battle result");
    const observedId = String(row["id"] ?? row["battle_queue_id_1"] ?? row["battle_queue_id_2"] ?? "");
    if (observedId !== input.battleId) throw new Error("Splinterlands result is not bound to the submitted battle id");
    const player1 = nonempty(row["player_1"], "result player_1");
    const player2 = nonempty(row["player_2"], "result player_2");
    if (player1 !== input.account && player2 !== input.account) throw new Error("Splinterlands result does not contain the operator account");
    const opponent = player1 === input.account ? player2 : player1;
    const winnerRaw = row["winner"];
    const winner = winnerRaw === null || winnerRaw === undefined || winnerRaw === "" ? null : String(winnerRaw);
    if (winner !== null && winner !== player1 && winner !== player2) throw new Error("Splinterlands result names an unknown winner");
    const reward = (name)=>{
        const value = row[name];
        if (value === null || value === undefined || value === "") return "0";
        const text = String(value);
        if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text)) throw new Error(`Splinterlands ${name} is not a canonical amount`);
        return text;
    };
    return Object.freeze({
        kind: winner === null ? "draw" : winner === input.account ? "won" : "lost",
        battleId: input.battleId,
        account: input.account,
        opponent,
        ratingDelta: input.afterRating - input.beforeRating,
        energyDelta: input.afterEnergy - input.beforeEnergy,
        rewardSps: reward("reward_sps"),
        rewardGlint: reward("reward_glint")
    });
}
