const {
    normalizeCategory,
    normalizeCategories,
    getCategory,
    memberHasCategoryAccess,
    orderCategoryNames,
} = require('../../utils/categoryAcl');

describe('normalizeCategory', () => {
    test('upgrades a legacy [channelId, inboxId, anonymous] tuple', () => {
        expect(normalizeCategory(['c1', 'i1', true])).toEqual({
            channelId: 'c1',
            inboxId: 'i1',
            anonymous: true,
            description: null,
            emoji: null,
            staffRoleId: null,
            supervisorRoleId: null,
            requiredRoleId: null,
        });
    });

    test('passes an object form through unchanged', () => {
        const input = {
            channelId: 'c1',
            inboxId: 'i1',
            anonymous: false,
            description: 'd',
            emoji: 'e',
            staffRoleId: 'rs',
            supervisorRoleId: 'rv',
            requiredRoleId: null,
        };
        expect(normalizeCategory(input)).toEqual(input);
    });

    test('preserves requiredRoleId so the open-ticket role gate is enforced', () => {
        const input = {
            channelId: 'c1',
            inboxId: 'i1',
            anonymous: false,
            requiredRoleId: 'verified',
        };
        const out = normalizeCategory(input);
        expect(out.requiredRoleId).toBe('verified');
    });

    test('folds in legacy categoryMeta description and emoji', () => {
        const out = normalizeCategory(['c1', 'i1', false], { description: 'd', emoji: 'e' });
        expect(out.description).toBe('d');
        expect(out.emoji).toBe('e');
    });

    test('returns null for falsy raw', () => {
        expect(normalizeCategory(null)).toBeNull();
        expect(normalizeCategory(undefined)).toBeNull();
    });
});

describe('normalizeCategories', () => {
    test('rewrites layout.categories in place and removes layout.categoryMeta', () => {
        const config = {
            layout: {
                categories: {
                    'General Support': ['c1', 'i1', false],
                },
                categoryMeta: {
                    'General Support': { description: 'd', emoji: 'e' },
                },
            },
        };
        normalizeCategories(config);
        expect(config.layout.categories['General Support']).toEqual({
            channelId: 'c1',
            inboxId: 'i1',
            anonymous: false,
            description: 'd',
            emoji: 'e',
            staffRoleId: null,
            supervisorRoleId: null,
            requiredRoleId: null,
        });
        expect(config.layout.categoryMeta).toBeUndefined();
    });

    test('is a no-op when there are no categories', () => {
        const config = {};
        normalizeCategories(config);
        expect(config).toEqual({});
    });
});

describe('getCategory', () => {
    test('returns the normalized category object', () => {
        const config = {
            layout: {
                categories: {
                    'General Support': {
                        channelId: 'c1',
                        inboxId: 'i1',
                        anonymous: false,
                        staffRoleId: 'rs',
                        supervisorRoleId: null,
                        description: null,
                        emoji: null,
                    },
                },
            },
        };
        expect(getCategory(config, 'General Support').staffRoleId).toBe('rs');
    });

    test('returns null for unknown categories', () => {
        expect(getCategory({ layout: { categories: {} } }, 'X')).toBeNull();
    });
});

function fakeMember({ id = 'u', ownerId = 'owner', roles = [] } = {}) {
    return {
        id,
        guild: { ownerId },
        roles: { cache: { has: (r) => roles.includes(r) } },
    };
}

const config = {
    access: { supervisorRoleID: 'global_sup' },
    layout: {
        categories: {
            'General Support': {
                channelId: 'c1',
                inboxId: 'i1',
                anonymous: false,
                staffRoleId: 'gen_staff',
                supervisorRoleId: 'gen_sup',
                description: null,
                emoji: null,
            },
            'Billing Support': {
                channelId: 'c2',
                inboxId: 'i2',
                anonymous: false,
                staffRoleId: 'bill_staff',
                supervisorRoleId: null,
                description: null,
                emoji: null,
            },
        },
    },
};

describe('memberHasCategoryAccess', () => {
    test('guild owner always passes', () => {
        const m = fakeMember({ id: 'owner', ownerId: 'owner' });
        expect(memberHasCategoryAccess(m, config, 'General Support')).toBe(true);
    });

    test('global supervisor passes for any category', () => {
        const m = fakeMember({ roles: ['global_sup'] });
        expect(memberHasCategoryAccess(m, config, 'General Support')).toBe(true);
        expect(memberHasCategoryAccess(m, config, 'Billing Support')).toBe(true);
    });

    test('category staff role passes only for that category', () => {
        const m = fakeMember({ roles: ['gen_staff'] });
        expect(memberHasCategoryAccess(m, config, 'General Support')).toBe(true);
        expect(memberHasCategoryAccess(m, config, 'Billing Support')).toBe(false);
    });

    test('category supervisor role passes for that category', () => {
        const m = fakeMember({ roles: ['gen_sup'] });
        expect(memberHasCategoryAccess(m, config, 'General Support')).toBe(true);
    });

    test('member with no relevant role is denied', () => {
        const m = fakeMember({ roles: ['random'] });
        expect(memberHasCategoryAccess(m, config, 'General Support')).toBe(false);
    });

    test('requireSupervisor rejects category staff', () => {
        const m = fakeMember({ roles: ['gen_staff'] });
        expect(memberHasCategoryAccess(m, config, 'General Support', { requireSupervisor: true })).toBe(false);
    });

    test('requireSupervisor accepts category supervisor', () => {
        const m = fakeMember({ roles: ['gen_sup'] });
        expect(memberHasCategoryAccess(m, config, 'General Support', { requireSupervisor: true })).toBe(true);
    });

    test('requireSupervisor accepts global supervisor', () => {
        const m = fakeMember({ roles: ['global_sup'] });
        expect(memberHasCategoryAccess(m, config, 'Billing Support', { requireSupervisor: true })).toBe(true);
    });

    test('unknown category denies non-owner non-global-supervisor', () => {
        const m = fakeMember({ roles: ['gen_staff'] });
        expect(memberHasCategoryAccess(m, config, 'Nonexistent')).toBe(false);
    });
});

describe('orderCategoryNames', () => {
    const names = ['Priority Assistance', 'General Support', 'Technical Support'];

    test('sorts names by their index in categoryOrder', () => {
        const order = ['General Support', 'Technical Support', 'Priority Assistance'];
        expect(orderCategoryNames(names, order)).toEqual([
            'General Support', 'Technical Support', 'Priority Assistance',
        ]);
    });

    test('names absent from categoryOrder keep their relative order at the end', () => {
        const order = ['Technical Support'];
        expect(orderCategoryNames(names, order)).toEqual([
            'Technical Support', 'Priority Assistance', 'General Support',
        ]);
    });

    test('returns names unchanged when categoryOrder is missing or empty', () => {
        expect(orderCategoryNames(names, undefined)).toEqual(names);
        expect(orderCategoryNames(names, [])).toEqual(names);
        expect(orderCategoryNames(names, null)).toEqual(names);
        expect(orderCategoryNames(names, 'nope')).toEqual(names);
    });

    test('does not mutate the input array', () => {
        const input = [...names];
        orderCategoryNames(input, ['General Support']);
        expect(input).toEqual(names);
    });

    test('ignores categoryOrder entries that do not match a category', () => {
        const order = ['Ghost Category', 'General Support'];
        expect(orderCategoryNames(names, order)).toEqual([
            'General Support', 'Priority Assistance', 'Technical Support',
        ]);
    });

    test('handles a non-array names argument', () => {
        expect(orderCategoryNames(undefined, ['x'])).toEqual([]);
    });
});
