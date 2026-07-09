function create(sharedInternalDocumentStore) {
    return {
        sharedInternalDocumentStore,
        rules: new Map()
    };
}
function addRule(store, rule) {
    if (store.rules.has(rule.id)) {
        throw new Error(`PINNING_RULE_ALREADY_EXISTS: A pinning rule with id "${rule.id}" already exists. Use updateRule to modify it.`);
    }
    store.rules.set(rule.id, rule);
}
function updateRule(store, rule) {
    if (!store.rules.has(rule.id)) {
        throw new Error(`PINNING_RULE_NOT_FOUND: Cannot update pinning rule with id "${rule.id}" because it does not exist. Use addRule to create it.`);
    }
    store.rules.set(rule.id, rule);
}
function removeRule(store, ruleId) {
    return store.rules.delete(ruleId);
}
function getRule(store, ruleId) {
    return store.rules.get(ruleId);
}
function getAllRules(store) {
    return Array.from(store.rules.values());
}
function matchesCondition(term, condition) {
    const normalizedTerm = term.toLowerCase().trim();
    const normalizedPattern = condition.pattern.toLowerCase().trim();
    switch (condition.anchoring) {
        case 'is':
            return normalizedTerm === normalizedPattern;
        case 'starts_with':
            return normalizedTerm.startsWith(normalizedPattern);
        case 'contains':
            return normalizedTerm.includes(normalizedPattern);
        default:
            return false;
    }
}
function matchesRule(term, rule) {
    if (!term) {
        return false;
    }
    // All conditions must match (AND logic)
    return rule.conditions.every((condition) => matchesCondition(term, condition));
}
export function getMatchingRules(store, term) {
    if (!term) {
        return [];
    }
    const matchingRules = [];
    for (const rule of store.rules.values()) {
        if (matchesRule(term, rule)) {
            matchingRules.push(rule);
        }
    }
    return matchingRules;
}
export function load(sharedInternalDocumentStore, raw) {
    const rawStore = raw;
    return {
        sharedInternalDocumentStore,
        rules: new Map(rawStore?.rules ?? [])
    };
}
export function save(store) {
    return {
        rules: Array.from(store.rules.entries())
    };
}
export function createPinning() {
    return {
        create,
        addRule,
        updateRule,
        removeRule,
        getRule,
        getAllRules,
        getMatchingRules,
        load,
        save
    };
}
//# sourceMappingURL=pinning.js.map