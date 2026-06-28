function normalizeCategory(raw, meta) {
    if (!raw) return null;

    let normalized;
    if (Array.isArray(raw)) {
        normalized = {
            channelId: raw[0] ?? null,
            inboxId: raw[1] ?? null,
            anonymous: raw[2] ?? false,
            description: null,
            emoji: null,
            staffRoleId: null,
            supervisorRoleId: null,
            requiredRoleId: null,
        };
    } else {
        normalized = {
            channelId: raw.channelId ?? null,
            inboxId: raw.inboxId ?? null,
            anonymous: raw.anonymous ?? false,
            description: raw.description ?? null,
            emoji: raw.emoji ?? null,
            staffRoleId: raw.staffRoleId ?? null,
            supervisorRoleId: raw.supervisorRoleId ?? null,
            requiredRoleId: raw.requiredRoleId ?? null,
        };
    }

    if (meta) {
        if (!normalized.description && meta.description) normalized.description = meta.description;
        if (!normalized.emoji && meta.emoji) normalized.emoji = meta.emoji;
    }

    return normalized;
}

function normalizeCategories(config) {
    const layout = config?.layout;
    if (!layout?.categories) return;
    const meta = layout.categoryMeta ?? {};
    const out = {};
    for (const [name, raw] of Object.entries(layout.categories)) {
        out[name] = normalizeCategory(raw, meta[name]);
    }
    layout.categories = out;
    delete layout.categoryMeta;
}

function getCategory(config, name) {
    const raw = config?.layout?.categories?.[name];
    if (!raw) return null;
    if (Array.isArray(raw) || raw.staffRoleId === undefined) {
        return normalizeCategory(raw, config?.layout?.categoryMeta?.[name]);
    }
    return raw;
}

function memberHasCategoryAccess(member, config, categoryName, { requireSupervisor = false, supervisorPreferred = false } = {}) {
    if (!member) return false;
    const ownerId = member.guild?.ownerId;
    if (ownerId && member.id === ownerId) return true;

    const globalSupervisor = config?.access?.supervisorRoleID;
    if (globalSupervisor && member.roles.cache.has(globalSupervisor)) return true;

    const category = getCategory(config, categoryName);
    if (!category) return false;

    if (category.supervisorRoleId && member.roles.cache.has(category.supervisorRoleId)) return true;
    if (requireSupervisor) return false;

    // supervisorPreferred: staff may only access if no supervisor role is configured at any level
    if (supervisorPreferred && (globalSupervisor || category.supervisorRoleId)) return false;

    if (category.staffRoleId && member.roles.cache.has(category.staffRoleId)) return true;
    return false;
}


function orderCategoryNames(names, order) {
    const list = Array.isArray(names) ? [...names] : [];
    if (!Array.isArray(order) || order.length === 0) return list;
    const rank = name => {
        const i = order.indexOf(name);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return list.sort((a, b) => rank(a) - rank(b));
}

module.exports = {
    normalizeCategory,
    normalizeCategories,
    getCategory,
    memberHasCategoryAccess,
    orderCategoryNames,
};
