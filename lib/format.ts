export function formatValue(value: unknown, unit?: string) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value !== "number") return String(value);

  if (unit === "percent") return `${(value > 1 ? value : value * 100).toFixed(2)}%`;
  if (unit === "currency") return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}