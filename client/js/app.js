(function () {
  "use strict";

  const BASE = (window.APP_CONFIG && window.APP_CONFIG.FUNCTION_BASE_URL) || "";

  // --- Éléments DOM ---
  const els = {
    body: document.getElementById("leadsBody"),
    search: document.getElementById("searchInput"),
    clear: document.getElementById("clearBtn"),
    status: document.getElementById("statusFilter"),
    refresh: document.getElementById("refreshBtn"),
    total: document.getElementById("statTotal"),
    loading: document.getElementById("loadingState"),
    empty: document.getElementById("emptyState"),
    error: document.getElementById("errorState"),
    errorMsg: document.getElementById("errorMsg"),
  };

  let allLeads = []; // dernier jeu de résultats reçu du serveur
  let currentStatuses = new Set();

  // --- Helpers d'affichage d'état ---
  function showState(name) {
    els.loading.hidden = name !== "loading";
    els.empty.hidden = name !== "empty";
    els.error.hidden = name !== "error";
    document.querySelector(".table-wrap").hidden = name !== "table";
  }

  function escapeHtml(s) {
    return String(s || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  // --- Rendu du tableau ---
  function render(leads) {
    const statusFilter = els.status.value;
    const filtered = statusFilter
      ? leads.filter((l) => l.status === statusFilter)
      : leads;

    els.total.textContent = filtered.length;

    if (!filtered.length) {
      els.body.innerHTML = "";
      showState("empty");
      return;
    }

    els.body.innerHTML = filtered
      .map(
        (l) => `
  <tr class="lead-row" data-url="${escapeHtml(l.crmUrl)}" title="Ouvrir la fiche dans le CRM">
    <td data-label="Nom" class="lead-name">${escapeHtml(l.name) || '<span class="muted">—</span>'}</td>
    <td data-label="Société" class="lead-company">${escapeHtml(l.company) || '<span class="muted">—</span>'}</td>
    <td data-label="Email" class="lead-email">${
      l.email
        ? `<a href="mailto:${escapeHtml(l.email)}">${escapeHtml(l.email)}</a>`
        : '<span class="muted">—</span>'
    }</td>
    <td data-label="Téléphone" class="lead-phone">${
      l.phone
        ? `<a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a>`
        : '<span class="muted">—</span>'
    }</td>
    <td data-label="Statut">${
      l.status
        ? `<span class="badge">${escapeHtml(l.status)}</span>`
        : '<span class="muted">—</span>'
    }</td>
  </tr>
`,
      )
      .join("");

    // Ouverture de la fiche au clic (hors clic sur un lien email/tél)
    els.body.querySelectorAll(".lead-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("a")) return; // laisse les liens mailto/tel fonctionner
        const url = row.getAttribute("data-url");
        if (url) window.open(url, "_blank", "noopener");
      });
    });

    showState("table");
  }

  // --- Alimente le filtre statut à partir des données ---
  function refreshStatusOptions(leads) {
    leads.forEach((l) => l.status && currentStatuses.add(l.status));
    const selected = els.status.value;
    els.status.innerHTML =
      '<option value="">Tous les statuts</option>' +
      [...currentStatuses]
        .sort()
        .map(
          (s) =>
            `<option value="${escapeHtml(s)}"${s === selected ? " selected" : ""}>${escapeHtml(s)}</option>`,
        )
        .join("");
  }

  // --- Appels réseau ---
  async function apiGet(path) {
    const res = await fetch(BASE + path, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} — ${txt || res.statusText}`);
    }
    return res.json();
  }

  async function loadLeads() {
    showState("loading");
    try {
      const data = await apiGet("/leads?per_page=200");
      allLeads = data.leads || [];
      refreshStatusOptions(allLeads);
      render(allLeads);
    } catch (err) {
      els.errorMsg.textContent = err.message;
      showState("error");
    }
  }

  async function searchLeads(term) {
    showState("loading");
    try {
      const data = await apiGet("/leads/search?q=" + encodeURIComponent(term));
      allLeads = data.leads || [];
      refreshStatusOptions(allLeads);
      render(allLeads);
    } catch (err) {
      els.errorMsg.textContent = err.message;
      showState("error");
    }
  }

  // --- Recherche avec debounce ---
  let searchTimer = null;
  function onSearchInput() {
    const term = els.search.value.trim();
    els.clear.hidden = !term;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (term.length === 0) {
        loadLeads();
      } else if (term.length >= 2) {
        searchLeads(term);
      }
    }, 350);
  }

  // --- Événements ---
  els.search.addEventListener("input", onSearchInput);
  els.clear.addEventListener("click", () => {
    els.search.value = "";
    els.clear.hidden = true;
    loadLeads();
  });
  els.status.addEventListener("change", () => render(allLeads));
  els.refresh.addEventListener("click", () => {
    els.search.value = "";
    els.clear.hidden = true;
    loadLeads();
  });

  // --- Démarrage ---
  if (!BASE || BASE.includes("REMPLACER")) {
    els.errorMsg.textContent =
      "Configure FUNCTION_BASE_URL dans js/config.js avec l'URL de ta fonction Catalyst.";
    showState("error");
  } else {
    loadLeads();
  }
})();
