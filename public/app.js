const state = {
  me: null,
  route: "overview"
};

function money(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erro ${res.status}`);
  }
  return res.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  for (const c of children) node.append(c);
  return node;
}

function empresaId() {
  return Number(document.getElementById("empresa-select").value || state.me?.empresa_id || 0);
}

async function init() {
  bindGlobalEvents();
  try {
    const me = await api("/api/auth/me");
    state.me = me;
    showApp();
    await afterLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("app-view").classList.add("hidden");
}

function showApp() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");
}

function bindGlobalEvents() {
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd.entries());
    try {
      state.me = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(data)
      });
      showApp();
      await afterLogin();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    showLogin();
  });

  document.getElementById("empresa-select").addEventListener("change", async (e) => {
    await api("/api/auth/select-company", {
      method: "POST",
      body: JSON.stringify({ empresa_id: Number(e.target.value) })
    });
    await navigate(state.route);
  });

  document.querySelectorAll("#menu button").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.route));
  });
}

async function afterLogin() {
  const me = await api("/api/auth/me");
  state.me = me;
  const select = document.getElementById("empresa-select");
  select.innerHTML = "";
  for (const c of me.companies) {
    const opt = el("option", { value: c.id }, [document.createTextNode(c.nome)]);
    if (Number(me.empresa_id) === c.id) opt.selected = true;
    select.append(opt);
  }
  document.getElementById("user-meta").textContent = `${me.user.nome} (${me.user.email})`;
  await navigate("overview");
}

async function navigate(route) {
  state.route = route;
  document.querySelectorAll("#menu button").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  const titles = {
    overview: "Visão Geral",
    transactions: "Lançamentos",
    accounts: "Contas",
    categories: "Categorias",
    customers: "Clientes",
    invoices: "Faturas (Contas a Receber)",
    imports: "Importar do FluxoNF"
  };
  document.getElementById("page-title").textContent = titles[route] || "CashVision";
  if (route === "overview") return renderOverview();
  if (route === "transactions") return renderTransactions();
  if (route === "accounts") return renderAccounts();
  if (route === "categories") return renderCategories();
  if (route === "customers") return renderCustomers();
  if (route === "invoices") return renderInvoices();
  if (route === "imports") return renderImports();
}

async function renderOverview() {
  const container = document.getElementById("view-container");
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const data = await api(
    `/api/cashvision/cashflow?empresa_id=${empresaId()}&inicio=${start}&fim=${end}&modo=caixa&status=todos`
  );

  container.innerHTML = `
    <div class="cards">
      <div class="card"><h3>Saldo Atual</h3><p>${money(data.saldo_atual)}</p></div>
      <div class="card"><h3>Entradas no Mês</h3><p>${money(data.entradas_mes)}</p></div>
      <div class="card"><h3>Saídas no Mês</h3><p>${money(data.saidas_mes)}</p></div>
      <div class="card"><h3>Resultado do Mês</h3><p>${money(data.resultado_mes)}</p></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Data</th><th>Tipo</th><th>Status</th><th>Conta</th><th>Descrição</th><th>Valor</th><th>Documento</th></tr>
        </thead>
        <tbody>
          ${
            data.extrato
              .map(
                (r) => `
            <tr>
              <td>${r.data_caixa || r.data_competencia || "-"}</td>
              <td>${r.tipo}</td>
              <td><span class="status ${r.status}">${r.status}</span></td>
              <td>${r.conta_nome || "-"}</td>
              <td>${r.descricao || "-"}</td>
              <td>${money(r.valor)}</td>
              <td>${r.documento_ref ? `<a href="${r.documento_ref}" target="_blank">Ver documento</a>` : "-"}</td>
            </tr>`
              )
              .join("")
          }
        </tbody>
      </table>
    </div>`;
}

async function renderAccounts() {
  const container = document.getElementById("view-container");
  const rows = await api(`/api/cashvision/accounts?empresa_id=${empresaId()}`);
  container.innerHTML = `
    <form id="form-account" class="grid-form">
      <input name="nome" placeholder="Nome da conta" required />
      <select name="tipo"><option>BANCO</option><option>CAIXA</option><option>OUTROS</option></select>
      <input name="saldo_inicial" type="number" step="0.01" placeholder="Saldo inicial" />
      <button type="submit">Adicionar conta</button>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Nome</th><th>Tipo</th><th>Saldo Inicial</th><th>Ativo</th><th>Ações</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${r.id}</td><td>${r.nome}</td><td>${r.tipo}</td><td>${money(r.saldo_inicial)}</td>
                <td>${r.ativo ? "Sim" : "Não"}</td>
                <td><button data-id="${r.id}" class="btn-disable">Desativar</button></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  document.getElementById("form-account").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    await api(`/api/cashvision/accounts?empresa_id=${empresaId()}`, {
      method: "POST",
      body: JSON.stringify(data)
    });
    renderAccounts();
  });
  container.querySelectorAll(".btn-disable").forEach((b) => {
    b.addEventListener("click", async () => {
      await api(`/api/cashvision/accounts/${b.dataset.id}?empresa_id=${empresaId()}`, { method: "DELETE" });
      renderAccounts();
    });
  });
}

async function renderCategories() {
  const container = document.getElementById("view-container");
  const rows = await api(`/api/cashvision/categories?empresa_id=${empresaId()}`);
  container.innerHTML = `
    <form id="form-category" class="grid-form">
      <input name="nome" placeholder="Nome da categoria" required />
      <select name="tipo"><option>RECEITA</option><option>DESPESA</option><option>MISTA</option></select>
      <input name="ordem" type="number" placeholder="Ordem" />
      <button type="submit">Adicionar categoria</button>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Nome</th><th>Tipo</th><th>Ordem</th><th>Ativo</th><th>Ações</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${r.id}</td><td>${r.nome}</td><td>${r.tipo}</td><td>${r.ordem}</td><td>${r.ativo ? "Sim" : "Não"}</td>
                <td><button data-id="${r.id}" class="btn-disable">Desativar</button></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  document.getElementById("form-category").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    await api(`/api/cashvision/categories?empresa_id=${empresaId()}`, {
      method: "POST",
      body: JSON.stringify(data)
    });
    renderCategories();
  });
  container.querySelectorAll(".btn-disable").forEach((b) => {
    b.addEventListener("click", async () => {
      await api(`/api/cashvision/categories/${b.dataset.id}?empresa_id=${empresaId()}`, { method: "DELETE" });
      renderCategories();
    });
  });
}

async function renderTransactions() {
  const container = document.getElementById("view-container");
  const [rows, accounts, categories] = await Promise.all([
    api(`/api/cashvision/transactions?empresa_id=${empresaId()}`),
    api(`/api/cashvision/accounts?empresa_id=${empresaId()}`),
    api(`/api/cashvision/categories?empresa_id=${empresaId()}`)
  ]);

  const asDate = (row, mode) => (mode === "competencia" ? row.data_competencia : (row.data_caixa || row.data_competencia));
  const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });
  const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const summary = {};

  rows.forEach((r) => {
    const key = (r.data_caixa || r.data_competencia || "").slice(0, 7);
    if (!key) return;
    if (!summary[key]) summary[key] = { receitas: 0, despesas: 0 };
    if (r.tipo === "RECEITA") summary[key].receitas += Number(r.valor || 0);
    if (r.tipo === "DESPESA") summary[key].despesas += Number(r.valor || 0);
  });

  const summaryCols = Object.keys(summary).sort();

  container.innerHTML = `
    <div class="tx-month-board">
      <table class="tx-month-table">
        <thead>
          <tr>
            <th>Resumo</th>
            ${summaryCols.map((m) => `<th>${monthFmt.format(new Date(`${m}-01T00:00:00`))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          <tr class="row-income">
            <td>Receitas</td>
            ${summaryCols.map((m) => `<td>${money(summary[m].receitas)}</td>`).join("")}
          </tr>
          <tr class="row-expense">
            <td>Despesas</td>
            ${summaryCols.map((m) => `<td>${money(summary[m].despesas)}</td>`).join("")}
          </tr>
          <tr class="row-balance">
            <td>Saldo</td>
            ${summaryCols.map((m) => `<td>${money(summary[m].receitas - summary[m].despesas)}</td>`).join("")}
          </tr>
        </tbody>
      </table>
    </div>

    <div class="tx-actions">
      <button id="btn-new-expense" class="btn-expense">Registrar gasto</button>
      <button id="btn-new-income" class="btn-income">Registrar ganho</button>
      <button id="btn-transfer" class="btn-transfer">Registrar transferencia</button>
      <button id="btn-refresh" class="btn-muted">Atualizar</button>
    </div>

    <form id="form-tx" class="tx-form">
      <select name="tipo"><option>RECEITA</option><option>DESPESA</option><option>TRANSFERENCIA</option></select>
      <select name="status"><option>REALIZADO</option><option>PREVISTO</option></select>
      <input name="data_competencia" type="date" required />
      <input name="data_caixa" type="date" />
      <input name="valor" type="number" step="0.01" placeholder="Valor" required />
      <select name="account_id"><option value="">Conta</option>${accounts.map((a) => `<option value="${a.id}">${a.nome}</option>`).join("")}</select>
      <select name="category_id"><option value="">Categoria</option>${categories.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("")}</select>
      <input name="descricao" placeholder="Descricao" />
      <input name="documento_ref" placeholder="Referencia do documento" />
      <button type="submit">Salvar</button>
    </form>

    <div class="tx-filter-line">
      <button class="mini-mode active" data-mode="caixa" type="button">Caixa</button>
      <button class="mini-mode" data-mode="competencia" type="button">Competencia</button>
      <input id="tx-month" type="month" value="${currentMonth}" />
      <select id="tx-filter-account"><option value="">Todas as contas</option>${accounts.map((a) => `<option value="${a.id}">${a.nome}</option>`).join("")}</select>
      <select id="tx-filter-category"><option value="">Todas as categorias</option>${categories.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("")}</select>
      <select id="tx-filter-type"><option value="">Todos os tipos</option><option>RECEITA</option><option>DESPESA</option><option>TRANSFERENCIA</option></select>
      <select id="tx-filter-status"><option value="">Todos os status</option><option>REALIZADO</option><option>PREVISTO</option></select>
      <input id="tx-search" placeholder="Buscar descricao..." />
    </div>

    <div class="table-wrap tx-grid-wrap">
      <table class="tx-grid">
        <thead>
          <tr>
            <th><input type="checkbox" disabled /></th>
            <th>Data</th>
            <th>Categoria</th>
            <th>Descricao</th>
            <th>Conta</th>
            <th>Status</th>
            <th>Valor</th>
            <th>Saldo</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="tx-rows"></tbody>
      </table>
    </div>`;

  const form = document.getElementById("form-tx");
  const txRows = document.getElementById("tx-rows");
  const monthInput = document.getElementById("tx-month");
  const accountFilter = document.getElementById("tx-filter-account");
  const categoryFilter = document.getElementById("tx-filter-category");
  const typeFilter = document.getElementById("tx-filter-type");
  const statusFilter = document.getElementById("tx-filter-status");
  const searchFilter = document.getElementById("tx-search");
  let mode = "caixa";

  const catClass = (r) => {
    if (r.tipo === "RECEITA") return "cat-income";
    if (r.tipo === "DESPESA") return "cat-expense";
    return "cat-neutral";
  };

  const statusLabel = (r) => {
    if (r.status === "PREVISTO" && r.tipo === "RECEITA") return "A receber";
    if (r.status === "PREVISTO" && r.tipo === "DESPESA") return "A pagar";
    if (r.tipo === "RECEITA") return "Recebido";
    if (r.tipo === "DESPESA") return "Pago";
    return r.status;
  };

  function renderGrid() {
    const month = monthInput.value;
    const filtered = rows
      .filter((r) => {
        const d = asDate(r, mode) || "";
        if (month && d.slice(0, 7) !== month) return false;
        if (accountFilter.value && String(r.account_id) !== accountFilter.value) return false;
        if (categoryFilter.value && String(r.category_id) !== categoryFilter.value) return false;
        if (typeFilter.value && r.tipo !== typeFilter.value) return false;
        if (statusFilter.value && r.status !== statusFilter.value) return false;
        if (searchFilter.value && !(r.descricao || "").toLowerCase().includes(searchFilter.value.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => (asDate(a, mode) > asDate(b, mode) ? 1 : -1));

    let running = 0;
    const runningMap = {};
    filtered.forEach((r) => {
      const sign = r.tipo === "RECEITA" ? 1 : r.tipo === "DESPESA" ? -1 : 0;
      running += sign * Number(r.valor || 0);
      runningMap[r.id] = running;
    });

    filtered.reverse();
    txRows.innerHTML = filtered
      .map((r) => `
        <tr>
          <td><input type="checkbox" /></td>
          <td>${dayFmt.format(new Date(`${asDate(r, mode)}T00:00:00`))}</td>
          <td><span class="cat-chip ${catClass(r)}">${r.categoria_nome || r.tipo}</span></td>
          <td>${r.descricao || "-"}</td>
          <td>${r.conta_nome || "-"}</td>
          <td><span class="status ${r.status}">${statusLabel(r)}</span></td>
          <td class="${r.tipo === "RECEITA" ? "val-pos" : r.tipo === "DESPESA" ? "val-neg" : ""}">${money(r.valor)}</td>
          <td>${money(runningMap[r.id])}</td>
          <td><button data-id="${r.id}" class="btn-delete btn-row-delete">Excluir</button></td>
        </tr>
      `)
      .join("");

    container.querySelectorAll(".btn-row-delete").forEach((b) => {
      b.addEventListener("click", async () => {
        await api(`/api/cashvision/transactions/${b.dataset.id}?empresa_id=${empresaId()}`, { method: "DELETE" });
        renderTransactions();
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    await api(`/api/cashvision/transactions?empresa_id=${empresaId()}`, {
      method: "POST",
      body: JSON.stringify(data)
    });
    renderTransactions();
  });

  document.getElementById("btn-new-expense").addEventListener("click", () => {
    form.tipo.value = "DESPESA";
    form.status.value = "REALIZADO";
  });

  document.getElementById("btn-new-income").addEventListener("click", () => {
    form.tipo.value = "RECEITA";
    form.status.value = "REALIZADO";
  });

  document.querySelectorAll(".mini-mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mini-mode").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      mode = btn.dataset.mode;
      renderGrid();
    });
  });

  document.getElementById("btn-refresh").addEventListener("click", renderTransactions);

  [monthInput, accountFilter, categoryFilter, typeFilter, statusFilter, searchFilter].forEach((elx) => {
    elx.addEventListener("input", renderGrid);
    elx.addEventListener("change", renderGrid);
  });

  document.getElementById("btn-transfer").addEventListener("click", async () => {
    const from_account_id = prompt("ID conta origem:");
    const to_account_id = prompt("ID conta destino:");
    const valor = prompt("Valor:");
    const data = prompt("Data (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!from_account_id || !to_account_id || !valor || !data) return;
    await api(`/api/cashvision/transfers?empresa_id=${empresaId()}`, {
      method: "POST",
      body: JSON.stringify({ from_account_id, to_account_id, valor, data, descricao: "Transferencia manual" })
    });
    renderTransactions();
  });

  renderGrid();
}

async function renderCustomers() {
  const container = document.getElementById("view-container");
  const rows = await api(`/api/cashvision-billing/customers?empresa_id=${empresaId()}`);
  container.innerHTML = `
    <form id="form-customer" class="grid-form">
      <input name="nome" placeholder="Nome do cliente" required />
      <input name="documento" placeholder="CPF/CNPJ" />
      <input name="email" placeholder="E-mail" />
      <input name="telefone" placeholder="Telefone" />
      <input class="full" name="endereco" placeholder="Endereço" />
      <button type="submit">Adicionar cliente</button>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Nome</th><th>Documento</th><th>Email</th><th>Telefone</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${r.id}</td><td>${r.nome}</td><td>${r.documento || "-"}</td><td>${r.email || "-"}</td><td>${r.telefone || "-"}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  document.getElementById("form-customer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    await api(`/api/cashvision-billing/customers?empresa_id=${empresaId()}`, {
      method: "POST",
      body: JSON.stringify(data)
    });
    renderCustomers();
  });
}

async function renderInvoices() {
  const container = document.getElementById("view-container");
  const [rows, customers, accounts, categories] = await Promise.all([
    api(`/api/cashvision-billing/invoices?empresa_id=${empresaId()}`),
    api(`/api/cashvision-billing/customers?empresa_id=${empresaId()}`),
    api(`/api/cashvision/accounts?empresa_id=${empresaId()}`),
    api(`/api/cashvision/categories?empresa_id=${empresaId()}`)
  ]);

  container.innerHTML = `
    <form id="form-invoice" class="grid-form">
      <select name="customer_id" required><option value="">Cliente</option>${customers.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("")}</select>
      <input name="data_emissao" type="date" required />
      <input name="data_vencimento" type="date" required />
      <input name="valor_total" type="number" step="0.01" placeholder="Valor total" required />
      <input class="full" name="observacoes" placeholder="Observações" />
      <button type="submit">Criar fatura</button>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nº</th><th>Cliente</th><th>Emissão</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
              <td>${r.numero}</td><td>${r.customer_nome}</td><td>${r.data_emissao}</td><td>${r.data_vencimento}</td>
              <td>${money(r.valor_total)}</td><td><span class="status ${r.status}">${r.status}</span></td>
              <td>${r.status === "PAGO" ? "-" : `<button data-id="${r.id}" class="btn-pay">Marcar Pago</button>`}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  document.getElementById("form-invoice").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    await api(`/api/cashvision-billing/invoices?empresa_id=${empresaId()}`, {
      method: "POST",
      body: JSON.stringify(data)
    });
    renderInvoices();
  });

  container.querySelectorAll(".btn-pay").forEach((b) => {
    b.addEventListener("click", async () => {
      const account_id = prompt(`ID da conta para receber:\n${accounts.map((a) => `${a.id} - ${a.nome}`).join("\n")}`);
      const category_id = prompt(`ID da categoria:\n${categories.map((c) => `${c.id} - ${c.nome}`).join("\n")}`);
      await api(`/api/cashvision-billing/invoices/${b.dataset.id}/mark-paid?empresa_id=${empresaId()}`, {
        method: "POST",
        body: JSON.stringify({ account_id, category_id })
      });
      renderInvoices();
    });
  });
}

async function renderImports() {
  const container = document.getElementById("view-container");
  const [notas, accounts, categories] = await Promise.all([
    api(`/api/cashvision-integracoes/fluxonf/notas?empresa_id=${empresaId()}`),
    api(`/api/cashvision/accounts?empresa_id=${empresaId()}`),
    api(`/api/cashvision/categories?empresa_id=${empresaId()}`)
  ]);
  container.innerHTML = `
    <p class="muted">Selecione as notas e clique em "Gerar lançamentos".</p>
    <div class="toolbar">
      <select id="import-account"><option value="">Conta (opcional)</option>${accounts.map((a) => `<option value="${a.id}">${a.nome}</option>`).join("")}</select>
      <select id="import-category"><option value="">Categoria (opcional)</option>${categories.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("")}</select>
      <button id="btn-import">Gerar lançamentos</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th></th><th>Nota</th><th>Tipo</th><th>Emissão</th><th>Valor</th><th>Documento</th></tr></thead>
        <tbody>
          ${notas
            .map(
              (n) => `<tr>
                <td><input type="checkbox" class="ck-note" value="${n.id}" /></td>
                <td>${n.numero}</td>
                <td>${n.tipo}</td>
                <td>${n.data_emissao}</td>
                <td>${money(n.valor)}</td>
                <td>${n.documento_ref ? `<a href="${n.documento_ref}" target="_blank">Ver documento</a>` : "-"}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  document.getElementById("btn-import").addEventListener("click", async () => {
    const nota_ids = Array.from(document.querySelectorAll(".ck-note:checked")).map((c) => Number(c.value));
    if (!nota_ids.length) return alert("Selecione ao menos uma nota.");
    const account_id = document.getElementById("import-account").value || null;
    const category_id = document.getElementById("import-category").value || null;
    const result = await api(`/api/cashvision-integracoes/fluxonf/gerar-lancamentos?empresa_id=${empresaId()}`, {
      method: "POST",
      body: JSON.stringify({ nota_ids, account_id, category_id, status: "REALIZADO" })
    });
    alert(`Importação concluída. Criados: ${result.created.length}. Ignorados: ${result.skipped.length}.`);
    renderImports();
  });
}

init();
