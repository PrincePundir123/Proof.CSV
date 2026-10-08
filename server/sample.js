import { readFile } from 'node:fs/promises';
import { parseCsv, profileCsv } from './csv.js';

export const SAMPLE_CODE = `import json
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('/workspace/input.csv')
df['date'] = pd.to_datetime(df['date'])
monthly = df.groupby(df['date'].dt.to_period('M'))['revenue'].sum()
monthly.index = monthly.index.astype(str)
monthly.to_csv('/workspace/output/monthly-revenue.csv')

fig, ax = plt.subplots(figsize=(10, 5))
ax.bar(monthly.index, monthly.values, color='#59764a', width=0.55)
ax.set(title='Revenue by month', ylabel='Revenue (INR)')
fig.tight_layout()
fig.savefig('/workspace/output/revenue.png', dpi=140)
plt.close(fig)

growth = (monthly.iloc[-1] / monthly.iloc[0] - 1) * 100
report = {
    'title': 'A stronger finish to the first half',
    'summary': f'Revenue increased {growth:.1f}% from January to June.',
    'metrics': [
        {'label':'Total revenue', 'value':f"INR {df['revenue'].sum():,.0f}", 'detail':'Across six months'},
        {'label':'Growth', 'value':f'{growth:.1f}%', 'detail':'January to June'},
        {'label':'Orders analyzed', 'value':str(len(df)), 'detail':'Every row included'}
    ],
    'findings': [f'June was the highest revenue month at INR {monthly.iloc[-1]:,.0f}.', 'March revenue dipped before recovering in April.'],
    'chartTitle': 'Revenue by month',
    'series': [{'label': label, 'value': float(value)} for label, value in monthly.items()]
}
with open('/workspace/output/report.json', 'w') as file:
    json.dump(report, file)
print(f'Analyzed {len(df)} rows and wrote the report, chart, and monthly totals.')
`;

export async function sampleData() {
  const csv = await readFile(new URL('../data/sample-sales.csv', import.meta.url), 'utf8');
  const { rows } = parseCsv(csv);
  const totals = new Map();
  for (const row of rows) { const month = row[0].slice(0, 7); totals.set(month, (totals.get(month) || 0) + Number(row[3])); }
  const series = [...totals].map(([label, value]) => ({ label, value }));
  const total = series.reduce((sum, item) => sum + item.value, 0);
  const growth = (series.at(-1).value / series[0].value - 1) * 100;
  return {
    filename: 'sample-sales.csv', csv, profile: profileCsv(csv), code: SAMPLE_CODE, sample: true,
    report: {
      title: 'A stronger finish to the first half', summary: `Revenue increased ${growth.toFixed(1)}% from January to June. A small dip in March was followed by three consecutive months of growth.`,
      metrics: [{ label: 'Total revenue', value: `₹${total.toLocaleString('en-IN')}`, detail: 'Across six months' }, { label: 'Revenue growth', value: `+${growth.toFixed(1)}%`, detail: 'January to June' }, { label: 'Orders analyzed', value: String(rows.length), detail: 'All rows in the sample' }],
      chartTitle: 'Revenue by month', series,
      findings: [`June generated ₹${series.at(-1).value.toLocaleString('en-IN')}, the highest monthly revenue in this sample.`, 'March revenue dipped before recovering in April.', 'This is a sample report computed by the server from bundled data. No AI call or sandbox execution took place.'],
    },
  };
}
