"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const BAR = "#168a68"; // validated: lightness band, chroma floor and contrast vs surface

type Row = { label: string; count: number };

export function CategoryChart({ data }: { data: Row[] }) {
  const height = Math.max(160, data.length * 34 + 16);
  return (
    <figure>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }} barCategoryGap={8}>
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={150}
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
              tick={{ fill: "var(--color-ink-2)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "var(--color-sunken)" }}
              contentStyle={{ borderRadius: 6, border: "1px solid var(--color-line)", fontSize: 12, color: "var(--color-ink)" }}
              formatter={(v) => [`${v} request${v === 1 ? "" : "s"}`, ""]}
              separator=""
            />
            <Bar dataKey="count" fill={BAR} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
              <LabelList dataKey="count" position="right" style={{ fill: "var(--color-ink-2)", fontSize: 12, fontVariantNumeric: "tabular-nums" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Requests by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Requests</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
