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
    modalOverlay: document.getElementById("modalOverlay"),
    modalPanel: document.getElementById("modalPanel"),
    modalViews: document.getElementById("modalViews"),
    modalAvatar: document.getElementById("modalAvatar"),
    modalTitle: document.getElementById("modalTitle"),
    modalSubtitle: document.getElementById("modalSubtitle"),
    modalBody: document.getElementById("modalBody"),
    modalClose: document.getElementById("modalClose"),
    modalBack: document.getElementById("modalBack"),
    dealAvatar: document.getElementById("dealAvatar"),
    dealTitle: document.getElementById("dealTitle"),
    dealSubtitle: document.getElementById("dealSubtitle"),
    dealBody: document.getElementById("dealBody"),
  };

  let allRecords = []; // dernier jeu de résultats reçu du serveur
  let currentStatuses = new Set();
  let currentView = "leads"; // "leads" ou "contacts"
  let pendingViewFade = false; // anime le contenu à l'arrivée des données après un changement d'onglet

  // Configuration par vue : endpoints, libellés de colonnes et placeholder
  const VIEWS = {
    leads: {
      list: "/leads?per_page=200",
      search: "/leads/search",
      detail: "/leads/detail",
      statLabel: "Leads affichés",
      colSociete: "Société",
      colStatut: "Statut",
      placeholder: "Rechercher un lead (nom, société, email, téléphone…)",
      showStatusFilter: true,
    },
    contacts: {
      list: "/contacts",
      search: "/contacts/search",
      detail: "/contacts/detail",
      statLabel: "Contacts affichés",
      colSociete: "Société",
      colStatut: "Poste",
      placeholder: "Rechercher un contact (nom, société, email…)",
      showStatusFilter: true,
    },
  };

  // --- Helpers d'affichage d'état ---
  function replayAnimation(el, className) {
    el.classList.remove(className);
    void el.offsetWidth; // force le reflow pour pouvoir rejouer l'animation
    el.classList.add(className);
  }

  function showState(name) {
    els.loading.hidden = name !== "loading";
    els.empty.hidden = name !== "empty";
    els.error.hidden = name !== "error";
    document.querySelector(".table-wrap").hidden = name !== "table";

    // Anime l'arrivée du contenu une fois, juste après un changement d'onglet
    if (pendingViewFade && name !== "loading") {
      pendingViewFade = false;
      replayAnimation(document.querySelector(".content"), "fade-in");
    }
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
  <tr class="lead-row" data-id="${escapeHtml(l.id)}" title="Voir les détails">
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

    // Ouverture de la popup de détail au clic (hors clic sur un lien email/tél)
    els.body.querySelectorAll(".lead-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("a")) return; // laisse les liens mailto/tel fonctionner
        const id = row.getAttribute("data-id");
        if (id) openDetailModal(id);
      });
    });

    showState("table");
  }

  // --- Alimente le filtre statut/poste à partir des données ---
  function refreshStatusOptions(records) {
    const cfg = VIEWS[currentView];
    if (!cfg.showStatusFilter) {
      els.status.hidden = true;
      els.status.innerHTML = '<option value="">Tous les statuts</option>';
      return;
    }
    els.status.hidden = false;
    records.forEach((l) => l.status && currentStatuses.add(l.status));
    const selected = els.status.value;
    const allLabel = `Tous les ${cfg.colStatut.toLowerCase()}s`;
    els.status.innerHTML =
      `<option value="">${escapeHtml(allLabel)}</option>` +
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

  // --- Popup de détail ---
  function openModal() {
    els.modalOverlay.hidden = false;
    // Double rAF : garantit que le navigateur peint l'état fermé avant
    // d'appliquer "is-open", sinon les deux états sont fusionnés et rien n'anime.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.modalOverlay.classList.add("is-open");
      });
    });
  }

  function closeModal() {
    if (els.modalOverlay.hidden) return;
    els.modalOverlay.classList.remove("is-open");

    const finish = () => {
      if (els.modalOverlay.classList.contains("is-open")) return; // rouverte entre-temps
      els.modalOverlay.hidden = true;
      els.modalBody.innerHTML = "";
      els.modalAvatar.textContent = "";
      els.modalSubtitle.hidden = true;
      els.modalSubtitle.textContent = "";
      // Réinitialise le volet affaire pour que la popup rouvre sur la fiche principale
      els.modalPanel.classList.remove("is-deal");
      els.modalViews.classList.remove("show-deal");
      els.modalBack.classList.remove("is-visible");
      els.modalBack.hidden = true;
      els.dealBody.innerHTML = "";
      els.dealAvatar.textContent = "";
      els.dealSubtitle.hidden = true;
      els.dealSubtitle.textContent = "";
      els.modalPanel.style.height = ""; // au cas où une animation de hauteur était en cours
    };
    let done = false;
    const panel = els.modalOverlay.querySelector(".modal-panel");
    panel.addEventListener(
      "transitionend",
      () => {
        if (done) return;
        done = true;
        finish();
      },
      { once: true },
    );
    setTimeout(() => {
      if (done) return;
      done = true;
      finish();
    }, 500);
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    return parts
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("");
  }

  // Anime le changement de hauteur du panneau avec le même bounce que le
  // redimensionnement "bureau", en verrouillant une valeur en px avant/après
  // la mutation (une hauteur "auto" ne peut pas s'animer nativement en CSS).
  function animatePanelHeight(applyChange) {
    const panel = els.modalPanel;
    const before = panel.getBoundingClientRect().height;
    if (!before) {
      applyChange(); // popup pas encore visible : rien à animer
      return;
    }
    // On mesure la hauteur naturelle du nouveau contenu AVANT de verrouiller le
    // panneau à l'ancienne valeur : une fois contraint, la chaîne flex (tous les
    // min-height:0 nécessaires au scroll interne) se rétrécit réellement pour
    // s'y loger plutôt que de déborder derrière l'overflow:hidden, donc mesurer
    // après coup donnerait la même valeur que "before" et casserait la transition.
    applyChange();
    const after = panel.getBoundingClientRect().height;
    panel.style.height = `${before}px`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.style.height = `${after}px`;
      });
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      panel.style.height = "";
    };
    panel.addEventListener(
      "transitionend",
      (e) => {
        if (e.propertyName === "height") release();
      },
      { once: true },
    );
    setTimeout(release, 650);
  }

  // Remplace le contenu du popup avec un fondu — un nouveau nœud "fade-in" à
  // chaque appel, donc l'animation rejoue à chaque changement d'état.
  function setModalBody(html) {
    els.modalBody.innerHTML = `<div class="fade-in">${html}</div>`;
  }

  function renderDetailField(f, cfg) {
    const value =
      f.label === cfg.colStatut
        ? `<span class="badge">${escapeHtml(f.value)}</span>`
        : escapeHtml(f.value);
    return `
  <div class="detail-row">
    <span class="detail-label">${escapeHtml(f.label)}</span>
    <span class="detail-value">${value}</span>
  </div>`;
  }

  function renderDeal(d) {
    const meta = [d.type, d.accountName].filter(Boolean).map(escapeHtml).join(" · ");
    return `
  <div class="deal-card" data-deal-id="${escapeHtml(d.id)}" title="Voir l'affaire">
    <div class="deal-card-head">
      <span class="deal-name">${escapeHtml(d.name) || "Deal sans nom"}</span>
      ${d.stage ? `<span class="badge">${escapeHtml(d.stage)}</span>` : ""}
    </div>
    ${meta ? `<p class="deal-card-meta">${meta}</p>` : ""}
    ${d.reasonForLoss ? `<p class="deal-card-reason">Raison de perte : ${escapeHtml(d.reasonForLoss)}</p>` : ""}
  </div>`;
  }

  // --- Volet affaire : glissement + redimensionnement "bureau" avec bounce ---
  function showBackButton() {
    els.modalBack.hidden = false;
    // Double rAF, même technique que openModal(), pour garantir la transition.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.modalBack.classList.add("is-visible");
      });
    });
  }

  function hideBackButton() {
    els.modalBack.classList.remove("is-visible");
    setTimeout(() => {
      els.modalBack.hidden = true;
    }, 200);
  }

  function setDealBody(html) {
    els.dealBody.innerHTML = `<div class="fade-in">${html}</div>`;
  }

  async function openDealDetail(id) {
    els.modalPanel.classList.add("is-deal");
    els.modalViews.classList.add("show-deal");
    showBackButton();

    els.dealTitle.textContent = "Affaire";
    els.dealAvatar.textContent = "";
    els.dealSubtitle.hidden = true;
    setDealBody('<div class="spinner"></div>');

    try {
      const data = await apiGet(`/deals/detail/${encodeURIComponent(id)}`);
      const groups = data.groups || [];
      const groupsHtml = groups
        .map(
          (g) => `
  <div class="detail-group">
    <p class="detail-group-title">${escapeHtml(g.name)}</p>
    ${g.fields.map((f) => renderDetailField(f, {})).join("")}
  </div>`,
        )
        .join("");
      const crmLink = data.crmUrl
        ? `<a class="crm-link" href="${escapeHtml(data.crmUrl)}" target="_blank" rel="noopener">Voir la fiche sur Zoho CRM</a>`
        : "";

      animatePanelHeight(() => {
        els.dealTitle.textContent = data.title || "Affaire";
        els.dealAvatar.textContent = initials(data.title);
        if (data.subtitle) {
          els.dealSubtitle.textContent = data.subtitle;
          els.dealSubtitle.hidden = false;
        }
        setDealBody(
          (groupsHtml || '<p class="empty-sub">Aucune information disponible.</p>') + crmLink,
        );
      });
    } catch (err) {
      animatePanelHeight(() => {
        setDealBody(`<p class="empty-sub">Erreur : ${escapeHtml(err.message)}</p>`);
      });
    }
  }

  function closeDealDetail() {
    els.modalViews.classList.remove("show-deal");
    els.modalPanel.classList.remove("is-deal");
    hideBackButton();
  }

  async function openDetailModal(id) {
    const cfg = VIEWS[currentView];
    closeDealDetail();
    els.modalBack.hidden = true;
    els.modalTitle.textContent = "Détails";
    els.modalAvatar.textContent = "";
    els.modalSubtitle.hidden = true;
    setModalBody('<div class="spinner"></div>');
    openModal();
    try {
      const data = await apiGet(`${cfg.detail}/${encodeURIComponent(id)}`);
      const groups = data.groups || [];
      const groupsHtml = groups
        .map(
          (g) => `
  <div class="detail-group">
    <p class="detail-group-title">${escapeHtml(g.name)}</p>
    ${g.fields.map((f) => renderDetailField(f, cfg)).join("")}
  </div>`,
        )
        .join("");

      const deals = data.deals || [];
      const dealsHtml = deals.length
        ? `
  <div class="detail-group">
    <p class="detail-group-title">Deal${deals.length > 1 ? "s" : ""} associé${deals.length > 1 ? "s" : ""}</p>
    ${deals.map(renderDeal).join("")}
  </div>`
        : "";

      const crmLink = data.crmUrl
        ? `<a class="crm-link" href="${escapeHtml(data.crmUrl)}" target="_blank" rel="noopener">Voir la fiche sur Zoho CRM</a>`
        : "";

      const bodyHtml = dealsHtml + groupsHtml + crmLink;

      animatePanelHeight(() => {
        els.modalTitle.textContent = data.title || "Détails";
        els.modalAvatar.textContent = initials(data.title);
        if (data.subtitle) {
          els.modalSubtitle.textContent = data.subtitle;
          els.modalSubtitle.hidden = false;
        }
        setModalBody(bodyHtml || '<p class="empty-sub">Aucune information disponible.</p>');
      });
    } catch (err) {
      animatePanelHeight(() => {
        setModalBody(`<p class="empty-sub">Erreur : ${escapeHtml(err.message)}</p>`);
      });
    }
  }

  els.modalBody.addEventListener("click", (e) => {
    const card = e.target.closest(".deal-card");
    if (!card) return;
    const id = card.getAttribute("data-deal-id");
    if (id) openDealDetail(id);
  });
  els.modalBack.addEventListener("click", closeDealDetail);

  els.modalClose.addEventListener("click", closeModal);
  els.modalOverlay.addEventListener("click", (e) => {
    if (e.target === els.modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || els.modalOverlay.hidden) return;
    if (els.modalPanel.classList.contains("is-deal")) closeDealDetail();
    else closeModal();
  });

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

    pendingViewFade = true;
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
