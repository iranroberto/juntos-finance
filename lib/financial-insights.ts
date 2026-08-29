export type FinancialInsightSeverity = "high" | "medium" | "low" | "positive";

export type FinancialInsight = {
  id: string;
  type: "category_increase" | "category_reduction" | "expense_ratio" | "negative_result" | "top_category" | "due_account" | "unusual_expense" | "goal";
  title: string;
  message: string;
  severity: FinancialInsightSeverity;
  value?: number;
  percentage?: number;
  category?: string;
  detail?: string;
};

export type FinancialInsightTransaction = {
  id?: string | number;
  type?: string;
  title?: string;
  category?: string;
  value?: number | string;
  dateInput?: string;
};

export type FinancialInsightDueAccount = {
  id?: string | number;
  title?: string;
  date?: string;
  dateInput?: string;
  type?: string;
  paid?: boolean;
  status?: string;
  paidAt?: string | null;
};

export type FinancialInsightGoal = {
  id?: string | number;
  title?: string;
  current?: number | string;
  total?: number | string;
};

export type GenerateFinancialInsightsInput = {
  transactions: FinancialInsightTransaction[];
  dueAccounts?: FinancialInsightDueAccount[];
  goals?: FinancialInsightGoal[];
  period: string;
  today?: string;
  hidden?: boolean;
};

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const amount = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; };
const categoryOf = (item: FinancialInsightTransaction) => String(item.category || "Outros").trim() || "Outros";
const monthBefore = (period: string) => { const [year, month] = period.split("-").map(Number); const date = new Date(year, month - 2, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; };
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000);
const priority: Record<FinancialInsightSeverity, number> = { high: 0, medium: 1, low: 2, positive: 3 };

export function generateFinancialInsights(input: GenerateFinancialInsightsInput): FinancialInsight[] {
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const goals = Array.isArray(input.goals) ? input.goals : [];
  const dueAccounts = Array.isArray(input.dueAccounts) ? input.dueAccounts : [];
  const previousPeriod = monthBefore(input.period);
  const current = transactions.filter(item => item.dateInput?.startsWith(input.period));
  const previous = transactions.filter(item => item.dateInput?.startsWith(previousPeriod));
  const currentExpenses = current.filter(item => item.type === "out" && amount(item.value) > 0);
  const income = current.filter(item => item.type === "in").reduce((sum, item) => sum + amount(item.value), 0);
  const expense = currentExpenses.reduce((sum, item) => sum + amount(item.value), 0);
  const insights: Array<FinancialInsight & { rank: number }> = [];
  let sequence = 0;
  const add = (insight: FinancialInsight) => insights.push({ ...insight, rank: sequence++ });

  const today = input.today || new Intl.DateTimeFormat("en-CA").format(new Date());
  const actionableDue = dueAccounts
    .filter(item => item.type !== "income" && !item.paid && !item.paidAt && item.status !== "Pago" && item.status !== "Efetivada")
    .map(item => ({ ...item, dueDate: item.dateInput || item.date || "" }))
    .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate))
    .map(item => ({ ...item, days: daysBetween(today, item.dueDate) }))
    .filter(item => item.days <= 7)
    .sort((a, b) => a.days - b.days);
  const mostUrgent = actionableDue[0];
  if (mostUrgent) {
    const overdue = actionableDue.filter(item => item.days < 0).length;
    const todayCount = actionableDue.filter(item => item.days === 0).length;
    const title = overdue ? (overdue === 1 ? "Conta vencida" : "Contas vencidas") : todayCount ? (todayCount === 1 ? "Conta vence hoje" : "Contas vencem hoje") : "Conta próxima do vencimento";
    const message = overdue ? `Você possui ${overdue} ${overdue === 1 ? "conta vencida" : "contas vencidas"}.` : todayCount ? `Você possui ${todayCount} ${todayCount === 1 ? "conta que vence hoje" : "contas que vencem hoje"}.` : `${mostUrgent.title || "Uma conta"} vence em ${mostUrgent.days} ${mostUrgent.days === 1 ? "dia" : "dias"}.`;
    add({ id: `due-${mostUrgent.id || mostUrgent.dueDate}`, type: "due_account", title, message, severity: mostUrgent.days <= 0 ? "high" : mostUrgent.days <= 3 ? "medium" : "low" });
  }

  if (expense > income && expense > 0) {
    const difference = expense - income;
    add({ id: `negative-${input.period}`, type: "negative_result", title: "Resultado negativo", message: input.hidden ? "Suas despesas ultrapassaram suas receitas neste mês." : `Suas despesas ultrapassaram suas receitas em ${money(difference)}.`, severity: "high", value: difference });
  } else if (income > 0 && expense / income >= 0.8) {
    const percentage = Math.round(expense / income * 100);
    add({ id: `ratio-${input.period}`, type: "expense_ratio", title: "Receitas comprometidas", message: `Suas despesas já consumiram ${percentage}% das receitas deste mês.`, severity: percentage >= 90 ? "high" : "medium", percentage });
  }

  const totals = (items: FinancialInsightTransaction[]) => items.filter(item => item.type === "out").reduce<Record<string, { total: number; count: number }>>((result, item) => { const category = categoryOf(item); result[category] ||= { total: 0, count: 0 }; const value = amount(item.value); if (value) { result[category].total += value; result[category].count += 1; } return result; }, {});
  const currentTotals = totals(current);
  const previousTotals = totals(previous);
  Object.entries(currentTotals).forEach(([category, data]) => {
    const before = previousTotals[category];
    if (!before || before.total <= 0) return;
    const percentage = Math.round((data.total - before.total) / before.total * 100);
    if (percentage >= 20) add({ id: `increase-${input.period}-${category}`, type: "category_increase", title: "Aumento de gasto", message: `Seus gastos com ${category} aumentaram ${percentage}% este mês.`, detail: input.hidden ? undefined : `Você gastou ${money(data.total)} contra ${money(before.total)} no mês anterior.`, severity: percentage >= 50 ? "high" : "medium", value: data.total, percentage, category });
    if (percentage <= -20) add({ id: `reduction-${input.period}-${category}`, type: "category_reduction", title: "Redução de gastos", message: `Você reduziu seus gastos com ${category} em ${Math.abs(percentage)}%.`, detail: input.hidden ? undefined : `Você gastou ${money(data.total)} contra ${money(before.total)} no mês anterior.`, severity: "positive", value: data.total, percentage: Math.abs(percentage), category });
  });

  const topCategory = Object.entries(currentTotals).sort((a, b) => b[1].total - a[1].total)[0];
  if (topCategory && expense > 0) { const percentage = Math.round(topCategory[1].total / expense * 100); if (percentage >= 25) add({ id: `top-${input.period}-${topCategory[0]}`, type: "top_category", title: "Maior categoria de gasto", message: `${topCategory[0]} representa ${percentage}% dos seus gastos deste mês.`, severity: "low", value: topCategory[1].total, percentage, category: topCategory[0] }); }

  currentExpenses.forEach(item => {
    const history = transactions.filter(previousItem => previousItem.type === "out" && categoryOf(previousItem) === categoryOf(item) && previousItem.dateInput && previousItem.dateInput < `${input.period}-01` && amount(previousItem.value) > 0);
    if (history.length < 3) return;
    const average = history.reduce((sum, previousItem) => sum + amount(previousItem.value), 0) / history.length;
    const value = amount(item.value);
    const percentage = average > 0 ? Math.round((value - average) / average * 100) : 0;
    if (percentage >= 50) add({ id: `unusual-${item.id || item.dateInput}-${categoryOf(item)}`, type: "unusual_expense", title: "Gasto fora do padrão", message: `${item.title || "Esta compra"} em ${categoryOf(item)} foi ${percentage}% maior que sua média nessa categoria.`, severity: percentage >= 100 ? "high" : "medium", value, percentage, category: categoryOf(item) });
  });

  goals.forEach(goal => { const total = amount(goal.total); if (!total) return; const percentage = Math.min(100, Math.floor(amount(goal.current) / total * 100)); const threshold = percentage >= 100 ? 100 : percentage >= 90 ? 90 : percentage >= 80 ? 80 : 0; if (!threshold) return; add({ id: `goal-${goal.id || goal.title}-${threshold}`, type: "goal", title: threshold === 100 ? "Meta concluída" : "Meta avançando", message: threshold === 100 ? `Parabéns! Sua meta ${goal.title || "financeira"} foi concluída.` : `Você já alcançou ${threshold}% da sua meta ${goal.title || "financeira"}.`, severity: threshold === 100 ? "positive" : "low", percentage: threshold }); });

  const unique = new Map<string, FinancialInsight & { rank: number }>();
  const businessPriority = (item: FinancialInsight) => item.type === "due_account" && item.severity === "high" ? 0 : item.type === "negative_result" ? 1 : item.type === "expense_ratio" ? 2 : item.type === "due_account" ? 3 : item.type === "unusual_expense" ? 4 : item.type === "category_increase" ? 5 : item.type === "goal" ? 6 : item.type === "top_category" ? 7 : 8;
  insights.sort((a, b) => businessPriority(a) - businessPriority(b) || priority[a.severity] - priority[b.severity] || a.rank - b.rank).forEach(item => { const key = `${item.type}:${item.category || item.title}`; if (!unique.has(key)) unique.set(key, item); });
  return [...unique.values()].slice(0, 3).map(item => { const result: Partial<typeof item> = { ...item }; delete result.rank; return result as FinancialInsight; });
}
