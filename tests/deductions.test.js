// Run with:  node --test          (from the repo root; needs Node 18+)
//
// No dependencies, no build step. The tests load the real script.js into a VM
// with a minimal DOM shim, so they exercise the shipping code path rather than
// a reimplementation of it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

// --- harness ---------------------------------------------------------------

function makeElement(id) {
    return {
        id, value: '', textContent: '', innerHTML: '', className: '', title: '',
        style: {}, children: [], listeners: {}, dataset: {}, attributes: {},
        appendChild(child) { this.children.push(child); registerFrom(child); },
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name]; },
        querySelector() { return makeElement('stub'); },
        querySelectorAll() { return []; },
        getContext() { return {}; },
        classList: { add() {}, remove() {}, contains() { return false; } }
    };
}

function boot() {
    const elements = {};
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const match of html.match(/id="([^"]+)"/g) || []) {
        const id = match.slice(4, -1);
        elements[id] = makeElement(id);
    }

    // Elements that script.js creates at runtime (profile inputs) only exist
    // once appended, so pick their ids out of the injected markup.
    function registerFrom(el) {
        for (const match of (el.innerHTML || '').match(/id="([^"]+)"/g) || []) {
            const id = match.slice(4, -1);
            elements[id] ||= makeElement(id);
        }
        el.children.forEach(registerFrom);
    }
    globalThis.registerFrom = registerFrom;

    const charts = [];
    let onReady = null;

    const sandbox = {
        console, setTimeout, clearTimeout, Date, Math, JSON, parseFloat, parseInt, isFinite,
        document: {
            getElementById: (id) => elements[id] || null,
            createElement: () => makeElement(''),
            querySelector: () => makeElement('stub'),
            addEventListener(type, fn) { if (type === 'DOMContentLoaded') onReady = fn; }
        },
        Chart: class { constructor(ctx, config) { charts.push(config); } destroy() {} },
        fetch: async (file) => ({
            json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
        })
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.registerFrom = registerFrom;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8'), sandbox);

    onReady();
    const calc = vm.runInContext('globalThis.__calc = new TaxCalculator(); __calc', sandbox);
    return { calc, charts, elements };
}

// Wait for the async init() chain (fetches resolve on the microtask queue).
async function ready() {
    const h = boot();
    for (let i = 0; i < 50 && !h.calc.deductionsData.length; i++) {
        await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 50));
    return h;
}

const deductions = read('deductions.json');
const profiles = read('profiles.json');
const byYear = Object.fromEntries(deductions.map((d) => [d.year, d]));

// --- the statute, transcribed independently of how the JSON was generated ---
// [year, category, percentage, cap]  cap === null means "the deduction did not
// exist that year"; Infinity means "existed, with no ceiling".
const STATUTE = [
    // art. 82.o - saude: 30% uncapped until 2011, then 10% capped at 2 x IAS
    [2005, 'health', 0.30, Infinity],
    [2008, 'health', 0.30, Infinity],
    [2011, 'health', 0.30, Infinity],
    [2012, 'health', 0.10, 838.44],
    [2014, 'health', 0.10, 838.44],
    [2015, 'health', 0.15, 1000],
    [2025, 'health', 0.15, 1000],

    // art. 83.o - educacao: 30%, cap 160% of RMMG (frozen at 475 EUR from 2011)
    [2005, 'education', 0.30, 599.52],
    [2006, 'education', 0.30, 617.44],
    [2007, 'education', 0.30, 644.80],
    [2008, 'education', 0.30, 681.60],
    [2009, 'education', 0.30, 720.00],
    [2010, 'education', 0.30, 760.00],
    [2014, 'education', 0.30, 760.00],
    [2015, 'education', 0.30, 800],

    // art. 84.o - lares: 25%; fixed amount to 2006, then 85% of RMMG
    [2005, 'nursingHome', 0.25, 316],
    [2006, 'nursingHome', 0.25, 323],
    [2007, 'nursingHome', 0.25, 342.55],
    [2008, 'nursingHome', 0.25, 362.10],
    [2009, 'nursingHome', 0.25, 382.50],
    [2010, 'nursingHome', 0.25, 403.75],
    [2025, 'nursingHome', 0.25, 403.75],

    // art. 85.o / 78.o-E - imoveis
    [2005, 'rent', 0.30, 549], [2005, 'mortgageInterest', 0.30, 549],
    [2006, 'rent', 0.30, 562], [2007, 'rent', 0.30, 574],
    [2008, 'rent', 0.30, 586], [2009, 'rent', 0.30, 586],
    [2010, 'rent', 0.30, 591], [2011, 'rent', 0.30, 591],
    [2012, 'rent', 0.15, 591], [2012, 'mortgageInterest', 0.15, 591],
    [2013, 'rent', 0.15, 502], [2013, 'mortgageInterest', 0.15, 296],
    [2024, 'rent', 0.15, 600],
    [2025, 'rent', 0.15, 700], [2025, 'mortgageInterest', 0.15, 296],

    // EBF art. 21.o - PPR: revoked for 2005, then 20% capped at 400 EUR/taxpayer
    [2005, 'retirementSavings', 0.20, null],
    [2006, 'retirementSavings', 0.20, 400],
    [2025, 'retirementSavings', 0.20, 400],

    // art. 78.o-F - IVA em fatura. One shared 250 EUR ceiling per household.
    // n.o 1 sectors deduct 15%; n.o 3 (transport passes) and n.o 7 (press
    // subscriptions) deduct 100%; n.o 6 (veterinary medicines) deducts 35%.
    [2013, 'vatRestaurants', 0.15, 250],
    [2025, 'vatRestaurants', 0.15, 250],
    [2013, 'vatMechanic', 0.15, 250],
    [2013, 'vatHairdressers', 0.15, 250],
    [2015, 'vatVet', 0.35, null],
    [2016, 'vatVet', 0.35, 250],
    [2015, 'vatPublicTransport', 1.0, null],
    [2016, 'vatPublicTransport', 1.0, 250],
    // Gyms: 15% under n.o 1 f) from 2021; Lei 82/2023 revoked that alinea and in
    // the same law added n.o 8 with the same CAE at 30%, so 2024 is a doubling,
    // not a removal.
    [2020, 'vatFitness', 0.15, null],
    [2021, 'vatFitness', 0.15, 250],
    [2023, 'vatFitness', 0.15, 250],
    [2024, 'vatFitness', 0.30, 250],
    [2025, 'vatFitness', 0.30, 250],

    // art. 78.o-H - trabalho domestico, added by Lei 82/2023, from 2024
    [2023, 'domesticWork', 0.05, null],
    [2024, 'domesticWork', 0.05, 200],
    [2025, 'domesticWork', 0.05, 200],
    [2022, 'vatPress', 1.0, null],
    [2023, 'vatPress', 1.0, 250],

    // art. 78.o-B - despesas gerais familiares: only from 2015, 250 EUR/taxpayer
    [2005, 'familyExpenses', 0.35, null],
    [2012, 'familyExpenses', 0.35, null],
    [2014, 'familyExpenses', 0.35, null],
    [2015, 'familyExpenses', 0.35, 250],
    [2025, 'familyExpenses', 0.35, 250]
];

// --- tests -----------------------------------------------------------------

test('deductions.json runs from 2005 to the latest year with no gaps', () => {
    const years = deductions.map((d) => d.year).sort((a, b) => a - b);
    assert.equal(years[0], 2005);
    // The end moves as new years are added, so assert contiguity, not a literal.
    for (let y = years[0]; y <= years.at(-1); y++) {
        assert.ok(years.includes(y), `missing year ${y}`);
    }
    assert.ok(years.at(-1) >= 2025, `series ends at ${years.at(-1)}`);
});

test('deductions.json is internally well-formed', () => {
    for (const entry of deductions) {
        for (const [key, rule] of Object.entries(entry.deductions)) {
            const where = `${entry.label}/${key}`;
            assert.ok(rule.percentage > 0 && rule.percentage <= 1, `${where}: bad percentage`);
            assert.ok(rule.limit === null || rule.limit > 0, `${where}: bad limit`);
            if (rule.unlimited) {
                assert.equal(rule.limit, null, `${where}: unlimited must pair with limit null`);
            }
            assert.ok(rule.name && rule.description, `${where}: missing name/description`);
        }
        assert.ok(entry.source.url, `${entry.label}: missing source url`);
    }
});

test('rules match the statute', async () => {
    const { calc } = await ready();
    for (const [year, category, percentage, cap] of STATUTE) {
        const rule = calc.deductionRule(byYear[year], category);
        const where = `${year}/${category}`;
        if (cap === null) {
            assert.equal(rule, null, `${where}: expected no deduction, got ${JSON.stringify(rule)}`);
            continue;
        }
        assert.ok(rule, `${where}: expected a deduction, got none`);
        assert.equal(rule.percentage, percentage, `${where}: percentage`);
        assert.equal(rule.cap, cap, `${where}: cap`);
    }
});

test('despesas gerais familiares exist only from 2015', () => {
    for (const entry of deductions) {
        const rule = entry.deductions.familyExpenses;
        assert.ok(rule, `${entry.label}: key should be present for documentation`);
        if (entry.year < 2015) {
            assert.equal(rule.limit, null, `${entry.label}: should not exist before 2015`);
        } else {
            assert.equal(rule.limit, 250, `${entry.label}: 250 EUR per sujeito passivo`);
        }
    }
});

test('deduction is rate x spend, capped', async () => {
    const { calc } = await ready();
    // baseYear === the year under test, so inflation is the identity here and
    // the arithmetic is exactly what the statute says.
    const at = (y, cat, spend, taxpayers = 1) =>
        calc.deductionFor(byYear[y], cat, spend, taxpayers);

    assert.equal(at(2008, 'health', 1000), 300);            // 30%, no ceiling
    assert.equal(at(2008, 'health', 100000), 30000);        // still no ceiling
    assert.equal(at(2012, 'health', 1000), 100);            // 10%, under cap
    assert.equal(at(2012, 'health', 100000), 838.44);       // 10%, capped
    assert.equal(at(2025, 'health', 1000), 150);            // 15%, under cap
    assert.equal(at(2025, 'health', 100000), 1000);         // 15%, capped
    assert.equal(at(2013, 'rent', 10000), 502);             // capped
    assert.equal(at(2025, 'rent', 1000), 150);              // under cap
    assert.equal(at(2006, 'retirementSavings', 1000), 200); // 20%, under cap
    assert.equal(at(2006, 'retirementSavings', 5000), 400); // capped
});

test('per-taxpayer caps scale with the number of taxpayers', async () => {
    const { calc } = await ready();
    const at = (y, cat, spend, tp) => calc.deductionFor(byYear[y], cat, spend, tp);

    // art. 78.o-B: 250 EUR "para cada sujeito passivo"
    assert.equal(at(2025, 'familyExpenses', 100000, 1), 250);
    assert.equal(at(2025, 'familyExpenses', 100000, 2), 500);
    // EBF art. 21.o: 400 EUR "por sujeito passivo"
    assert.equal(at(2025, 'retirementSavings', 100000, 1), 400);
    assert.equal(at(2025, 'retirementSavings', 100000, 2), 800);
    // Household caps must NOT scale.
    assert.equal(at(2025, 'health', 100000, 2), 1000);
    assert.equal(at(2025, 'education', 100000, 2), 800);
});

test('categories that did not exist yield zero, not a stray value', async () => {
    const { calc } = await ready();
    for (const y of [2005, 2010, 2014]) {
        assert.equal(calc.deductionFor(byYear[y], 'familyExpenses', 99999, 2), 0, `${y}`);
    }
    assert.equal(calc.deductionFor(byYear[2005], 'retirementSavings', 99999, 1), 0);
});

test('juros and rendas are not cumulative while they share a cap', async () => {
    const { calc } = await ready();
    const spend = { mortgageInterest: 5000, rent: 5000 };

    // 2010: one shared 591 EUR ceiling, art. 85.o n.o 3 -> count the larger only.
    assert.equal(calc.housingDeduction(byYear[2010], spend, 1), 591);
    // 2012: still a shared ceiling.
    assert.equal(calc.housingDeduction(byYear[2012], spend, 1), 591);
    // 2013 onwards: separate ceilings (296 juros, 502 rendas) -> they add.
    assert.equal(calc.housingDeduction(byYear[2013], spend, 1), 296 + 502);
    assert.equal(calc.housingDeduction(byYear[2025], spend, 1), 296 + 700);
});

test('inflation series means "year Y vs Y-1"', async () => {
    const { calc } = await ready();
    const inflation = read('inflation_pt.json');

    // Forward one year applies the TARGET year's rate.
    assert.equal(
        calc.adjustForInflation(100, 2023, 2024),
        100 * (1 + inflation['2024'] / 100)
    );
    // Backward one year undoes the SOURCE year's rate.
    assert.equal(
        calc.adjustForInflation(100, 2023, 2022),
        100 / (1 + inflation['2023'] / 100)
    );
    // Two years forward compounds both target years, not the source year.
    assert.ok(Math.abs(
        calc.adjustForInflation(100, 2022, 2024) -
        100 * (1 + inflation['2023'] / 100) * (1 + inflation['2024'] / 100)
    ) < 1e-9);
});

test('inflation data covers every year the app converts between', () => {
    const inflation = read('inflation_pt.json');
    const latest = Math.max(...deductions.map((d) => d.year));
    // Converting a value into year N euros needs a rate for every year up to N.
    // A missing year is silently treated as 0% and understates the result.
    for (let y = 2006; y <= latest; y++) {
        assert.ok(
            Object.prototype.hasOwnProperty.call(inflation, String(y)),
            `inflation_pt.json is missing ${y}; values in ${y} euros are understated`
        );
    }
});

test('inflation adjustment round-trips', async () => {
    const { calc } = await ready();
    for (const year of [2005, 2012, 2020, 2024]) {
        const there = calc.adjustForInflation(1000, 2023, year);
        const back = calc.adjustForInflation(there, year, 2023);
        assert.ok(Math.abs(back - 1000) < 1e-9, `${year}: ${back}`);
    }
});

test('every profile simulates cleanly across every year', async () => {
    const { calc } = await ready();
    const baseYear = profiles.meta.baseYear;

    for (const profile of profiles.profiles) {
        const taxpayers = profile.household.taxpayers;
        const spending = Object.fromEntries(
            profiles.categories.map((c) => [c, profile.spending[c].value])
        );

        for (const entry of deductions) {
            let total = 0;
            for (const category of profiles.categories) {
                if (category === 'mortgageInterest' || category === 'rent') continue;
                if (category.startsWith('vat')) continue; // summed as one capped group
                const got = calc.deductionFor(entry, category, spending[category], taxpayers);
                const where = `${profile.id}/${entry.label}/${category}`;

                assert.ok(Number.isFinite(got), `${where}: not finite (${got})`);
                assert.ok(got >= 0, `${where}: negative (${got})`);

                const rule = calc.deductionRule(entry, category);
                if (rule && Number.isFinite(rule.cap)) {
                    const cap = ['familyExpenses', 'retirementSavings'].includes(category)
                        ? rule.cap * taxpayers
                        : rule.cap;
                    assert.ok(got <= cap + 1e-9, `${where}: ${got} exceeds cap ${cap}`);
                }
                total += got;
            }
            const housing = calc.housingDeduction(entry, spending, taxpayers);
            assert.ok(Number.isFinite(housing) && housing >= 0, `${profile.id}/${entry.label}: housing`);
            total += housing;

            const vat = calc.vatDeduction(entry, spending);
            assert.ok(Number.isFinite(vat) && vat >= 0, `${profile.id}/${entry.label}: vat`);
            total += vat;
            assert.ok(Number.isFinite(total) && total >= 0, `${profile.id}/${entry.label}: total`);
        }
    }
});

test('a constant nominal spend gives a constant nominal deduction', async () => {
    const { calc } = await ready();
    const window = deductions
        .filter((d) => d.year >= 2005 && d.year <= 2011)
        .sort((a, b) => a.year - b.year);

    // Education was 30% throughout 2005-2011 and 1284 EUR of spending never
    // reaches the ceiling, so the nominal deduction is the same every year...
    const nominal = window.map((yearData) =>
        calc.deductionFor(yearData, 'education', 1284, 2)
    );
    for (const value of nominal) {
        assert.ok(Math.abs(value - nominal[0]) < 1e-9, `expected a flat nominal series: ${nominal}`);
    }

    // ...and its value in reference-year euros therefore FALLS every year, purely
    // because the same euros buy less later. That is the known cost of holding
    // the spend nominal rather than real: it shows erosion even where the rule
    // never changed.
    const real = window.map((yearData, i) =>
        calc.adjustForInflation(nominal[i], yearData.year, calc.referenceYear())
    );
    for (let i = 1; i < real.length; i++) {
        assert.ok(real[i] < real[i - 1], `real value should fall: ${real}`);
    }

    // A frozen cap erodes on top of that. 6000 EUR of PPR is above the 800 EUR
    // couple ceiling in every year, so the deduction is pinned to the cap and
    // only inflation moves it.
    const capped = window.map((yearData) =>
        calc.deductionFor(yearData, 'retirementSavings', 6000, 2)
    );
    for (const value of capped.slice(1)) {
        assert.equal(value, 800, 'should sit exactly on the 400 EUR/taxpayer cap');
    }
});

test('no category deflates its spend, not just PPR', async () => {
    const { calc } = await ready();
    const SPEND = 3000;
    const byAscending = deductions.slice().sort((a, b) => a.year - b.year);

    // Wherever two consecutive years carry an identical rule, the same spend must
    // produce an identical NOMINAL deduction. Any surviving inflation adjustment
    // on the spend side would make them differ.
    let compared = 0;
    for (let i = 1; i < byAscending.length; i++) {
        const prev = byAscending[i - 1];
        const curr = byAscending[i];
        for (const category of Object.keys(curr.deductions)) {
            const a = prev.deductions[category];
            const b = curr.deductions[category];
            if (!a || !b) continue;
            if (a.limit !== b.limit || a.percentage !== b.percentage) continue;
            if (a.limit === null) continue;

            const before = calc.deductionFor(prev, category, SPEND, 2);
            const after = calc.deductionFor(curr, category, SPEND, 2);
            assert.ok(
                Math.abs(before - after) < 1e-9,
                `${category}: ${prev.label} gave ${before} but ${curr.label} gave ${after} ` +
                'for the same spend under an identical rule'
            );
            compared++;
        }
    }
    assert.ok(compared > 100, `expected many comparisons, made ${compared}`);

    // Same for the grouped paths.
    const housing = { mortgageInterest: SPEND, rent: 0 };
    assert.equal(
        calc.housingDeduction(byYear[2016], housing, 2),
        calc.housingDeduction(byYear[2017], housing, 2)
    );
    const vat = Object.fromEntries(
        profiles.categories.filter((c) => c.startsWith('vat')).map((c) => [c, 100])
    );
    assert.equal(calc.vatDeduction(byYear[2018], vat), calc.vatDeduction(byYear[2019], vat));

    // And the art. 25.o allowance. The 2016 and 2017 brackets differ in shape but
    // give the same relief at this income, so compare with a tolerance rather
    // than exactly: the two sums land ~1e-12 apart in floating point.
    assert.ok(
        Math.abs(
            calc.specificDeductionValue(byYear[2016], 30000) -
            calc.specificDeductionValue(byYear[2017], 30000)
        ) < 1e-6
    );
});

test('invoice-VAT deductions share one global ceiling', async () => {
    const { calc } = await ready();
    const BASE = 2023;
    const sectors = profiles.categories.filter((c) => c.startsWith('vat'));

    // Enough spending in every sector to blow well past 250 EUR individually.
    const huge = Object.fromEntries(sectors.map((c) => [c, 200000]));
    for (const year of [2013, 2016, 2021, 2023, 2025]) {
        const got = calc.vatDeduction(byYear[year], huge);
        assert.equal(got, 250, `${year}: should be capped once at 250, not per sector`);
    }

    // The deduction applies to the VAT inside the price, not to the price.
    // 2025 mechanic: 23% VAT, 15% of it deductible.
    const mechanicOnly = Object.fromEntries(sectors.map((c) => [c, 0]));
    mechanicOnly.vatMechanic = 1230;
    const expected = 0.15 * (1230 * 0.23 / 1.23); // 1230 gross -> 230 VAT -> 34.50
    const got = calc.vatDeduction(byYear[2025], mechanicOnly);
    assert.ok(Math.abs(got - expected) < 0.01, `expected ~${expected}, got ${got}`);

    // Nothing before 2013: the regime did not exist.
    for (const year of [2005, 2010, 2012]) {
        assert.equal(calc.vatDeduction(byYear[year], huge), 0, `${year}`);
    }
});

test('VAT sectors appear and disappear on the right years', async () => {
    const { calc } = await ready();
    const present = (year, category) => calc.deductionRule(byYear[year], category) !== null;

    // Vet and public transport were added by Lei 7-A/2016, so not in 2015.
    assert.equal(present(2015, 'vatVet'), false);
    assert.equal(present(2016, 'vatVet'), true);
    assert.equal(present(2015, 'vatPublicTransport'), false);
    assert.equal(present(2016, 'vatPublicTransport'), true);

    // Gyms: added by Lei 75-B/2020. Lei 82/2023 moved them from n.o 1 f) to
    // n.o 8 and doubled the rate, so they continue past 2023.
    assert.equal(present(2020, 'vatFitness'), false);
    assert.equal(present(2021, 'vatFitness'), true);
    assert.equal(present(2023, 'vatFitness'), true);
    assert.equal(present(2024, 'vatFitness'), true);
    assert.equal(calc.deductionRule(byYear[2023], 'vatFitness').percentage, 0.15);
    assert.equal(calc.deductionRule(byYear[2024], 'vatFitness').percentage, 0.30);

    // Press subscriptions: added by Lei 24-D/2022.
    assert.equal(present(2022, 'vatPress'), false);
    assert.equal(present(2023, 'vatPress'), true);

    // The three founding sectors run from 2013.
    for (const category of ['vatRestaurants', 'vatMechanic', 'vatHairdressers']) {
        assert.equal(present(2012, category), false, `${category} in 2012`);
        assert.equal(present(2013, category), true, `${category} in 2013`);
    }

    // There is no general-expenses VAT deduction in law.
    for (const entry of deductions) {
        assert.ok(!entry.deductions.vatGeneral, `${entry.label}: vatGeneral should not exist`);
    }
});

test('chart legends use the human name, never the raw key', async () => {
    const { calc, charts } = await ready();

    const keys = new Set();
    for (const entry of deductions) {
        for (const key of Object.keys(entry.deductions)) keys.add(key);
    }

    for (const key of keys) {
        assert.ok(calc.categoryLabel(key) !== key, `${key}: label fell back to the raw key`);
    }
    for (const config of charts) {
        for (const dataset of config.data.datasets) {
            assert.ok(!keys.has(dataset.label),
                `chart series labelled with the raw key "${dataset.label}"`);
        }
    }

    // The real hazard is a category the NEWEST year no longer carries, because a
    // lookup against deductionsData[0] alone then falls through to the property
    // name. Gyms were that case until Lei 82/2023 turned out to have re-added
    // them, so construct the situation rather than rely on the data having it.
    const newest = calc.deductionsData[0];
    const victim = 'nursingHome';
    const saved = newest.deductions[victim];
    assert.ok(saved, `precondition: ${victim} should exist in ${newest.label}`);
    delete newest.deductions[victim];
    try {
        assert.equal(calc.categoryLabel(victim), saved.name,
            `${victim}: label must resolve from an earlier year`);

        const before = charts.length;
        calc.calculateDeductionsChart();
        const rebuilt = charts[charts.length - 1];
        assert.ok(charts.length > before, 'chart was not rebuilt');
        for (const dataset of rebuilt.data.datasets) {
            assert.ok(dataset.label !== victim,
                `legend fell back to the raw key for ${victim}`);
        }
    } finally {
        newest.deductions[victim] = saved;
    }
});

test('profile chart renders one series per category plus a total', async () => {
    const { calc, charts } = await ready();
    const chart = charts.filter((c) => /cabaz/.test(c.options?.plugins?.title?.text || '')).pop();
    assert.ok(chart, 'profile chart was never built');

    assert.equal(chart.data.labels.length, deductions.length);

    const total = chart.data.datasets.find((d) => d.label === 'Total');
    assert.ok(total, 'missing Total series');

    const parts = chart.data.datasets.filter((d) => d.label !== 'Total');
    for (let i = 0; i < chart.data.labels.length; i++) {
        const summed = parts.reduce((acc, d) => acc + d.data[i], 0);
        assert.ok(
            Math.abs(summed - total.data[i]) < 1e-6,
            `${chart.data.labels[i]}: parts ${summed} != total ${total.data[i]}`
        );
        assert.ok(Number.isFinite(total.data[i]), `${chart.data.labels[i]}: total not finite`);
    }
});

test('profile spending inputs round-trip through the display currency', async () => {
    const { calc, elements } = await ready();
    const currentYear = new Date().getFullYear();
    const baseYear = profiles.meta.baseYear;

    for (const category of profiles.categories) {
        const shown = parseFloat(elements[`spend_${category}`].value);
        assert.ok(Number.isFinite(shown), `${category}: input not populated`);
        assert.ok(shown >= 0, `${category}: negative input`);

        const first = profiles.profiles[0].spending[category].value;
        const expected = calc.adjustForInflation(first, baseYear, currentYear);
        assert.ok(
            Math.abs(shown - expected) <= 0.5,
            `${category}: shown ${shown} vs expected ${expected}`
        );
    }
});

test('each spending input explains where its figure came from', async () => {
    const { calc, elements } = await ready();
    const legend = profiles.meta.basisLegend;
    const first = profiles.profiles[0];

    for (const category of profiles.categories) {
        const badge = elements[`basis_${category}`];
        const entry = first.spending[category];
        assert.ok(badge, `${category}: missing basis badge`);

        // The badge shows the basis; hovering it must explain both what that
        // basis means and how this particular figure was arrived at.
        assert.equal(badge.textContent, entry.basis, `${category}: badge text`);
        const note = badge.dataset.note;
        assert.ok(note, `${category}: no hover note`);
        assert.ok(note.includes(legend[entry.basis]), `${category}: missing basis legend`);
        assert.ok(note.includes(entry.note), `${category}: missing value note`);
        assert.ok(badge.getAttribute('aria-label'), `${category}: not exposed to screen readers`);
    }
});

test('profiles.json documents the provenance of every value', () => {
    const allowed = new Set(Object.keys(profiles.meta.basisLegend));
    for (const profile of profiles.profiles) {
        assert.ok(profile.household.taxpayers >= 1, `${profile.id}: taxpayers`);
        for (const category of profiles.categories) {
            const entry = profile.spending[category];
            assert.ok(entry, `${profile.id}/${category}: missing`);
            assert.ok(entry.value >= 0, `${profile.id}/${category}: negative`);
            assert.ok(allowed.has(entry.basis), `${profile.id}/${category}: basis "${entry.basis}"`);
            assert.ok(entry.note, `${profile.id}/${category}: missing note`);
        }
    }
});
