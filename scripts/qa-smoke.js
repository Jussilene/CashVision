const path = require("path");
const { spawn } = require("child_process");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const BASE = "http://127.0.0.1:3105";

class SessionClient {
  constructor() {
    this.cookie = "";
  }

  async request(method, url, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${method} ${url} => ${res.status} ${JSON.stringify(data)}`);
    }
    return data;
  }

  get(url) {
    return this.request("GET", url);
  }
  post(url, body) {
    return this.request("POST", url, body);
  }
  put(url, body) {
    return this.request("PUT", url, body);
  }
  delete(url) {
    return this.request("DELETE", url);
  }
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function waitForHealth(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Servidor nao respondeu em /health");
}

async function run() {
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    stdio: "ignore"
  });

  try {
    await waitForHealth();
    const api = new SessionClient();

    const login = await api.post("/api/auth/login", {
      email: "admin@cashvision.local",
      password: "123456"
    });
    assert(login?.user?.id, "login sem user.id");
    const empresaId = Number(login.empresa_id);
    assert(empresaId > 0, "empresa_id invalido");
    log("AUTH ok");

    const accounts = await api.get(`/api/cashvision/accounts?empresa_id=${empresaId}`);
    const categories = await api.get(`/api/cashvision/categories?empresa_id=${empresaId}`);
    assert(accounts.length > 0, "sem contas");
    assert(categories.length > 0, "sem categorias");
    log("CASHVISION listas ok");

    const newAccount = await api.post(`/api/cashvision/accounts?empresa_id=${empresaId}`, {
      nome: `Conta QA ${Date.now()}`,
      tipo: "OUTROS",
      saldo_inicial: 111.22
    });
    const updatedAccount = await api.put(`/api/cashvision/accounts/${newAccount.id}?empresa_id=${empresaId}`, {
      nome: `${newAccount.nome} - edit`
    });
    assert(updatedAccount.nome.includes("edit"), "update account falhou");
    await api.delete(`/api/cashvision/accounts/${newAccount.id}?empresa_id=${empresaId}`);
    log("CASHVISION accounts CRUD ok");

    const newCategory = await api.post(`/api/cashvision/categories?empresa_id=${empresaId}`, {
      nome: `Categoria QA ${Date.now()}`,
      tipo: "MISTA",
      ordem: 99
    });
    const updatedCategory = await api.put(`/api/cashvision/categories/${newCategory.id}?empresa_id=${empresaId}`, {
      nome: `${newCategory.nome} - edit`
    });
    assert(updatedCategory.nome.includes("edit"), "update category falhou");
    await api.delete(`/api/cashvision/categories/${newCategory.id}?empresa_id=${empresaId}`);
    log("CASHVISION categories CRUD ok");

    const tx = await api.post(`/api/cashvision/transactions?empresa_id=${empresaId}`, {
      account_id: accounts[0].id,
      category_id: categories[0].id,
      tipo: "DESPESA",
      status: "PREVISTO",
      data_competencia: new Date().toISOString().slice(0, 10),
      valor: 321.45,
      descricao: "Lancamento QA"
    });
    const txUpdated = await api.put(`/api/cashvision/transactions/${tx.id}?empresa_id=${empresaId}`, {
      status: "REALIZADO",
      data_caixa: new Date().toISOString().slice(0, 10)
    });
    assert(txUpdated.status === "REALIZADO", "update transaction falhou");
    await api.get(`/api/cashvision/transactions?empresa_id=${empresaId}&status=REALIZADO`);
    await api.delete(`/api/cashvision/transactions/${tx.id}?empresa_id=${empresaId}`);
    log("CASHVISION transactions CRUD/filtros ok");

    const transfer = await api.post(`/api/cashvision/transfers?empresa_id=${empresaId}`, {
      from_account_id: accounts[0].id,
      to_account_id: accounts[1].id,
      data: new Date().toISOString().slice(0, 10),
      valor: 77.5,
      descricao: "Transfer QA smoke"
    });
    assert(transfer.id, "transfer sem id");
    await api.get(`/api/cashvision/transfers?empresa_id=${empresaId}`);
    await api.get(`/api/cashvision/cashflow?empresa_id=${empresaId}&modo=caixa&status=todos`);
    log("CASHVISION transfers/cashflow ok");

    const customer = await api.post(`/api/cashvision-billing/customers?empresa_id=${empresaId}`, {
      nome: `Cliente QA ${Date.now()}`,
      email: "qa@cashvision.local"
    });
    const customerUpd = await api.put(`/api/cashvision-billing/customers/${customer.id}?empresa_id=${empresaId}`, {
      telefone: "(11) 90000-0000"
    });
    assert(customerUpd.telefone, "update customer falhou");
    log("BILLING customers CRUD parcial ok");

    const invoice = await api.post(`/api/cashvision-billing/invoices?empresa_id=${empresaId}`, {
      customer_id: customer.id,
      data_emissao: new Date().toISOString().slice(0, 10),
      data_vencimento: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      valor_total: 980.9,
      observacoes: "Fatura QA",
      itens: [{ descricao: "Servico QA", qtd: 1, valor_unit: 980.9 }]
    });
    const items = await api.get(`/api/cashvision-billing/invoices/${invoice.id}/items?empresa_id=${empresaId}`);
    assert(items.length === 1, "itens de fatura inconsistentes");
    await api.put(`/api/cashvision-billing/invoices/${invoice.id}?empresa_id=${empresaId}`, {
      observacoes: "Fatura QA editada"
    });
    const paid = await api.post(`/api/cashvision-billing/invoices/${invoice.id}/mark-paid?empresa_id=${empresaId}`, {
      account_id: accounts[0].id,
      category_id: categories[0].id
    });
    assert(paid.ok, "mark-paid falhou");
    const paidAgain = await api.post(`/api/cashvision-billing/invoices/${invoice.id}/mark-paid?empresa_id=${empresaId}`, {});
    assert(paidAgain.already_paid || paidAgain.ok, "segunda marcacao deveria ser idempotente");
    await api.delete(`/api/cashvision-billing/invoices/${invoice.id}?empresa_id=${empresaId}`);
    await api.delete(`/api/cashvision-billing/customers/${customer.id}?empresa_id=${empresaId}`);
    log("BILLING invoices/customers ok");

    const notes = await api.get(`/api/cashvision-integracoes/fluxonf/notas?empresa_id=${empresaId}`);
    assert(notes.length > 0, "sem notas de integracao");
    const noteIds = notes.slice(0, 2).map((n) => n.id);
    const imp1 = await api.post(`/api/cashvision-integracoes/fluxonf/gerar-lancamentos?empresa_id=${empresaId}`, {
      nota_ids: noteIds,
      account_id: accounts[0].id,
      category_id: categories[0].id,
      status: "REALIZADO"
    });
    const imp2 = await api.post(`/api/cashvision-integracoes/fluxonf/gerar-lancamentos?empresa_id=${empresaId}`, {
      nota_ids: noteIds,
      account_id: accounts[0].id,
      category_id: categories[0].id,
      status: "REALIZADO"
    });
    assert(imp1.created.length >= 0, "import retorno invalido");
    assert(imp2.skipped.length >= 0, "reimport retorno invalido");
    log("INTEGRACAO ok");

    await api.post("/api/auth/logout", {});
    log("AUTH logout ok");
    log("SMOKE TEST PASS");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`SMOKE TEST FAIL: ${err.message}`);
  process.exit(1);
});
