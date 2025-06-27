class TaxCalculator {
    constructor() {
        this.taxData = [];
        this.inflationData = {};
        this.chart = null;
        this.init();
    }

    async init() {
        try {
            await this.loadTaxData();
            this.setupEventListeners();
            this.calculate(); // Initial calculation
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

        calculateBtn.addEventListener('click', () => this.calculate());
        incomeInput.addEventListener('input', () => this.calculate());
        baseYearSelect.addEventListener('change', () => this.calculate());
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

    calculate() {
        const income = parseFloat(document.getElementById('income').value) || 0;
        const baseYear = parseInt(document.getElementById('baseYear').value);

        const results = [];

        for (const yearData of this.taxData) {
            const year = yearData.year;


            // Calculate what the base year income would be worth in this year's money
            const adjustedIncome = this.adjustForInflation(income, baseYear, year);
            const tax = this.calculateTax(adjustedIncome, yearData.brackets);
            const taxRate = adjustedIncome > 0 ? (tax / adjustedIncome) * 100 : 0;
            const netIncome = adjustedIncome - tax;

            // Calculate purchasing power: what this net income would be worth in base year money
            const netIncomeInBaseYear = this.adjustForInflation(netIncome, year, baseYear);
            const purchasingPowerRatio = income > 0 ? netIncomeInBaseYear / income : 1;

            results.push({
                year,
                originalIncome: income,
                adjustedIncome,
                taxRate,
                taxAmount: tax,
                netIncome,
                purchasingPower: purchasingPowerRatio
            });
        }

        this.displayResults(results);
        this.updateChart(results);
    }

    displayResults(results) {
        const tbody = document.querySelector('#resultsTable tbody');
        tbody.innerHTML = '';

        results.forEach(result => {
            const row = document.createElement('tr');

            const purchasingPowerClass = result.purchasingPower > 1 ? 'positive' :
                                       result.purchasingPower < 1 ? 'negative' : '';

            row.innerHTML = `
                <td><strong>${result.year}</strong></td>
                <td>€${result.originalIncome.toLocaleString('pt-PT')}</td>
                <td>€${result.adjustedIncome.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
                <td>${result.taxRate.toFixed(2)}%</td>
                <td>€${result.taxAmount.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
                <td>€${result.netIncome.toLocaleString('pt-PT', {maximumFractionDigits: 0})}</td>
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
                labels: results.map(r => r.year.toString()),
                datasets: [
                    {
                        label: 'Tax Rate (%)',
                        data: results.map(r => r.taxRate),
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        tension: 0.4,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Purchasing Power (%)',
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
                            text: 'Year'
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Tax Rate (%)'
                        },
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Purchasing Power (%)'
                        },
                        grid: {
                            drawOnChartArea: false,
                        },
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Tax Rate vs Purchasing Power Over Time'
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
