// Language handling: Portuguese (the page's home language) and English.
//
// The Portuguese text of the static page lives in index.html, so the page reads
// correctly with no JavaScript at all. Elements carrying data-i18n="key" get
// their English from STRINGS.en[key]; their Portuguese is captured from the DOM
// the first time they are translated, so switching back needs no copy of it
// here. Text built by script.js has both languages below and is read with t().
//
// Translations of the data files live next to the Portuguese they translate:
// profiles.json carries an `en` object beside each name, description and note
// (read with localized()), and the deduction names are under `category.*` here.

const I18n = (() => {
    const SUPPORTED = ['pt', 'en'];
    const LOCALES = { pt: 'pt-PT', en: 'en-GB' };
    const STORAGE_KEY = 'lang';

    // Time zones of the countries where Portuguese is an official language,
    // used as a stand-in for location: it is known instantly and offline, while
    // a real location would need a geolocation prompt or an IP lookup.
    const PORTUGUESE_TIME_ZONES = new Set([
        // Portugal
        'Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores', 'Portugal',
        // Brazil
        'America/Sao_Paulo', 'America/Noronha', 'America/Belem', 'America/Fortaleza',
        'America/Recife', 'America/Araguaina', 'America/Maceio', 'America/Bahia',
        'America/Santarem', 'America/Manaus', 'America/Campo_Grande', 'America/Cuiaba',
        'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco',
        'America/Eirunepe', 'America/Porto_Acre',
        'Brazil/East', 'Brazil/West', 'Brazil/Acre', 'Brazil/DeNoronha',
        // Angola, Mozambique, Cape Verde, Guinea-Bissau, São Tomé and Príncipe,
        // Timor-Leste, Macau
        'Africa/Luanda', 'Africa/Maputo', 'Atlantic/Cape_Verde', 'Africa/Bissau',
        'Africa/Sao_Tome', 'Asia/Dili', 'Asia/Macau', 'Asia/Macao'
    ]);

    const STRINGS = {
        pt: {
            'chart.year': 'Ano',
            'chart.total': 'Total',
            'money.suffix': '{amount} €',

            'paramRef.income': '{prefix} <strong>{income}</strong>, ano base <strong>{year}</strong>',
            'paramRef.baseYearOnly': '{prefix} <strong>{year}</strong> (ano base)',
            'paramRef.prefix.income': 'Rendimento anual de',
            'paramRef.prefix.baseYear': 'Ano base',
            'paramRef.prefix.axisEuros': 'Rendimentos do eixo em euros de',
            'paramRef.prefix.specificDeduction': 'Dedução específica (art. 25.º) calculada para',

            'table.noInflationData': 'Dados de inflação não disponíveis para este ano',
            'table.estimatedInflation': 'Inclui inflação estimada (ainda não definitiva) para {years}',

            'main.taxRate': 'Taxa de IRS (%)',
            'main.purchasingPower': 'Poder de Compra (%)',
            'main.title': 'Taxa de IRS vs Poder de Compra ao Longo do Tempo',

            'comparison.xAxis': 'Rendimento coletável',
            'comparison.title': 'Taxa de IRS ajustada à inflação',

            'deductions.vatBar': 'IVA - Exigência de Fatura',
            'deductions.yAxis': 'Limite de Dedução (€)',
            'deductions.title': 'Evolução dos Limites de Deduções IRS (Valores Atuais)',
            'deductions.notAvailable': 'Não disponível',
            'deductions.sharedCap': '{count} setores, limite partilhado:',

            'profile.yAxis': 'Dedução obtida (€ de {year})',
            'profile.title': 'Dedução realmente obtida com o mesmo cabaz de despesa (a preços de {year})',
            'profile.atCap': '  ⛔ no tecto legal',
            'profile.atCapList': 'No tecto: ',
            'profile.personal': 'Dedução pessoal',
            'profile.dependents': 'Dependentes ({count})',
            'profile.housing': 'Habitação',
            'profile.vat': 'IVA em faturas',
            'profile.specific': 'Dedução específica (em imposto)',
            'profile.summary':
                'Com este cabaz, a dedução seria de <strong>{latest}</strong> em {latestYear}. ' +
                'O melhor ano foi <strong>{bestYear}</strong>, com <strong>{best}</strong> ' +
                '— uma diferença de {delta} (tudo a preços de {year}).',

            'sources.source': 'Fonte',
            'sources.backup': 'Backup',
            'sources.brackets': 'Escalões de IRS',
            'sources.deductions': 'Deduções'
        },

        en: {
            'chart.year': 'Year',
            'chart.total': 'Total',
            'money.suffix': '€{amount}',

            'paramRef.income': '{prefix} <strong>{income}</strong>, base year <strong>{year}</strong>',
            'paramRef.baseYearOnly': '{prefix} <strong>{year}</strong> (base year)',
            'paramRef.prefix.income': 'Annual income of',
            'paramRef.prefix.baseYear': 'Base year',
            'paramRef.prefix.axisEuros': 'Axis incomes in euros of',
            'paramRef.prefix.specificDeduction': 'Specific deduction (art. 25) calculated for',

            'table.noInflationData': 'Inflation data not available for this year',
            'table.estimatedInflation': 'Includes estimated (not yet final) inflation for {years}',

            'main.taxRate': 'IRS rate (%)',
            'main.purchasingPower': 'Purchasing power (%)',
            'main.title': 'IRS rate vs purchasing power over time',

            'comparison.xAxis': 'Taxable income',
            'comparison.title': 'Inflation-adjusted IRS rate',

            'deductions.vatBar': 'VAT - Invoice requirement',
            'deductions.yAxis': 'Deduction cap (€)',
            'deductions.title': "IRS deduction caps over time (today's values)",
            'deductions.notAvailable': 'Not available',
            'deductions.sharedCap': '{count} sectors, shared cap:',

            'profile.yAxis': 'Deduction obtained ({year} €)',
            'profile.title': 'Deduction actually obtained from the same spending basket ({year} prices)',
            'profile.atCap': '  ⛔ at the legal cap',
            'profile.atCapList': 'At the cap: ',
            'profile.personal': 'Personal deduction',
            'profile.dependents': 'Dependants ({count})',
            'profile.housing': 'Housing',
            'profile.vat': 'VAT on invoices',
            'profile.specific': 'Specific deduction (as tax)',
            'profile.summary':
                'With this basket, the deduction would be <strong>{latest}</strong> in {latestYear}. ' +
                'The best year was <strong>{bestYear}</strong>, with <strong>{best}</strong> ' +
                '— a difference of {delta} (all at {year} prices).',

            'sources.source': 'Source',
            'sources.backup': 'Backup',
            'sources.brackets': 'IRS brackets',
            'sources.deductions': 'Deductions',

            // Words inside the parentheses of tabelas_irs.json labels ("2026 (Set)")
            'yearLabel.Proposta': 'Proposal',
            'yearLabel.Set': 'Sep',

            // Badges under each spending field (profiles.json `basis`)
            'basis.idef': 'IDEF',
            'basis.idef-derivado': 'IDEF-derived',
            'basis.estimativa': 'estimate',

            // Deduction names (deductions.json `name`, by key)
            'category.base': 'Specific deduction',
            'category.personal': 'Personal deduction',
            'category.dependents': 'Dependants',
            'category.familyExpenses': 'General family expenses',
            'category.domesticWork': 'Domestic work',
            'category.health': 'Health',
            'category.education': 'Education',
            'category.mortgageInterest': 'Housing - Mortgage interest',
            'category.rent': 'Housing - Rent',
            'category.nursingHome': 'Care homes',
            'category.retirementSavings': 'PPR/Pensions',
            'category.vatRestaurants': 'VAT - Restaurants',
            'category.vatMechanic': 'VAT - Car repairs',
            'category.vatHairdressers': 'VAT - Hairdressers',
            'category.vatVet': 'VAT - Vets',
            'category.vatPublicTransport': 'VAT - Monthly transport passes',
            'category.vatFitness': 'VAT - Gyms',
            'category.vatPress': 'VAT - Newspapers and magazines',
            'category.vatCulture': 'VAT - Culture',

            // Static page (index.html, data-i18n="html.*")
            'html.title': 'Portuguese Income Tax (IRS) Rates Compared (Inflation-Adjusted)',
            'html.heading': 'Portuguese Income Tax (IRS) Rates Compared',
            'html.tagline': 'Compare IRS rates across the years, adjusted for inflation',
            'html.paramsTitle': 'Your details',
            'html.income': 'Annual income',
            'html.baseYear': 'Base year',
            'html.paramsHint': 'Applies to the sections marked with <span class="param-ref-icon">⚙</span>',
            'html.resultsTitle': 'Tax rate comparison results',
            'html.th.year': 'Year',
            'html.th.baseIncome': 'Base income (€)',
            'html.th.equivalentIncome': 'Equivalent income (€)',
            'html.th.taxRate': 'IRS rate (%)',
            'html.th.taxAmount': 'IRS amount (€)',
            'html.th.taxAmountCurrent': "IRS amount, today's euros (€)",
            'html.th.netIncome': 'Net income (€)',
            'html.th.netIncomeCurrent': "Net income, today's euros (€)",
            'html.th.realVsBase': 'Real income vs base (%)',
            'html.compareYears': 'Years to compare:',
            'html.and': 'and',
            'html.deductionsTitle': 'IRS deductions compared',
            'html.deductionsNote': "Legal cap of each deduction, at today's prices.",
            'html.profileTitle': 'Deduction by spending profile',
            'html.profileNote':
                'Assumes the person spent <strong>the same amount in euros</strong> in every year, and converts ' +
                "only the resulting deduction into today's euros. It shows what that spending gave back in each " +
                'year would be worth today. Pick a profile and adjust the values to your case.',
            'html.profileLabel': 'Profile:',
            'html.profileInputsHint':
                "Annual spending in each category, in today's euros. The label under each field says where " +
                'the value comes from; hover over it to see.',
            'html.caveatsTitle': '<strong>Limitations</strong>',
            'html.caveatInflation':
                '<strong>Why spending is not adjusted for inflation.</strong> ' +
                'Not every deduction is used the same way. Some are, in practice, always maxed out: for general ' +
                'family expenses about €715 of invoices per taxpayer is enough to reach the €250; people saving ' +
                'for retirement tend to put into their PPR whatever gives the maximum deduction; and for most ' +
                'renters the rent exceeds the cap in every year. For these, the cap is what decides the value, ' +
                'and keeping spending fixed in euros amounts to assuming it was always maxed out. ' +
                'Others follow what is actually spent, such as health. There the right thing would be to update ' +
                'spending for inflation, and keeping the same euros makes the older years look more generous than ' +
                'they were, though less so than general inflation suggests, because health prices have risen by ' +
                'about 31% since 2005, against 58% for prices overall. ' +
                'One model has to serve every category. The first was chosen because it shows what this page sets ' +
                'out to show: caps frozen in euros losing value. So a fall in a deduction that never reaches its ' +
                'cap should be read with care, as part of it is just the effect of keeping the same euros.',
            'html.caveatSources':
                '<strong>Where the values come from, and other simplifications.</strong> The default values come ' +
                "from INE's " +
                '<a href="https://www.ine.pt/xportal/xmain?xpid=INE&amp;xpgid=ine_publicacoes&amp;PUBLICACOESpub_boui=439486878&amp;PUBLICACOESmodo=2&amp;xlang=pt" target="_blank" rel="noopener noreferrer">Household Budget Survey 2022/2023</a> ' +
                '(Inquérito às Despesas das Famílias, IDEF); the label next to each field says whether the figure ' +
                'is read directly from the survey, derived from it, or an estimate (hover over it to see its source). ' +
                'The <strong>specific deduction</strong> (art. 25) is taken off income rather than off the tax due, ' +
                'so it is shown converted into the extra tax that would be paid without it, the only way to add it ' +
                'to the others without mixing euros of income with euros of tax. It depends on the income entered ' +
                'at the top of the page, and it is the only exception to the same-euros rule: that income is ' +
                'adjusted for inflation from the base year, as in the table above. ' +
                'The value of the deduction depends on the bracket the income falls in, and without the adjustment ' +
                "today's income would land in the older years in a higher bracket than it really would. " +
                '<strong>VAT on invoices</strong> appears as a single bar because every sector (restaurants, car ' +
                'repair shops, hairdressers, vets, transport, gyms, newspapers and, since 2026, culture) shares a ' +
                'single cap of €250 per household. The deduction applies to the VAT contained in the spending, not ' +
                "to the spending itself, so each sector's VAT rate is used, an approximation for restaurants, which " +
                'mix rates of 6%, 13% and 23%. ' +
                '<strong>Mortgage interest</strong> ends in 2011: the deduction is still in the law ' +
                '(art. 78-E(1)(b), €296) but only for contracts signed up to 31/12/2011, which nobody has been able ' +
                'to take out since. ' +
                'The <strong>dependants</strong> deduction uses the number of children in the profile and only the ' +
                'base amount per child: the extras for children up to 3 or 6 years old are left out, because the ' +
                'profiles have no ages. In 2015 it appears lower because that year support for families went mostly ' +
                'through the family quotient, which works through the rate and is not modelled. ' +
                'Until 2014 there was also a <strong>personal deduction</strong> per taxpayer ' +
                '(art. 79(1)(a)), abolished by the 2015 reform; in 2005 and 2006 it was higher for unmarried ' +
                'taxpayers, and the model treats single-taxpayer profiles as unmarried. ' +
                'Not yet modelled: the overall limit on the sum of deductions (art. 78(7)), the deductions for ' +
                'ascendants (art. 78-A), alimony (art. 83-A) and disability (art. 87); and the deduction can never ' +
                'exceed the tax due.',
            'html.methodologyTitle': 'Methodology',
            'html.methodology':
                'This tool adjusts the income brackets for inflation using consumer price index data for Portugal. ' +
                "IRS rates are calculated from each year's progressive brackets, and purchasing power is calculated " +
                'relative to the selected base year.',
            'html.methodologyNote':
                '<strong>Note:</strong> Inflation adjustments are based on annual averages for the whole ' +
                'European Union, taken from ' +
                '<a href="https://www.macrotrends.net/global-metrics/countries/euu/european-union/inflation-rate-cpi" target="_blank" rel="noopener noreferrer">macrotrends.net</a>',
            'html.sourcesTitle': 'Sources'
        }
    };

    const listeners = [];
    const originals = new Map(); // element -> its Portuguese innerHTML
    let lang = 'pt';

    function browserLanguages() {
        if (typeof navigator === 'undefined' || !navigator) return [];
        const list = navigator.languages && navigator.languages.length
            ? navigator.languages
            : [navigator.language];
        return list.filter(Boolean).map(l => String(l).toLowerCase());
    }

    function timeZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch (e) {
            return '';
        }
    }

    function urlLang() {
        try {
            const value = new URLSearchParams(window.location.search).get('lang');
            return SUPPORTED.includes(value) ? value : null;
        } catch (e) {
            return null;
        }
    }

    function savedLang() {
        try {
            const value = window.localStorage.getItem(STORAGE_KEY);
            return SUPPORTED.includes(value) ? value : null;
        } catch (e) {
            return null;
        }
    }

    // An explicit choice (?lang= or the toggle) wins. Otherwise Portuguese, unless
    // the browser asks for no Portuguese at all AND the time zone is not in a
    // Portuguese-speaking country. Knowing neither, stay in Portuguese.
    function detect() {
        const chosen = urlLang() || savedLang();
        if (chosen) return chosen;

        const languages = browserLanguages();
        if (!languages.length) return 'pt';
        if (languages.some(l => l.split('-')[0] === 'pt')) return 'pt';
        if (PORTUGUESE_TIME_ZONES.has(timeZone())) return 'pt';
        return 'en';
    }

    function format(text, params) {
        if (!params) return text;
        return text.replace(/\{(\w+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match);
    }

    // `fallback` is returned when neither the current language nor Portuguese
    // has the key, for text whose Portuguese comes from the data files.
    function t(key, params, fallback) {
        let text = STRINGS[lang][key];
        if (text === undefined) text = STRINGS.pt[key];
        if (text === undefined) text = fallback !== undefined ? fallback : key;
        return format(text, params);
    }

    // obj[field], or obj.en[field] in English when the data provides it.
    function localized(obj, field) {
        if (!obj) return undefined;
        const translated = obj[lang] && obj[lang][field];
        return lang !== 'pt' && translated !== undefined && translated !== null ? translated : obj[field];
    }

    function locale() {
        return LOCALES[lang];
    }

    function number(value, options) {
        return Number(value).toLocaleString(locale(), options);
    }

    // "2026 (Set)" -> "2026 (Sep)"; years without a suffix are left as they are.
    function yearLabel(label) {
        if (label === undefined || label === null) return '';
        return String(label).replace(/\(([^)]+)\)/g, (match, word) =>
            '(' + t(`yearLabel.${word}`, null, word) + ')');
    }

    function applyStatic() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;

        document.querySelectorAll('[data-i18n]').forEach(el => {
            if (!originals.has(el)) originals.set(el, el.innerHTML);
            const portuguese = originals.get(el);
            el.innerHTML = lang === 'pt'
                ? portuguese
                : t(el.dataset.i18n, null, portuguese);
        });

        document.querySelectorAll('[data-set-lang]').forEach(link => {
            if (link.dataset.setLang === lang) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        });
        document.querySelectorAll('.lang-switch').forEach(nav => {
            nav.setAttribute('aria-label', lang === 'en' ? 'Language' : 'Idioma');
        });

        if (document.documentElement) document.documentElement.lang = lang;
    }

    function setLang(next, { remember = true } = {}) {
        if (!SUPPORTED.includes(next)) return;
        const changed = next !== lang;
        lang = next;

        if (remember) {
            try { window.localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* private mode */ }
            // Keep the address in step, so a reload or a shared link shows
            // the same language.
            try {
                const url = new URL(window.location.href);
                url.searchParams.set('lang', next);
                window.history.replaceState(null, '', url);
            } catch (e) { /* no URL API */ }
        }

        applyStatic();
        if (changed) listeners.forEach(fn => fn(lang));
    }

    function onChange(fn) {
        listeners.push(fn);
    }

    function bindSwitch() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        // Real links (?lang=xx), so they still work without JavaScript and can
        // be opened in a new tab; a plain click switches in place instead, so
        // nothing the user typed is lost.
        document.querySelectorAll('[data-set-lang]').forEach(link => {
            link.addEventListener('click', event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                setLang(link.dataset.setLang);
            });
        });
    }

    lang = detect();
    applyStatic();
    bindSwitch();

    return {
        get lang() { return lang; },
        STRINGS, PORTUGUESE_TIME_ZONES,
        detect, t, localized, locale, number, yearLabel, setLang, onChange, applyStatic
    };
})();
