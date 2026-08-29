type FinancialRecord = Record<string, unknown>;

const asList = (value: unknown): FinancialRecord[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object") as FinancialRecord[] : [];
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function generateLocalFinancialAnswer(question: string, financialData: FinancialRecord): string {
  const transactions = asList(financialData.transactions);
  const goals = asList(financialData.goals);
  const budgets = asList(financialData.budgets);
  const subscriptions = asList(financialData.subscriptions);
  const hidden = financialData.privacyHidden === true;
  const query = normalize(question);
  const incomeItems = transactions.filter(item => item.type === "in");
  const expenseItems = transactions.filter(item => item.type === "out");
  const income = incomeItems.reduce((sum, item) => sum + number(item.value), 0);
  const expense = expenseItems.reduce((sum, item) => sum + number(item.value), 0);
  const result = income - expense;
  const value = (amount: number) => hidden ? "valor oculto" : brl(amount);
  const categoryTotals = expenseItems.reduce<Record<string, number>>((totals, item) => { const category = String(item.category || "Outros"); totals[category] = (totals[category] || 0) + number(item.value); return totals; }, {});
  const categories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const top = categories[0];

  if (!transactions.length && !goals.length && !budgets.length && !subscriptions.length) return "Ainda não há dados financeiros cadastrados para eu analisar. Adicione receitas, despesas, metas ou orçamentos e faça a pergunta novamente.";

  const mentionedCategory = categories.find(([category]) => query.includes(normalize(category)));
  if (mentionedCategory) {
    const count = expenseItems.filter(item => String(item.category || "Outros") === mentionedCategory[0]).length;
    const share = expense > 0 ? Math.round(mentionedCategory[1] / expense * 100) : 0;
    return `Você registrou ${count} ${count === 1 ? "despesa" : "despesas"} em ${mentionedCategory[0]}, totalizando ${value(mentionedCategory[1])}. Essa categoria representa ${share}% das suas despesas analisadas.`;
  }

  if (query.includes("econom") || query.includes("reduzir") || query.includes("cortar")) {
    if (!top) return "Não encontrei despesas suficientes para sugerir onde economizar.";
    const share = expense > 0 ? Math.round(top[1] / expense * 100) : 0;
    const saving = top[1] * 0.1;
    return `Sua maior categoria de despesa é ${top[0]}, com ${value(top[1])} (${share}% do total). Um primeiro passo seria revisar os lançamentos dessa categoria. Uma redução de 10% representaria ${value(saving)} de economia.`;
  }

  if (query.includes("meta")) {
    if (!goals.length) return "Você ainda não possui metas cadastradas. Crie uma meta com valor total e valor acumulado para eu acompanhar o progresso.";
    const ranked = goals.map(goal => ({ title: String(goal.title || "Meta"), percentage: number(goal.total) > 0 ? Math.min(100, Math.round(number(goal.current) / number(goal.total) * 100)) : 0 })).sort((a, b) => b.percentage - a.percentage);
    return `Sua meta mais avançada é ${ranked[0].title}, com ${ranked[0].percentage}% concluído. ${ranked[0].percentage >= 100 ? "Parabéns, ela foi concluída!" : "Continue acompanhando os aportes para chegar ao objetivo."}`;
  }

  if (query.includes("assinatura")) {
    const active = subscriptions.filter(item => item.active !== false);
    const total = active.reduce((sum, item) => sum + number(item.value), 0);
    return `Você possui ${active.length} ${active.length === 1 ? "assinatura ativa" : "assinaturas ativas"}, somando ${value(total)} por mês.`;
  }

  if (query.includes("orcamento") || query.includes("orçamento")) {
    if (!budgets.length) return "Você ainda não possui orçamentos cadastrados para eu analisar.";
    return `Encontrei ${budgets.length} ${budgets.length === 1 ? "orçamento cadastrado" : "orçamentos cadastrados"}. Posso ajudar melhor se você perguntar por uma categoria específica ou pelo quanto ainda está disponível.`;
  }

  const ratio = income > 0 ? Math.round(expense / income * 100) : expense > 0 ? 100 : 0;
  const categorySentence = top ? ` A maior categoria é ${top[0]}, com ${value(top[1])}.` : "";
  if (income === 0 && expense > 0) return `Encontrei despesas de ${value(expense)}, mas nenhuma receita cadastrada no conjunto analisado.${categorySentence}`;
  if (expense === 0 && income > 0) return `Encontrei receitas de ${value(income)} e nenhuma despesa cadastrada no conjunto analisado.`;
  return `No conjunto analisado, suas receitas somam ${value(income)}, as despesas somam ${value(expense)} e o resultado é ${value(result)}. As despesas correspondem a ${ratio}% das receitas.${categorySentence}`;
}
