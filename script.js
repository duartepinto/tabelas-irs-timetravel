class TaxCalculator {
    constructor() {
        this.taxData = [];
        this.deductionsData = [];
        this.inflationData = {};
        this.deductionsChart = null;
        this.chart = null;
        this.comparisonChart = null;
        this.debounceTimer = null;
        this.init();
    }

    async init() {
        try {
            await this.loadTaxData();
            await this.loadDeductionsData();
            await this.loadProfilesData();
            this.populateBaseYearDropdown();
            this.setupEventListeners();
            this.setupProfileControls();

            // Initial calculations
            this.calculate();
            this.calculateComparison();
            this.calculateDeductionsChart();
            this.calculateProfileChart();
            this.populateSources();
        } catch (error) {
            console.error('Failed to initialize:', error);
        }
    }

    async loadTaxData() {
        try {
            const [taxResponse, inflationResponse] = await Promise.all([
                fetch('tabelas_irs.json'),
                fetch('inflation_pt.json')
            ]);

            this.taxData = await taxResponse.json();
            this.inflationData = await inflationResponse.json();
        } catch (error) {
            console.error('Failed to load data:', error);
            throw error;
        }
    }

    async loadDeductionsData() {
        try {
            const response = await fetch('deductions.json');
            this.deductionsData = await response.json();
        } catch (error) {
            console.error('Failed to load deductions data:', error);
            throw error;
        }
    }

    async loadProfilesData() {
        try {
            const response = await fetch('profiles.json');
            this.profilesData = await response.json();
        } catch (error) {
            console.error('Failed to load profiles data:', error);
            this.profilesData = null;
        }
    }

    setupProfileControls() {
        if (!this.profilesData) return;

        const select = document.getElementById('profileSelect');
        const inputs = document.getElementById('profileInputs');
        if (!select || !inputs) return;

        this.profilesData.profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = `${profile.name} — ${profile.description}`;
            select.appendChild(option);
        });

        // IDEF figures are in 2023 euros; the inputs show them in today's money.
        const currentYear = this.referenceYear();
        const baseYear = this.profilesData.meta.baseYear;

        this.profilesData.categories.forEach(category => {
            const field = document.createElement('div');
            field.className = 'input-group profile-field';
            field.innerHTML = `
                <label for="spend_${category}">${this.categoryLabel(category)}</label>
                <input type="number" id="spend_${category}" data-category="${category}"
                       min="0" step="50" inputmode="numeric">
                <span class="profile-basis" id="basis_${category}" tabindex="0" role="note"></span>
            `;
            inputs.appendChild(field);
        });

        const applyProfile = (profileId) => {
            const profile = this.profilesData.profiles.find(p => p.id === profileId);
            if (!profile) return;

            this.currentTaxpayers = profile.household.taxpayers;
            this.profilesData.categories.forEach(category => {
                const entry = profile.spending[category];
                const input = document.getElementById(`spend_${category}`);
                const basis = document.getElementById(`basis_${category}`);
                const displayValue = this.adjustForInflation(entry.value, baseYear, currentYear);
                input.value = Math.round(displayValue);
                const legend = (this.profilesData.meta.basisLegend || {})[entry.basis] || '';
                basis.textContent = entry.basis;
                basis.className = `profile-basis basis-${entry.basis}`;
                // Rendered by CSS on hover/focus; `title` is left off so the
                // native tooltip does not double up with it.
                basis.dataset.note = legend ? `${legend}\n\n${entry.note}` : entry.note;
                basis.setAttribute('aria-label', `${entry.basis}. ${legend} ${entry.note}`);
            });
            this.readSpendingInputs(currentYear, baseYear);
            this.calculateProfileChart();
        };

        select.addEventListener('change', () => applyProfile(select.value));

        inputs.addEventListener('input', () => {
            clearTimeout(this.profileDebounce);
            this.profileDebounce = setTimeout(() => {
                this.readSpendingInputs(currentYear, baseYear);
                this.calculateProfileChart();
            }, 250);
        });

        applyProfile(this.profilesData.profiles[0].id);
    }

    // Read the inputs (today's euros) and store the basket in the survey's base currency.
    readSpendingInputs(currentYear, baseYear) {
        this.currentSpending = {};
        this.profilesData.categories.forEach(category => {
            const input = document.getElementById(`spend_${category}`);
            const shown = parseFloat(input && input.value) || 0;
            this.currentSpending[category] = this.adjustForInflation(shown, currentYear, baseYear);
        });
    }

    updateProfileChart(datasets, labels) {
        const canvas = document.getElementById('profileChart');
        if (!canvas) return;

        if (this.profileChart) {
            this.profileChart.destroy();
        }

        this.profileChart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        title: { display: true, text: 'Ano' },
                        reverse: true,
                        stacked: true
                    },
                    y: {
                        title: { display: true, text: `Dedução obtida (€ de ${this.referenceYear()})` },
                        beginAtZero: true,
                        stacked: true
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: `Dedução realmente obtida com o mesmo cabaz de despesa (a preços de ${this.referenceYear()})`
                    },
                    legend: { position: 'top', labels: { boxWidth: 12 } },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const amount = context.parsed.y.toLocaleString('pt-PT', {maximumFractionDigits: 0});
                                const capped = context.dataset.capped && context.dataset.capped[context.dataIndex];
                                return context.dataset.label + ': €' + amount +
                                    (capped ? '  ⛔ no tecto legal' : '');
                            },
                            afterBody: (items) => {
                                const i = items[0].dataIndex;
                                const capped = items
                                    .filter(it => it.dataset.capped && it.dataset.capped[i])
                                    .map(it => it.dataset.label);
                                return capped.length ? ['', 'No tecto: ' + capped.join(', ')] : [];
                            }
                        }
                    }
                }
            }
        });
    }

    populateBaseYearDropdown() {
        const baseYearSelect = document.getElementById('baseYear');

        // Get years from both inflation data and tax data
        const inflationYears = Object.keys(this.inflationData);
        const taxYears = this.taxData.map(data => data.year.toString());

        // Merge and deduplicate years
        const allYears = [...new Set([...inflationYears, ...taxYears])];
        const sortedYears = allYears.sort((a, b) => parseInt(b) - parseInt(a));

        // Clear existing options
        baseYearSelect.innerHTML = '';

        // Add years from merged data
        sortedYears.forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            baseYearSelect.appendChild(option);
        });

        // Set default to the most recent year
        if (sortedYears.length > 0) {
            baseYearSelect.value = sortedYears[0];
        }
    }

    setupEventListeners() {
        const calculateBtn = document.getElementById('calculate');
        const incomeInput = document.getElementById('income');
        const baseYearSelect = document.getElementById('baseYear');
        const compareYear1Select = document.getElementById('compareYear1Select');
        const compareYear2Select = document.getElementById('compareYear2Select');

        // Populate comparison dropdowns
        this.populateComparisonDropdowns();

        calculateBtn.addEventListener('click', () => this.calculate());
        incomeInput.addEventListener('input', () => {
            this.calculate();
            this.calculateProfileChart(); // the art. 25.o allowance depends on income
            this.debounceIncomeTracking(incomeInput.value);
        });
        baseYearSelect.addEventListener('change', () => {
            this.calculate();
            this.trackInputEvent('base_year_change', baseYearSelect.value);
        });
        compareYear1Select.addEventListener('change', () => {
            this.calculateComparison();
            this.trackInputEvent('compare_year1_change', compareYear1Select.value);
        });
        compareYear2Select.addEventListener('change', () => {
            this.calculateComparison();
            this.trackInputEvent('compare_year2_change', compareYear2Select.value);
        });
    }

    calculateTax(income, brackets) {
        let tax = 0;
        let remainingIncome = income;

        for (const bracket of brackets) {
            const from = bracket.from;
            const until = bracket.until || Infinity;
            const rate = bracket.tax;

            if (remainingIncome <= 0) break;

            const taxableInThisBracket = Math.min(remainingIncome, until - from);
            if (taxableInThisBracket > 0) {
                tax += taxableInThisBracket * rate;
                remainingIncome -= taxableInThisBracket;
            }
        }

        return tax;
    }

    adjustForInflation(income, fromYear, toYear) {
        if (fromYear === toYear) return income;

        let adjustedIncome = income;
        const years = this.getYearRange(fromYear, toYear);

        for (const year of years) {
            const inflationRate = this.inflationData[year] || 0;
            if (fromYear < toYear) {
                // Going forward in time: multiply by inflation
                adjustedIncome *= (1 + inflationRate / 100);
            } else {
                // Going backward in time: divide by inflation (deflate)
                adjustedIncome /= (1 + inflationRate / 100);
            }
        }

        return adjustedIncome;
    }

    // Reference year for converting amounts into "today's euros".
    //
    // The calendar year looks like the obvious choice, but any year missing from
    // inflation_pt.json is treated as 0% (see adjustForInflation), which silently
    // understates every figure and makes the most recent years come out equal.
    // Anchoring to the last year with data avoids that: adding one line to the
    // JSON moves the reference forward.
    referenceYear() {
        const years = Object.keys(this.inflationData).map(Number).filter(Number.isFinite);
        if (!years.length) return new Date().getFullYear();
        return Math.min(Math.max(...years), new Date().getFullYear());
    }

    getYearRange(fromYear, toYear) {
        const start = Math.min(fromYear, toYear);
        const end = Math.max(fromYear, toYear);
        const years = [];

        if (fromYear < toYear) {
            // Going forward: use years from fromYear+1 to toYear
            for (let year = fromYear + 1; year <= toYear; year++) {
                years.push(year);
            }
        } else {
            // Going backward: use years from fromYear down to toYear+1 (in reverse)
            for (let year = fromYear; year > toYear; year--) {
                years.push(year);
            }
        }

        return years;
    }

    calculatePurchasingPower(netIncome, fromYear, toYear) {
        if (fromYear === toYear) return 1;

        // Calculate what the net income from 'fromYear' would be worth in 'toYear' money
        return this.adjustForInflation(netIncome, fromYear, toYear) / netIncome;
    }

    calculateSingleDatapoint(income, baseYear, yearData, currentYear) {
        const year = yearData.year;

        // Calculate what the base year income would be worth in this year's money
        const adjustedIncome = this.adjustForInflation(income, baseYear, year);
        const tax = this.calculateTax(adjustedIncome, yearData.brackets);
        const taxRate = adjustedIncome > 0 ? (tax / adjustedIncome) * 100 : 0;
        const netIncome = adjustedIncome - tax;

        // Calculate purchasing power: what this net income would be worth in base year money
        const netIncomeInBaseYear = this.adjustForInflation(netIncome, year, baseYear);
        const purchasingPowerRatio = income > 0 ? netIncomeInBaseYear / income : 1;

        // Calculate current year values for tax and net income
        const taxAmountCurrent = this.adjustForInflation(tax, year, currentYear);
        const netIncomeCurrent = this.adjustForInflation(netIncome, year, currentYear);

        return {
            adjustedIncome,
            taxRate,
            taxAmount: tax,
            taxAmountCurrent,
            netIncome,
            netIncomeCurrent,
            purchasingPowerRatio
        }
    }


    calculate() {
        const income = parseFloat(document.getElementById('income').value) || 0;
        const baseYear = parseInt(document.getElementById('baseYear').value);
        const currentYear = this.referenceYear();

        const results = [];

        for (const yearData of this.taxData) {
            const datapoint = this.calculateSingleDatapoint(income, baseYear, yearData, currentYear);
            const year = yearData.year;
            const label = yearData.label || year.toString();

            results.push({
                year,
                label,
                originalIncome: income,
                adjustedIncome: datapoint.adjustedIncome,
                taxRate: datapoint.taxRate,
                taxAmount: datapoint.taxAmount,
                taxAmountCurrent: datapoint.taxAmountCurrent,
                netIncome: datapoint.netIncome,
                netIncomeCurrent: datapoint.netIncomeCurrent,
                purchasingPower: datapoint.purchasingPowerRatio,
                baseYear // Add baseYear to each result
            });
        }

        this.displayResults(results);
        this.updateChart(results);
    }

    calculateComparison() {
        const baseYear = parseInt(document.getElementById('baseYear').value);
        const year1 = parseInt(document.getElementById('compareYear1Select').value);
        const year2 = parseInt(document.getElementById('compareYear2Select').value);

        const taxData1 = this.taxData.find(e => e.year === year1);
        const taxData2 = this.taxData.find(e => e.year === year2);
        const incomes = []
        for (let i = 5000; i < 120000; i+=100) {
            incomes.push(i)
        }

        const result = incomes.map(income => ({
            income,
            year1,
            year1Data: this.calculateSingleDatapoint(income, baseYear, taxData1, year1),
            year2,
            year2Data: this.calculateSingleDatapoint(income, baseYear, taxData2, year2)
        }))

        this.updateComparisonChart(result)
    }

    calculateDeductionsChart() {
        const currentYear = this.referenceYear();

        if (!this.deductionsData.length) return;

        // Get all unique deduction types across all years
        const allDeductionTypes = new Set();
        this.deductionsData.forEach(yearData => {
            Object.keys(yearData.deductions).forEach(type => {
                // Only include deductions with limits to avoid cluttering the chart
                if (yearData.deductions[type].limit) {
                    allDeductionTypes.add(type);
                }
            });
        });

        // Generate colors for each deduction type
        const colors = [
            '#6B7280', '#8B5A3C', '#6366F1', '#DC2626', '#059669', '#0891B2',
            '#7C2D12', '#4338CA', '#BE185D', '#9333EA'
        ];

        const datasets = [];
        let colorIndex = 0;

        // Create dataset for each deduction type
        allDeductionTypes.forEach(deductionType => {
            const data = [];

            this.deductionsData.forEach(yearData => {
                const deduction = yearData.deductions[deductionType];
                if (deduction && deduction.limit) {
                    // Convert limit to current year value
                    const limitCurrentValue = this.adjustForInflation(deduction.limit, yearData.year, currentYear);
                    data.push(limitCurrentValue);
                } else {
                    data.push(null); // No data for this year
                }
            });

            // Only add dataset if it has at least one non-null value
            if (data.some(value => value !== null)) {
                // Not deductionsData[0]: a category that has since been revoked
                // (gyms, dropped in 2024) is absent from the newest year, and
                // looking it up only there falls back to the raw key.
                const deductionName = this.categoryLabel(deductionType);

                datasets.push({
                    label: deductionName,
                    data: data,
                    borderColor: colors[colorIndex % colors.length],
                    backgroundColor: colors[colorIndex % colors.length] + 'CC',
                    tension: 0.1,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    spanGaps: false // Don't connect across null values
                });
                colorIndex++;
            }
        });

        // Add total deductions as a line
        const totalDeductionsData = this.deductionsData.map(yearData => {
            // Calculate total of all deduction limits for this year
            let totalDeductions = 0;
            Object.values(yearData.deductions).forEach(deduction => {
                if (deduction.limit) {
                    totalDeductions += deduction.limit;
                }
            });
            return this.adjustForInflation(totalDeductions, yearData.year, currentYear);
        });


        datasets.push({
            label: 'Total',
            data: totalDeductionsData,
            type: 'line',
            borderColor: '#DC2626',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            borderWidth: 3,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.1,
            borderDash: [5, 5]
        });

        this.updateDeductionsChart(datasets, this.deductionsData.map(d => d.label || d.year.toString()));
    }

    updateDeductionsChart(datasets, labels) {
        const ctx = document.getElementById('deductionsChart').getContext('2d');

        if (this.deductionsChart) {
            this.deductionsChart.destroy();
        }

        this.deductionsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 750
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Ano'
                        },
                        reverse: true,
                        stacked: true
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Limite de Dedução (€)'
                        },
                        beginAtZero: true,
                        ticks: {
                            maxTicksLimit: 8
                        },
                        stacked: true
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Evolução dos Limites de Deduções IRS (Valores Atuais)'
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: false,
                            boxWidth: 12
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (context.parsed.y === null) {
                                    return context.dataset.label + ': Não disponível';
                                }
                                return context.dataset.label + ': €' + context.parsed.y.toLocaleString('pt-PT', {maximumFractionDigits: 0});
                            }
                        }
                    }
                }
            }
        });
    }

    // --- Spending profile ---------------------------------------------------
    // Compares the deduction actually obtained, not the statutory ceiling. The
    // basket is held constant in real terms, so the only thing that varies
    // between years is the tax law itself.

    // Limits the law sets per taxpayer; every other limit is per household.
    static PER_TAXPAYER = ['familyExpenses', 'retirementSavings'];

    deductionRule(yearData, category) {
        const rule = yearData.deductions[category];
        if (!rule) return null; // categoria não existia nesse ano

        // limit: null + unlimited: true => the deduction existed with no ceiling.
        // limit: null on its own => the deduction did not exist that year.
        const cap = rule.unlimited ? Infinity : rule.limit;
        if (cap === null || cap === undefined) return null;
        return { percentage: rule.percentage, cap };
    }

    // Deduction obtained for one category, in that year's euros.
    deductionFor(yearData, category, spendBase, baseYear, taxpayers) {
        const rule = this.deductionRule(yearData, category);
        if (!rule || !spendBase) return 0;

        const spend = this.adjustForInflation(spendBase, baseYear, yearData.year);
        const cap = TaxCalculator.PER_TAXPAYER.includes(category)
            ? rule.cap * taxpayers
            : rule.cap;

        return Math.min(rule.percentage * spend, cap);
    }

    // Interest and rent shared a single ceiling and were not cumulative until
    // 2012 (art. 85.o n.o 3), so those years count only the larger of the two.
    housingDeduction(yearData, spending, baseYear, taxpayers) {
        const juros = this.deductionRule(yearData, 'mortgageInterest');
        const rendas = this.deductionRule(yearData, 'rent');
        const dJuros = this.deductionFor(yearData, 'mortgageInterest', spending.mortgageInterest, baseYear, taxpayers);
        const dRendas = this.deductionFor(yearData, 'rent', spending.rent, baseYear, taxpayers);

        const sharedCap = juros && rendas && juros.cap === rendas.cap;
        return sharedCap ? Math.max(dJuros, dRendas) : dJuros + dRendas;
    }

    // Brackets for that year. Where a year has more than one regime (2025 had a
    // January and a June version) this takes the first, which is the later one.
    bracketsForYear(year) {
        const entry = this.taxData.find(d => d.year === year);
        return entry ? entry.brackets : null;
    }

    // Tax value of the employment-income allowance (deducao especifica, art. 25.o).
    //
    // It is not a deducao a coleta: it reduces INCOME, so a euro of it is worth a
    // euro times the marginal rate, not a euro of tax. To sit alongside the coleta
    // deductions it is converted into the extra tax that would be due without it.
    // The income field is taxable income, as everywhere else in the app, so the
    // allowance is added back to recover the income before it.
    specificDeductionValue(yearData, taxableBase) {
        const rule = yearData.deductions.base;
        const brackets = this.bracketsForYear(yearData.year);
        if (!rule || !rule.limit || !brackets || taxableBase <= 0) return 0;

        const withoutIt = this.calculateTax(taxableBase + rule.limit, brackets);
        const withIt = this.calculateTax(taxableBase, brackets);
        return Math.max(0, withoutIt - withIt);
    }

    // VAT rate applicable to a category in a given year, used to recover the VAT
    // contained in a gross price: VAT = spend * rate / (1 + rate).
    vatRateFor(category, year) {
        const rates = (this.profilesData.meta.vatRates || {})[category];
        if (!rates) return null;
        const override = rates.overrides && rates.overrides[String(year)];
        return override === undefined ? rates.rate : override;
    }

    isVatCategory(category) {
        return category.startsWith('vat');
    }

    // Every invoice-VAT deduction shares ONE global ceiling of 250 EUR per
    // household (art. 78.o-F n.o 1, and n.os 3, 6 and 7 explicitly count towards
    // it), so the sectors are summed first and capped once. Showing them as
    // separate capped rows would multiply the ceiling by the number of sectors.
    vatDeduction(yearData, spending, baseYear) {
        let total = 0;
        let cap = null;

        for (const category of this.profilesData.categories) {
            if (!this.isVatCategory(category)) continue;

            const rule = this.deductionRule(yearData, category);
            if (!rule) continue;
            cap = rule.cap;

            const rate = this.vatRateFor(category, yearData.year);
            const spend = spending[category];
            if (rate == null || !spend) continue;

            const gross = this.adjustForInflation(spend, baseYear, yearData.year);
            const vatBorne = gross * rate / (1 + rate);
            total += rule.percentage * vatBorne;
        }

        if (cap === null) return 0;
        return Math.min(total, cap);
    }

    calculateProfileChart() {
        if (!this.deductionsData.length || !this.profilesData) return;

        const currentYear = this.referenceYear();
        const baseYear = this.profilesData.meta.baseYear;
        const spending = this.currentSpending;
        const taxpayers = this.currentTaxpayers || 1;

        const housingKeys = ['mortgageInterest', 'rent'];
        const plainKeys = this.profilesData.categories.filter(
            c => !housingKeys.includes(c) && !this.isVatCategory(c)
        );

        const years = this.deductionsData;

        // A category is "at the ceiling" when the deduction hits its legal limit.
        const isCapped = (yearData, category, value) => {
            const rule = this.deductionRule(yearData, category);
            if (!rule || !Number.isFinite(rule.cap)) return false;
            const cap = TaxCalculator.PER_TAXPAYER.includes(category)
                ? rule.cap * taxpayers
                : rule.cap;
            return value > 0 && Math.abs(value - cap) < 0.005;
        };

        const datasets = plainKeys.map((category, i) => {
            const nominal = years.map(yearData =>
                this.deductionFor(yearData, category, spending[category], baseYear, taxpayers)
            );
            return {
                label: this.categoryLabel(category),
                data: nominal.map((value, j) =>
                    this.adjustForInflation(value, years[j].year, currentYear)
                ),
                capped: nominal.map((value, j) => isCapped(years[j], category, value)),
                backgroundColor: TaxCalculator.PROFILE_COLORS[i % TaxCalculator.PROFILE_COLORS.length]
            };
        });

        const housingNominal = years.map(yearData =>
            this.housingDeduction(yearData, spending, baseYear, taxpayers)
        );
        datasets.push({
            label: 'Habitação',
            data: housingNominal.map((value, j) =>
                this.adjustForInflation(value, years[j].year, currentYear)
            ),
            capped: housingNominal.map((value, j) =>
                isCapped(years[j], 'mortgageInterest', value) || isCapped(years[j], 'rent', value)
            ),
            backgroundColor: TaxCalculator.PROFILE_COLORS[plainKeys.length % TaxCalculator.PROFILE_COLORS.length]
        });

        const vatNominal = years.map(yearData =>
            this.vatDeduction(yearData, spending, baseYear)
        );
        if (vatNominal.some(value => value > 0)) {
            datasets.push({
                label: 'IVA em faturas',
                data: vatNominal.map((value, j) =>
                    this.adjustForInflation(value, years[j].year, currentYear)
                ),
                capped: vatNominal.map((value, j) => {
                    const rule = this.deductionRule(years[j], 'vatRestaurants');
                    return !!rule && value > 0 && Math.abs(value - rule.cap) < 0.005;
                }),
                backgroundColor: TaxCalculator.PROFILE_COLORS[(plainKeys.length + 1) % TaxCalculator.PROFILE_COLORS.length]
            });
        }

        // Employment-income allowance (art. 25.o), expressed in euros of tax.
        const incomeInput = document.getElementById('income');
        const income = parseFloat(incomeInput && incomeInput.value) || 0;
        if (income > 0) {
            const specificNominal = years.map(yearData =>
                this.specificDeductionValue(
                    yearData,
                    this.adjustForInflation(income, currentYear, yearData.year)
                )
            );
            datasets.push({
                label: 'Dedução específica (em imposto)',
                data: specificNominal.map((value, j) =>
                    this.adjustForInflation(value, years[j].year, currentYear)
                ),
                capped: specificNominal.map(() => false),
                backgroundColor: '#94A3B8'
            });
        }

        const totals = years.map((_, i) => datasets.reduce((sum, d) => sum + d.data[i], 0));

        datasets.push({
            label: 'Total',
            data: totals,
            type: 'line',
            borderColor: '#DC2626',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            borderWidth: 3,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.1,
            borderDash: [5, 5]
        });

        this.updateProfileChart(datasets, years.map(d => d.label || d.year.toString()));
        this.displayProfileSummary(years, totals);
    }

    categoryLabel(category) {
        const first = this.deductionsData.find(d => d.deductions[category]);
        return first ? first.deductions[category].name : category;
    }

    displayProfileSummary(years, totals) {
        const el = document.getElementById('profileSummary');
        if (!el) return;

        const byYear = years.map((d, i) => ({ year: d.year, label: d.label, total: totals[i] }));
        const latest = byYear.reduce((a, b) => (a.year > b.year ? a : b));
        const best = byYear.reduce((a, b) => (a.total > b.total ? a : b));
        const delta = latest.total - best.total;

        el.innerHTML = `
            Com este cabaz, a dedução seria de
            <strong>€${latest.total.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</strong> em ${latest.label}.
            O melhor ano foi <strong>${best.label}</strong>, com
            <strong>€${best.total.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</strong>
            — uma diferença de
            <strong class="${delta < 0 ? 'negative' : 'positive'}">€${Math.abs(delta).toLocaleString('pt-PT', {maximumFractionDigits: 0})}</strong>
            (tudo a preços de ${this.referenceYear()}).
        `;
    }

    static PROFILE_COLORS = ['#DC2626', '#059669', '#6366F1', '#D97706', '#0891B2', '#BE185D', '#4338CA'];

    displayResults(results) {
        const tbody = document.querySelector('#resultsTable tbody');
        tbody.innerHTML = '';

        results.forEach(result => {
            const row = document.createElement('tr');

            const purchasingPowerClass = result.purchasingPower > 1 ? 'positive' :
                                       result.purchasingPower < 1 ? 'negative' : '';

            // Check if inflation data exists for this year AND if it's different from base year
            const hasInflationData = this.inflationData.hasOwnProperty(result.year.toString());
            const isDifferentFromBaseYear = result.year !== result.baseYear;
            const warningIcon = (hasInflationData || !isDifferentFromBaseYear) ? '' : '<span class="warning-icon" title="Dados de inflação não disponíveis para este ano">⚠️</span>';

            row.innerHTML = `
                <td><strong>${result.label}</strong>${warningIcon}</td>
                <td>€${result.originalIncome.toLocaleString('pt-PT')}</td>
                <td>€${result.adjustedIncome.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
                <td>${result.taxRate.toFixed(2)}%</td>
                <td>€${result.taxAmount.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
                <td>€${result.taxAmountCurrent.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
                <td>€${result.netIncome.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
                <td>€${result.netIncomeCurrent.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
                <td class="${purchasingPowerClass}">${(result.purchasingPower * 100).toFixed(1)}%</td>
            `;

            tbody.appendChild(row);
        });
    }

    updateChart(results) {
        const ctx = document.getElementById('taxChart').getContext('2d');

        if (this.chart) {
            this.chart.destroy();
        }

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: results.map(r => r.label),
                datasets: [
                    {
                        label: 'Taxa de IRS (%)',
                        data: results.map(r => r.taxRate),
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        tension: 0.4,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Poder de Compra (%)',
                        data: results.map(r => r.purchasingPower * 100),
                        borderColor: '#764ba2',
                        backgroundColor: 'rgba(118, 75, 162, 0.1)',
                        tension: 0.4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Ano'
                        },
                        reverse: true
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Taxa de IRS (%)'
                        },
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Poder de Compra (%)'
                        },
                        grid: {
                            drawOnChartArea: false,
                        },
                    }
                }
              ,
                plugins: {
                    title: {
                        display: true,
                        text: 'Taxa de IRS vs Poder de Compra ao Longo do Tempo'
                    },
                    legend: {
                        display: true
                    }
                }
            }
        });
    }


    updateComparisonChart(results) {
        const ctx = document.getElementById('comparisonChart').getContext('2d');

        if (this.comparisonChart) {
            this.comparisonChart.destroy();
        }

        this.comparisonChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: results.map(r => r.income),
                datasets: [
                    {
                        label: results[0].year1,
                        data: results.map(r => r.year1Data.taxRate),
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        yAxisID: 'y',
                        pointRadius: 0,
                        borderWidth: 1.5,
                    },
                    {
                        label: results[0].year2,
                        data: results.map(r => r.year2Data.taxRate),
                        borderColor: '#764ba2',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        yAxisID: 'y',
                        pointRadius: 0,
                        borderWidth: 1.5,
                    },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Rendimento coletável'
                        },
                        type: 'linear'
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Taxa de IRS (%)'
                        },
                        min: 0,
                    }
                }
              ,
                plugins: {
                    title: {
                        display: true,
                        text: 'Taxa de IRS ajustada à inflação'
                    },
                    legend: {
                        display: true
                    }
                }
            }
        });
    }

    populateSources() {
        const sourcesContainer = document.getElementById('sourcesList');

        // Group sources by year to handle cases where there are multiple entries per year
        const sourcesByYear = {};

        this.taxData.forEach(yearData => {
            const year = yearData.year;
            const label = yearData.label || year.toString();

            if (!sourcesByYear[year]) {
                sourcesByYear[year] = [];
            }

            sourcesByYear[year].push({
                label: label,
                source: yearData.source
            });
        });

        // Sort years in descending order
        const sortedYears = Object.keys(sourcesByYear).sort((a, b) => parseInt(b) - parseInt(a));

        sortedYears.forEach(year => {
            const yearSources = sourcesByYear[year];

            yearSources.forEach(item => {
                const sourceDiv = document.createElement('div');
                sourceDiv.className = 'source-item';

                // Create header (clickable)
                const sourceHeader = document.createElement('div');
                sourceHeader.className = 'source-header';
                sourceHeader.innerHTML = `
                    <h3>${item.label}</h3>
                    <span class="source-toggle">▶</span>
                `;

                // Create content (collapsible)
                const sourceContent = document.createElement('div');
                sourceContent.className = 'source-content';
                sourceContent.innerHTML = `
                    <p>
                        <strong>Fonte:</strong>
                        <a href="${item.source.url}" target="_blank" rel="noopener noreferrer">
                            ${item.source.url}
                        </a>
                    </p>
                    <p>
                        <strong>Backup:</strong>
                        <a href="${item.source.backup}" target="_blank" rel="noopener noreferrer">
                            ${item.source.backup}
                        </a>
                    </p>
                `;

                // Add click event to header
                sourceHeader.addEventListener('click', () => {
                    const toggle = sourceHeader.querySelector('.source-toggle');
                    const isExpanded = sourceContent.classList.contains('expanded');

                    if (isExpanded) {
                        sourceContent.classList.remove('expanded');
                        toggle.classList.remove('expanded');
                    } else {
                        sourceContent.classList.add('expanded');
                        toggle.classList.add('expanded');
                    }
                });

                sourceDiv.appendChild(sourceHeader);
                sourceDiv.appendChild(sourceContent);
                sourcesContainer.appendChild(sourceDiv);
            });
        });

        this.populateDeductionsSources();
    }

    populateComparisonDropdowns() {
        const compareYear1Select = document.getElementById('compareYear1Select');
        const compareYear2Select = document.getElementById('compareYear2Select');

        // Clear existing options
        compareYear1Select.innerHTML = '';
        compareYear2Select.innerHTML = '';

        // Create options from tax data (each entry gets its own option)
        this.taxData.forEach(yearData => {
            const year = yearData.year;
            const label = yearData.label || year.toString();

            // Create option for first dropdown
            const option1 = document.createElement('option');
            option1.value = year;
            option1.textContent = label;
            compareYear1Select.appendChild(option1);

            // Create option for second dropdown
            const option2 = document.createElement('option');
            option2.value = year;
            option2.textContent = label;
            compareYear2Select.appendChild(option2);
        });

        // Set default values to first two entries if available
        if (this.taxData.length >= 2) {
            compareYear1Select.value = this.taxData[this.taxData.length - 1].year;
            compareYear2Select.value = this.taxData[0].year;
        }
    }

    populateDeductionsSources() {
        const sourcesContainer = document.getElementById('sourcesList');

        // Add deductions sources
        this.deductionsData.forEach(yearData => {
            const sourceDiv = document.createElement('div');
            sourceDiv.className = 'source-item';

            const sourceHeader = document.createElement('div');
            sourceHeader.className = 'source-header';
            sourceHeader.innerHTML = `
                <h3>Deduções ${yearData.label}</h3>
                <span class="source-toggle">▶</span>
            `;

            const sourceContent = document.createElement('div');
            sourceContent.className = 'source-content';
            sourceContent.innerHTML = `
                <p>
                    <strong>Fonte:</strong>
                    <a href="${yearData.source.url}" target="_blank" rel="noopener noreferrer">
                        ${yearData.source.url}
                    </a>
                </p>
                <p>
                    <strong>Backup:</strong>
                    <a href="${yearData.source.backup}" target="_blank" rel="noopener noreferrer">
                        ${yearData.source.backup}
                    </a>
                </p>
            `;

            sourceHeader.addEventListener('click', () => {
                const toggle = sourceHeader.querySelector('.source-toggle');
                const isExpanded = sourceContent.classList.contains('expanded');

                if (isExpanded) {
                    sourceContent.classList.remove('expanded');
                    toggle.classList.remove('expanded');
                } else {
                    sourceContent.classList.add('expanded');
                    toggle.classList.add('expanded');
                }
            });

            sourceDiv.appendChild(sourceHeader);
            sourceDiv.appendChild(sourceContent);
            sourcesContainer.appendChild(sourceDiv);
        });
    }

    debounceIncomeTracking(value) {
        // Clear the previous timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Set a new timer to track the event after 1 second of inactivity
        this.debounceTimer = setTimeout(() => {
            this.trackInputEvent('income_change', value);
        }, 1000);
    }

    trackInputEvent(eventName, value) {
        if (typeof gtag !== 'undefined') {
            gtag('event', eventName, {
                event_category: 'input_interaction',
                event_label: eventName,
                value: value,
                custom_parameter: value
            });
        }
    }
}

// Initialize the calculator when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TaxCalculator();
});
