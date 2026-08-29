import assert from "node:assert/strict";
import test from "node:test";
import { generateFinancialInsights } from "../lib/financial-insights.ts";

const tx = (type, value, dateInput, category = "Outros", extra = {}) => ({ type, value, dateInput, category, ...extra });
const run = (overrides = {}) => generateFinancialInsights({ transactions: [], period: "2026-08", today: "2026-08-28", ...overrides });

test("handles empty, income-only and expense-only data without invalid output", () => {
  assert.deepEqual(run(), []);
  assert.deepEqual(run({ transactions: [tx("in", 1000, "2026-08-01")] }), []);
  const expenseOnly = run({ transactions: [tx("out", 250, "2026-08-02", "Moradia")] });
  assert.equal(expenseOnly[0].type, "negative_result");
  assert.doesNotMatch(JSON.stringify(expenseOnly), /NaN|Infinity|undefined|null/);
});

test("prioritizes expenses above income and expense ratio thresholds", () => {
  assert.equal(run({ transactions: [tx("in", 1000, "2026-08-01"), tx("out", 1100, "2026-08-02")] })[0].severity, "high");
  const ratio = run({ transactions: [tx("in", 1000, "2026-08-01"), tx("out", 850, "2026-08-02")] }).find(item => item.type === "expense_ratio");
  assert.equal(ratio?.percentage, 85);
  assert.equal(ratio?.severity, "medium");
});

test("does not compare a category when previous month has no data", () => {
  const result = run({ transactions: [tx("out", 500, "2026-08-02", "Restaurante")] });
  assert.equal(result.some(item => item.type === "category_increase"), false);
});

test("detects category increases and reductions", () => {
  const result = run({ transactions: [tx("out", 100, "2026-07-02", "Restaurante"), tx("out", 150, "2026-08-02", "Restaurante"), tx("out", 200, "2026-07-03", "Delivery"), tx("out", 100, "2026-08-03", "Delivery"), tx("in", 2000, "2026-08-01")] });
  assert.equal(result.find(item => item.type === "category_increase")?.percentage, 50);
  assert.equal(result.find(item => item.type === "category_reduction")?.percentage, 50);
});

test("detects overdue, due today and upcoming accounts", () => {
  assert.equal(run({ dueAccounts: [{ id: 1, title: "Luz", date: "2026-08-27" }] })[0].title, "Conta vencida");
  assert.equal(run({ dueAccounts: [{ id: 2, title: "Água", date: "2026-08-28" }] })[0].title, "Conta vence hoje");
  assert.match(run({ dueAccounts: [{ id: 3, title: "Internet", date: "2026-08-31" }] })[0].message, /3 dias/);
  assert.deepEqual(run({ dueAccounts: [{ id: 4, title: "Internet", date: "2026-09-20" }] }), []);
});

test("detects goal milestones at 80, 90 and 100 percent", () => {
  assert.equal(run({ goals: [{ title: "Piscina", current: 80, total: 100 }] })[0].percentage, 80);
  assert.equal(run({ goals: [{ title: "Piscina", current: 90, total: 100 }] })[0].percentage, 90);
  assert.match(run({ goals: [{ title: "Piscina", current: 100, total: 100 }] })[0].message, /concluída/);
});

test("hides monetary details while preserving useful percentages", () => {
  const result = run({ hidden: true, transactions: [tx("out", 100, "2026-07-02", "Restaurante"), tx("out", 150, "2026-08-02", "Restaurante"), tx("in", 1000, "2026-08-01")] });
  const increase = result.find(item => item.type === "category_increase");
  assert.equal(increase?.percentage, 50);
  assert.equal(increase?.detail, undefined);
  assert.doesNotMatch(JSON.stringify(result), /R\$/);
});

test("requires historical evidence before reporting an unusual expense", () => {
  const sparse = run({ transactions: [tx("out", 10, "2026-07-01", "Lazer"), tx("out", 100, "2026-08-01", "Lazer", { id: 9 })] });
  assert.equal(sparse.some(item => item.type === "unusual_expense"), false);
  const sufficient = run({ transactions: [tx("out", 10, "2026-05-01", "Lazer"), tx("out", 10, "2026-06-01", "Lazer"), tx("out", 10, "2026-07-01", "Lazer"), tx("out", 100, "2026-08-01", "Lazer", { id: 9 }), tx("in", 1000, "2026-08-01")] });
  assert.equal(sufficient.some(item => item.type === "unusual_expense"), true);
});
