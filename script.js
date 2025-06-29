class TaxCalculator {
    constructor() {
        this.taxData = [];
        this.inflationData = {};
        this.chart = null;
        this.comparisonChart = null;
        this.init();
    }

    async init() {
        try {
            await this.loadTaxData();
            this.setupEventListeners();

            // Initial calculations
            this.calculate();
            this.calculateComparison();
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

    setupEventListeners() {
        const calculateBtn = document.getElementById('calculate');
        const incomeInput = document.getElementById('income');
        const baseYearSelect = document.getElementById('baseYear');
        const compareYear1Select = document.getElementById('compareYear1Select');
        const compareYear2Select = document.getElementById('compareYear2Select');

        calculateBtn.addEventListener('click', () => this.calculate());
        incomeInput.addEventListener('input', () => this.calculate());
        baseYearSelect.addEventListener('change', () => this.calculate());
        compareYear1Select.addEventListener('change', () => this.calculateComparison());
        compareYear2Select.addEventListener('change', () => this.calculateComparison());
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
                purchasingPower: datapoint.purchasingPowerRatio
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

    displayResults(results) {
        const tbody = document.querySelector('#resultsTable tbody');
        tbody.innerHTML = '';

        results.forEach(result => {
            const row = document.createElement('tr');

            const purchasingPowerClass = result.purchasingPower > 1 ? 'positive' :
                                       result.purchasingPower < 1 ? 'negative' : '';

            row.innerHTML = `
                <td><strong>${result.label}</strong></td>
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
}

// Initialize the calculator when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TaxCalculator();
});
