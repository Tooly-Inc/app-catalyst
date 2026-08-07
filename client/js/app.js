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
    statLabel: document.getElementById("statLabel"),
    loading: document.getElementById("loadingState"),
    empty: document.getElementById("emptyState"),
    error: document.getElementById("errorState"),
    errorMsg: document.getElementById("errorMsg"),
    btnLeads: document.getElementById("btnLeads"),
    btnContacts: document.getElementById("btnContacts"),
    colStatut: document.getElementById("colStatut"),
    colSociete: document.getElementById("colSociete"),
  };

  let allRecords = []; // dernier jeu de résultats reçu du serveur
  let currentStatuses = new Set();
  let currentView = "leads"; // "leads" ou "contacts"

  // Configuration par vue : endpoints, libellés de colonnes et placeholder
  const VIEWS = {
    leads: {
      list: "/leads?per_page=200",
      search: "/leads/search",
      statLabel: "Leads affichés",
      colSociete: "Société",
      colStatut: "Statut",
      placeholder: "Rechercher un lead (nom, société, email, téléphone…)",
      showStatusFilter: true,
    },
    contacts: {
      list: "/contacts",
      search: "/contacts/search",
      statLabel: "Contacts affichés",
      colSociete: "Société",
      colStatut: "Poste",
      placeholder: "Rechercher un contact (nom, société, email…)",
      showStatusFilter: false,
    },
  };

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
  function render(records) {
    const cfg = VIEWS[currentView];
    const statusFilter = cfg.showStatusFilter ? els.status.value : "";
    const filtered = statusFilter
      ? records.filter((l) => l.status === statusFilter)
      : records;

    els.total.textContent = filtered.length;

    if (!filtered.length) {
      els.body.innerHTML = "";
      showState("empty");
      return;
    }

    const statutLabel = cfg.colStatut;
    const societeLabel = cfg.colSociete;

    els.body.innerHTML = filtered
      .map(
        (l) => `
  <tr class="lead-row" data-url="${escapeHtml(l.crmUrl)}" title="Ouvrir la fiche dans le CRM">
    <td data-label="Nom" class="lead-name">${escapeHtml(l.name) || '<span class="muted">—</span>'}</td>
    <td data-label="${escapeHtml(societeLabel)}" class="lead-company">${escapeHtml(l.company) || '<span class="muted">—</span>'}</td>
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
    <td data-label="${escapeHtml(statutLabel)}">${
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
  function refreshStatusOptions(records) {
    const cfg = VIEWS[currentView];
    if (!cfg.showStatusFilter) {
      // La vue Contacts n'utilise pas le filtre : on le masque et on le vide
      els.status.hidden = true;
      els.status.innerHTML = '<option value="">Tous les statuts</option>';
      return;
    }
    els.status.hidden = false;
    records.forEach((l) => l.status && currentStatuses.add(l.status));
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

  // Charge la liste selon la vue courante
  async function loadRecords() {
    const cfg = VIEWS[currentView];
    showState("loading");
    try {
      const data = await apiGet(cfg.list);
      allRecords = data.leads || [];
      refreshStatusOptions(allRecords);
      render(allRecords);
    } catch (err) {
      els.errorMsg.textContent = err.message;
      showState("error");
    }
  }

  // Recherche selon la vue courante
  async function searchRecords(term) {
    const cfg = VIEWS[currentView];
    showState("loading");
    try {
      const data = await apiGet(cfg.search + "?q=" + encodeURIComponent(term));
      allRecords = data.leads || [];
      refreshStatusOptions(allRecords);
      render(allRecords);
    } catch (err) {
      els.errorMsg.textContent = err.message;
      showState("error");
    }
  }

  // --- Bascule de vue ---
  function switchView(view) {
    if (view === currentView) return;
    currentView = view;
    const cfg = VIEWS[view];

    // Onglets actifs
    els.btnLeads.classList.toggle("active", view === "leads");
    els.btnContacts.classList.toggle("active", view === "contacts");
    els.btnLeads.setAttribute("aria-selected", view === "leads");
    els.btnContacts.setAttribute("aria-selected", view === "contacts");

    // Libellés dynamiques
    if (els.statLabel) els.statLabel.textContent = cfg.statLabel;
    if (els.colStatut) els.colStatut.textContent = cfg.colStatut;
    if (els.colSociete) els.colSociete.textContent = cfg.colSociete;
    els.search.placeholder = cfg.placeholder;

    // Réinitialisation
    els.search.value = "";
    els.clear.hidden = true;
    currentStatuses = new Set();
    els.status.value = "";

    loadRecords();
  }

  // --- Recherche avec debounce ---
  let searchTimer = null;
  function onSearchInput() {
    const term = els.search.value.trim();
    els.clear.hidden = !term;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (term.length === 0) {
        loadRecords();
      } else if (term.length >= 2) {
        searchRecords(term);
      }
    }, 350);
  }

  // --- Événements ---
  els.search.addEventListener("input", onSearchInput);
  els.clear.addEventListener("click", () => {
    els.search.value = "";
    els.clear.hidden = true;
    loadRecords();
  });
  els.status.addEventListener("change", () => render(allRecords));
  els.refresh.addEventListener("click", () => {
    els.search.value = "";
    els.clear.hidden = true;
    loadRecords();
  });
  if (els.btnLeads)
    els.btnLeads.addEventListener("click", () => switchView("leads"));
  if (els.btnContacts)
    els.btnContacts.addEventListener("click", () => switchView("contacts"));

  // --- Démarrage ---
  if (!BASE || BASE.includes("REMPLACER")) {
    els.errorMsg.textContent =
      "Configure FUNCTION_BASE_URL dans js/config.js avec l'URL de ta fonction Catalyst.";
    showState("error");
  } else {
    loadRecords();
  }
})();
