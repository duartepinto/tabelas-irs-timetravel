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
            this.populateBaseYearDropdown();
            this.setupEventListeners();

            // Initial calculations
            this.calculate();
            this.calculateComparison();
            this.calculateDeductionsChart();
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
        const currentYear = new Date().getFullYear();

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
        const currentYear = new Date().getFullYear();

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
                const deductionName = this.deductionsData[0].deductions[deductionType]?.name || deductionType;

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

        // Add overall limit as a line
        const limitData = this.deductionsData.map(yearData => {
            return this.adjustForInflation(yearData.limit, yearData.year, currentYear);
        });

        datasets.push({
            label: 'Limite Total de Deduções',
            data: limitData,
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
