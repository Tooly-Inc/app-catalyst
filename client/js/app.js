(function () {
  "use strict";

  const BASE = (window.APP_CONFIG && window.APP_CONFIG.FUNCTION_BASE_URL) || "";

  // --- Éléments DOM ---
  const els = {
    body: document.getElementById("leadsBody"),
    search: document.getElementById("searchInput"),
    clear: document.getElementById("clearBtn"),
    status: document.getElementById("statusFilter"),
    total: document.getElementById("statTotal"),
    statLabel: document.getElementById("statLabel"),
    loading: document.getElementById("loadingState"),
    empty: document.getElementById("emptyState"),
    error: document.getElementById("errorState"),
    errorMsg: document.getElementById("errorMsg"),
    btnLeads: document.getElementById("btnLeads"),
    btnContacts: document.getElementById("btnContacts"),
    btnDeals: document.getElementById("btnDeals"),
    colStatut: document.getElementById("colStatut"),
    colSociete: document.getElementById("colSociete"),
    colCol3: document.getElementById("colCol3"),
    colCol4: document.getElementById("colCol4"),
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
    dealFooter: document.getElementById("dealFooter"),
    relanceToast: document.getElementById("relanceToast"),
    activityPanel: document.getElementById("activityPanel"),
    activityPanelBack: document.getElementById("activityPanelBack"),
    activityPanelBody: document.getElementById("activityPanelBody"),
    searchKbdHint: document.getElementById("searchKbdHint"),
    mobileSearchBtn: document.getElementById("mobileSearchBtn"),
    mobileSearchOverlay: document.getElementById("mobileSearchOverlay"),
    mobileSearchPanel: document.getElementById("mobileSearchPanel"),
    mobileSearchHandle: document.getElementById("mobileSearchHandle"),
    mobileSearchHeader: document.getElementById("mobileSearchHeader"),
    mobileSearchBody: document.getElementById("mobileSearchBody"),
    mobileSearchClose: document.getElementById("mobileSearchClose"),
    searchWrap: document.querySelector(".search-wrap"),
    searchDropdown: document.getElementById("searchDropdown"),
    dealCreateBtn: document.getElementById("dealCreateBtn"),
    dealCreateBtnLabel: document.querySelector("#dealCreateBtn .btn-label"),
    dcOverlay: document.getElementById("dealCreateOverlay"),
    dcClose: document.getElementById("dcClose"),
    dcCancel: document.getElementById("dcCancel"),
    dcSubmit: document.getElementById("dcSubmit"),
    dcName: document.getElementById("dcName"),
    dcAmount: document.getElementById("dcAmount"),
    dcNextStep: document.getElementById("dcNextStep"),
    dcStages: document.getElementById("dcStages"),
    dcContactInput: document.getElementById("dcContactInput"),
    dcContactResults: document.getElementById("dcContactResults"),
    dcContactSelected: document.getElementById("dcContactSelected"),
    dcError: document.getElementById("dcError"),
    menuBtn: document.getElementById("menuBtn"),
    viewToggle: document.getElementById("viewToggle"),
    drawerOverlay: document.getElementById("drawerOverlay"),
    drawerClose: document.getElementById("drawerClose"),
    drawerBack: document.getElementById("drawerBack"),
    drawerTitle: document.getElementById("drawerTitle"),
    drawerViews: document.getElementById("drawerViews"),
    menuCreateLead: document.getElementById("menuCreateLead"),
    menuCreateContact: document.getElementById("menuCreateContact"),
    menuCreateDeal: document.getElementById("menuCreateDeal"),
    menuPersonalization: document.getElementById("menuPersonalization"),
    themeGrid: document.getElementById("themeGrid"),
    qcOverlay: document.getElementById("quickCreateOverlay"),
    qcTitle: document.getElementById("qcTitle"),
    qcClose: document.getElementById("qcClose"),
    qcCancel: document.getElementById("qcCancel"),
    qcSubmit: document.getElementById("qcSubmit"),
    qcFirstName: document.getElementById("qcFirstName"),
    qcLastName: document.getElementById("qcLastName"),
    qcCompanyField: document.getElementById("qcCompanyField"),
    qcCompany: document.getElementById("qcCompany"),
    qcEmail: document.getElementById("qcEmail"),
    qcPhone: document.getElementById("qcPhone"),
    qcError: document.getElementById("qcError"),
    miniDialogOverlay: document.getElementById("miniDialogOverlay"),
    miniDialogTitle: document.getElementById("miniDialogTitle"),
    miniDialogMessage: document.getElementById("miniDialogMessage"),
    miniDialogInput: document.getElementById("miniDialogInput"),
    miniDialogConfirm: document.getElementById("miniDialogConfirm"),
    miniDialogCancel: document.getElementById("miniDialogCancel"),
    toastStack: document.getElementById("toastStack"),
  };

  let allRecords = []; // dernier jeu de résultats reçu du serveur
  let currentStatuses = new Set();
  let currentView = "leads"; // "leads" ou "contacts"
  let pendingViewFade = false; // anime le contenu à l'arrivée des données après un changement d'onglet

  // --- État de la fiche de détail (lead/contact) ---
  let currentEntity = null; // { module, id } — pour le fil d'activité et le composeur de remarque
  let currentDetailData = null; // { view, cfg, data, activity } — pour réafficher sans refetch (ex. reset d'ordre)

  // --- État du volet affaire ---
  let currentDeal = null; // deal actuellement affiché (forme de /deals/detail/:id)
  let dealActivity = [];
  let dealMeta = null; // { stages, reasons } — chargé une fois depuis /deals/meta
  let dealEditing = false;
  let dealDraft = null; // { stage, amount, nextStep, reasonForLoss, chainFollowUp }
  let dealRelance = null; // { taskId, dueDate } une fois une relance créée dans cette session
  let relanceToastTimer = null;

  // --- État de la recherche globale (liste déroulante ancrée à la barre) ---
  let searchResults = [];
  let searchIndex = -1;

  // --- État de la création rapide de deal ---
  let dealCreateContact = null; // { id, name, company }
  let dealCreateStage = null;
  let dealCreateSearchTimer = null;

  // Configuration par vue : endpoints, libellés de colonnes et placeholder.
  // col3/col4 pilotent à la fois le libellé d'en-tête et la donnée affichée
  // dans les 2 colonnes du milieu, réutilisées pour montant/clôture sur la
  // vue affaires (pas d'email/téléphone sur un deal).
  const VIEWS = {
    leads: {
      list: "/leads?per_page=200",
      detail: "/leads/detail",
      statLabel: "Leads affichés",
      colSociete: "Société",
      colStatut: "Statut",
      col3: "email",
      col4: "phone",
      showStatusFilter: true,
      createLabel: "Nouveau lead",
    },
    contacts: {
      list: "/contacts",
      detail: "/contacts/detail",
      statLabel: "Contacts affichés",
      colSociete: "Société",
      colStatut: "Poste",
      col3: "email",
      col4: "phone",
      showStatusFilter: true,
      createLabel: "Nouveau contact",
    },
    deals: {
      list: "/deals",
      statLabel: "Affaires affichées",
      colSociete: "Société",
      colStatut: "Étape",
      col3: "amount",
      col4: "closingDate",
      showStatusFilter: true,
      createLabel: "Nouveau deal",
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

  // Attribue une couleur de statut par hash du texte : deux statuts
  // différents ont (presque) toujours des couleurs différentes, et un même
  // statut garde toujours la même couleur (voir les 8 classes .badge--s0..7,
  // figées quel que soit le thème actif).
  const STATUS_COLOR_COUNT = 8;
  function statusBadgeClass(text) {
    const s = String(text || "");
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return `badge badge--s${hash % STATUS_COLOR_COUNT}`;
  }

  function formatMoney(v) {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    if (Number.isNaN(n)) return escapeHtml(String(v));
    return n.toLocaleString("fr-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function formatDateShort(v) {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return escapeHtml(String(v));
    return d.toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" });
  }

  function relativeDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "à l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `il y a ${diffH} h`;
    const diffD = Math.round(diffH / 24);
    if (diffD === 1) return "hier";
    if (diffD < 7) return `il y a ${diffD} j`;
    return d.toLocaleDateString("fr-CA", { day: "numeric", month: "short" });
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
    const col3Label = cfg.col3 === "amount" ? "Montant" : "Email";
    const col4Label = cfg.col4 === "closingDate" ? "Clôture prévue" : "Téléphone";

    function renderCol3(l) {
      if (cfg.col3 === "amount") {
        return l.amount != null && l.amount !== ""
          ? escapeHtml(formatMoney(l.amount))
          : '<span class="muted">—</span>';
      }
      return l.email
        ? `<a href="mailto:${escapeHtml(l.email)}">${escapeHtml(l.email)}</a>`
        : '<span class="muted">—</span>';
    }
    function renderCol4(l) {
      if (cfg.col4 === "closingDate") {
        return l.closingDate
          ? escapeHtml(formatDateShort(l.closingDate))
          : '<span class="muted">—</span>';
      }
      return l.phone
        ? `<a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a>`
        : '<span class="muted">—</span>';
    }

    els.body.innerHTML = filtered
      .map(
        (l) => `
  <tr class="lead-row" data-id="${escapeHtml(l.id)}" title="Voir les détails">
    <td data-label="Nom" class="lead-name">${escapeHtml(l.name) || '<span class="muted">—</span>'}</td>
    <td data-label="${escapeHtml(societeLabel)}" class="lead-company">${escapeHtml(l.company) || '<span class="muted">—</span>'}</td>
    <td data-label="${escapeHtml(col3Label)}" class="lead-email">${renderCol3(l)}</td>
    <td data-label="${escapeHtml(col4Label)}" class="lead-phone">${renderCol4(l)}</td>
    <td data-label="${escapeHtml(statutLabel)}">${
      l.status
        ? `<span class="${statusBadgeClass(l.status)}">${escapeHtml(l.status)}</span>`
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
        if (!id) return;
        if (currentView === "deals") {
          openModal();
          openDealDetail(id);
        } else {
          openDetailModal(id);
        }
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

  async function apiSend(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    // Au cas où une réouverture interromprait l'animation de fermeture en
    // cours (voir closeModal) : sans ça, le panneau resterait figé sur son
    // état final (aplati, invisible) au lieu de rejouer l'ouverture normale.
    els.modalPanel.classList.remove("is-closing");
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
    els.modalPanel.classList.add("is-closing");

    const finish = () => {
      if (els.modalOverlay.classList.contains("is-open")) return; // rouverte entre-temps
      els.modalOverlay.hidden = true;
      els.modalPanel.classList.remove("is-closing");
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
      els.dealFooter.innerHTML = "";
      els.dealAvatar.textContent = "";
      els.dealSubtitle.hidden = true;
      els.dealSubtitle.textContent = "";
      els.modalPanel.style.height = ""; // au cas où une animation de hauteur était en cours
      hideRelanceToast();
      els.activityPanel.hidden = true;
      els.activityPanel.classList.remove("is-open");
      els.activityPanelBody.innerHTML = "";
      els.modalPanel.classList.remove("is-activity");
      els.modalViews.style.width = "";
      els.modalViews.style.flexShrink = "";
      currentEntity = null;
      currentDetailData = null;
      currentDeal = null;
      dealActivity = [];
      dealEditing = false;
      dealDraft = null;
      dealRelance = null;
    };
    let done = false;
    const panel = els.modalOverlay.querySelector(".modal-panel");
    panel.addEventListener(
      "animationend",
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
    }, 600);
  }

  // --- Boîte de dialogue générique (confirmation / saisie d'un nom) ---
  let miniDialogResolve = null;
  function showMiniDialog({ title, message, withInput, inputPlaceholder, confirmLabel, danger }) {
    els.miniDialogTitle.textContent = title || "Confirmer";
    els.miniDialogMessage.textContent = message || "";
    els.miniDialogInput.hidden = !withInput;
    els.miniDialogInput.value = "";
    els.miniDialogInput.placeholder = inputPlaceholder || "";
    els.miniDialogConfirm.textContent = confirmLabel || "Confirmer";
    els.miniDialogConfirm.classList.toggle("btn--primary", !danger);
    els.miniDialogConfirm.classList.toggle("btn--danger", !!danger);
    els.miniDialogOverlay.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.miniDialogOverlay.classList.add("is-open");
      });
    });
    if (withInput) setTimeout(() => els.miniDialogInput.focus(), 60);
    return new Promise((resolve) => {
      miniDialogResolve = resolve;
    });
  }
  function closeMiniDialog(result) {
    if (els.miniDialogOverlay.hidden) return;
    els.miniDialogOverlay.classList.remove("is-open");
    setTimeout(() => {
      els.miniDialogOverlay.hidden = true;
    }, 250);
    if (miniDialogResolve) {
      miniDialogResolve(result);
      miniDialogResolve = null;
    }
  }
  els.miniDialogConfirm.addEventListener("click", () => {
    if (!els.miniDialogInput.hidden) {
      const val = els.miniDialogInput.value.trim();
      if (!val) {
        els.miniDialogInput.focus();
        return;
      }
      closeMiniDialog(val);
    } else {
      closeMiniDialog(true);
    }
  });
  els.miniDialogCancel.addEventListener("click", () => closeMiniDialog(null));
  els.miniDialogOverlay.addEventListener("click", (e) => {
    if (e.target === els.miniDialogOverlay) closeMiniDialog(null);
  });
  els.miniDialogInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.miniDialogConfirm.click();
  });

  // --- Notification de confirmation (remarque ajoutée, deal mis à jour…) ---
  function showToast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    els.toastStack.appendChild(el);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add("is-visible");
      });
    });
    setTimeout(() => {
      el.classList.remove("is-visible");
      let done = false;
      const remove = () => {
        if (done) return;
        done = true;
        el.remove();
      };
      el.addEventListener("transitionend", remove, { once: true });
      setTimeout(remove, 400);
    }, 3000);
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
  // afterReady (optionnel) : promesse à attendre avant de mesurer la hauteur
  // "after" — utile quand applyChange() déclenche AUSSI une transition de
  // largeur (voir .modal-panel.is-deal) en plus du changement de contenu :
  // mesurer tout de suite donnerait la hauteur du nouveau contenu à
  // l'ancienne largeur (la transition de largeur n'a pas encore progressé au
  // moment de la mesure), verrouillerait cette mauvaise valeur, et le
  // contenu réel — une fois la largeur stabilisée — se retrouverait rogné
  // par l'overflow:hidden du panneau (voir waitForPanelWidthTransition).
  function animatePanelHeight(applyChange, afterReady) {
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
    const measureAndAnimate = () => {
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
    };
    if (afterReady) afterReady.then(measureAndAnimate);
    else measureAndAnimate();
  }

  // L'entrée dans le volet affaire élargit .modal-panel en même temps
  // (voir .modal-panel.is-deal, transition max-width 0.55s) que la fiche
  // charge ses données. Si les données arrivent avant la fin de cet
  // élargissement, animatePanelHeight mesurait la hauteur du nouveau contenu
  // à une largeur encore intermédiaire (ni l'ancienne ni la nouvelle),
  // verrouillait cette mauvaise valeur, et le contenu réel — une fois la
  // largeur stabilisée — se retrouvait rogné par l'overflow:hidden du
  // panneau jusqu'au relâchement de la contrainte de hauteur. On attend donc
  // la fin de cette transition avant d'animer la hauteur.
  function waitForPanelWidthTransition() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      els.modalPanel.addEventListener(
        "transitionend",
        (e) => {
          if (e.propertyName === "max-width") finish();
        },
        { once: true },
      );
      setTimeout(finish, 600);
    });
  }

  // Remplace le contenu du popup avec un fondu — un nouveau nœud "fade-in" à
  // chaque appel, donc l'animation rejoue à chaque changement d'état.
  function setModalBody(html) {
    els.modalBody.innerHTML = `<div class="fade-in">${html}</div>`;
  }

  function setDealBody(html) {
    els.dealBody.innerHTML = `<div class="fade-in">${html}</div>`;
  }

  function renderDetailField(f, cfg) {
    const value =
      f.label === cfg.colStatut
        ? `<span class="${statusBadgeClass(f.value)}">${escapeHtml(f.value)}</span>`
        : escapeHtml(f.value);
    return `
  <div class="detail-row" data-field-key="${escapeHtml(f.label)}">
    <span class="detail-drag-handle" aria-hidden="true">⠿</span>
    <span class="detail-label">${escapeHtml(f.label)}</span>
    <span class="detail-value">${value}</span>
  </div>`;
  }

  // --- Ordre personnalisé des champs et des sections (glisser-déposer) ---
  const FIELD_ORDER_PREFIX = "toolyFieldOrder:"; // clé de base, ou "base:groupe" pour un ordre propre à une section
  const GROUP_ORDER_PREFIX = "toolyGroupOrder:";
  const LAYOUTS_PREFIX = "toolyLayouts:";
  const ACTIVE_LAYOUT_PREFIX = "toolyActiveLayout:";
  function loadJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }
  function clearKey(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
  const loadFieldOrder = (key) => loadJSON(FIELD_ORDER_PREFIX + key);
  const saveFieldOrder = (key, order) => saveJSON(FIELD_ORDER_PREFIX + key, order);
  const clearFieldOrder = (key) => clearKey(FIELD_ORDER_PREFIX + key);
  const loadGroupOrder = (key) => loadJSON(GROUP_ORDER_PREFIX + key);
  const saveGroupOrder = (key, order) => saveJSON(GROUP_ORDER_PREFIX + key, order);
  const clearGroupOrder = (key) => clearKey(GROUP_ORDER_PREFIX + key);
  const loadLayouts = (orderKey) => loadJSON(LAYOUTS_PREFIX + orderKey) || [];
  const saveLayouts = (orderKey, layouts) => saveJSON(LAYOUTS_PREFIX + orderKey, layouts);
  function loadActiveLayout(orderKey) {
    try {
      return localStorage.getItem(ACTIVE_LAYOUT_PREFIX + orderKey) || "";
    } catch (e) {
      return "";
    }
  }
  function saveActiveLayout(orderKey, id) {
    try {
      localStorage.setItem(ACTIVE_LAYOUT_PREFIX + orderKey, id);
    } catch (e) {}
  }
  const clearActiveLayout = (orderKey) => clearKey(ACTIVE_LAYOUT_PREFIX + orderKey);

  function sortByOrder(items, order, keyFn) {
    if (!order) return items || [];
    const rank = new Map(order.map((k, i) => [k, i]));
    return (items || [])
      .map((item, i) => ({ item, i }))
      .sort((a, b) => {
        const ra = rank.has(keyFn(a.item)) ? rank.get(keyFn(a.item)) : order.length + a.i;
        const rb = rank.has(keyFn(b.item)) ? rank.get(keyFn(b.item)) : order.length + b.i;
        return ra - rb;
      })
      .map(({ item }) => item);
  }

  // Capture/applique/efface l'intégralité de l'état d'ordre "en direct" d'une
  // fiche (ordre des sections + ordre des champs global ou par section) — sert
  // à la fois au bouton de réinitialisation et à l'enregistrement de dispositions.
  function readLiveOrderState(orderKey, groups) {
    const perGroup = {};
    (groups || []).forEach((g) => {
      const o = loadFieldOrder(`${orderKey}:${g.name}`);
      if (o) perGroup[g.name] = o;
    });
    return {
      groupOrder: loadGroupOrder(orderKey),
      fieldOrder: loadFieldOrder(orderKey),
      perGroup,
    };
  }
  function applyOrderState(orderKey, groups, state) {
    if (state.groupOrder) saveGroupOrder(orderKey, state.groupOrder);
    else clearGroupOrder(orderKey);
    if (state.fieldOrder) saveFieldOrder(orderKey, state.fieldOrder);
    else clearFieldOrder(orderKey);
    (groups || []).forEach((g) => {
      const o = state.perGroup && state.perGroup[g.name];
      if (o) saveFieldOrder(`${orderKey}:${g.name}`, o);
      else clearFieldOrder(`${orderKey}:${g.name}`);
    });
  }
  function clearLiveOrderState(orderKey, groups) {
    clearGroupOrder(orderKey);
    clearFieldOrder(orderKey);
    (groups || []).forEach((g) => clearFieldOrder(`${orderKey}:${g.name}`));
  }

  // Les fiches lead/contact/deal sont regénérées entièrement à chaque ouverture ;
  // ces deux helpers retrouvent les groupes courants et redessinent la bonne
  // fiche sans dupliquer la logique dans chaque poignée d'action.
  function groupsForOrderKey(orderKey) {
    if (orderKey === "deals") return (currentDeal && currentDeal.groups) || [];
    if (currentDetailData && currentDetailData.view === orderKey) return currentDetailData.data.groups || [];
    return [];
  }
  function rerenderForOrderKey(orderKey) {
    if (orderKey === "deals") {
      if (currentDeal) animatePanelHeight(() => renderDealView());
    } else if (currentDetailData && currentDetailData.view === orderKey) {
      animatePanelHeight(() => renderMainDetailBody());
    }
  }

  function renderOrderToolbar(orderKey, groups) {
    if (!orderKey) return "";
    const layouts = loadLayouts(orderKey);
    const activeId = loadActiveLayout(orderKey);
    const options =
      `<option value="">Disposition actuelle</option>` +
      layouts
        .map(
          (l) =>
            `<option value="${escapeHtml(l.id)}"${l.id === activeId ? " selected" : ""}>${escapeHtml(l.name)}</option>`,
        )
        .join("") +
      `<option value="__save__">＋ Enregistrer la disposition actuelle…</option>`;
    const keyAttr = escapeHtml(orderKey);
    return `
  <div class="detail-order-bar" data-order-key="${keyAttr}">
    <select class="detail-layout-select" data-order-key="${keyAttr}">${options}</select>
    ${
      activeId
        ? `<button class="detail-order-icon-btn detail-layout-delete" type="button" data-order-key="${keyAttr}" title="Supprimer cette disposition">🗑</button>`
        : ""
    }
    <button class="detail-order-icon-btn detail-order-reset" type="button" data-order-key="${keyAttr}" title="Réinitialiser l'ordre par défaut">↺</button>
  </div>`;
  }

  // orderKey est toujours l'un des 3 identifiants fixes ("leads"/"contacts"/"deals"),
  // jamais une valeur saisie par l'utilisateur : on peut donc l'interpoler
  // directement dans le sélecteur sans échappement.
  function refreshOrderToolbar(orderKey) {
    const bar = document.querySelector(`.detail-order-bar[data-order-key="${orderKey}"]`);
    if (!bar) return;
    bar.outerHTML = renderOrderToolbar(orderKey, groupsForOrderKey(orderKey));
  }

  // orderKey identifie le type de fiche ("leads", "contacts", "deals") pour
  // mémoriser un ordre de champs/sections distinct par type — un même libellé
  // (ex. "Statut") peut être réordonné différemment sur une fiche lead vs deal.
  // Le sélecteur de disposition est affiché séparément, tout en haut de la
  // fiche (voir renderMainDetailBody/renderDealView) — pas ici, pour rester
  // loin du panneau de remarques plus bas.
  function renderDetailGroups(groups, cfg, orderKey) {
    const fieldOrder = orderKey ? loadFieldOrder(orderKey) : null;
    const groupOrder = orderKey ? loadGroupOrder(orderKey) : null;
    const keyAttr = escapeHtml(orderKey || "");
    if (!fieldOrder) {
      const inner = sortByOrder(groups, groupOrder, (g) => g.name)
        .map((g) => {
          const gOrder = orderKey ? loadFieldOrder(`${orderKey}:${g.name}`) : null;
          const fields = sortByOrder(g.fields, gOrder, (f) => f.label);
          return `
  <div class="detail-group" data-group-key="${escapeHtml(g.name)}">
    <p class="detail-group-title"><span class="detail-group-drag-handle" aria-hidden="true">⠿</span>${escapeHtml(g.name)}</p>
    ${fields.map((f) => renderDetailField(f, cfg)).join("")}
  </div>`;
        })
        .join("");
      return `<div class="detail-fields" data-order-key="${keyAttr}">${inner}</div>`;
    }
    const flat = (groups || []).flatMap((g) => g.fields);
    const sorted = sortByOrder(flat, fieldOrder, (f) => f.label);
    return `
  <div class="detail-fields detail-fields--flat" data-order-key="${keyAttr}">
    <div class="detail-group detail-group--flat">
      ${sorted.map((f) => renderDetailField(f, cfg)).join("")}
    </div>
  </div>`;
  }

  // Bascule un groupe encore "en titres" vers la disposition à plat : seulement
  // nécessaire quand un champ traverse une frontière de section, auquel cas ces
  // titres ne décrivent plus correctement le contenu.
  function flattenFieldGroup(wrapper) {
    if (wrapper.classList.contains("detail-fields--flat")) return;
    wrapper.querySelectorAll(".detail-group-title").forEach((t) => t.remove());
    const groups = Array.from(wrapper.querySelectorAll(".detail-group"));
    const target = groups[0];
    if (target) {
      groups.slice(1).forEach((g) => {
        while (g.firstChild) target.appendChild(g.firstChild);
        g.remove();
      });
      target.classList.add("detail-group--flat");
    }
    wrapper.classList.add("detail-fields--flat");
  }

  // Un champ déplacé À L'INTÉRIEUR de sa section d'origine ne doit réordonner
  // que cette section, sans toucher aux titres ni aux autres sections.
  function persistGroupFieldOrder(wrapper, groupEl) {
    const orderKey = wrapper.getAttribute("data-order-key");
    const groupKey = groupEl.getAttribute("data-group-key");
    if (!orderKey || !groupKey) return;
    const order = Array.from(groupEl.querySelectorAll(".detail-row"))
      .map((r) => r.getAttribute("data-field-key"))
      .filter(Boolean);
    saveFieldOrder(`${orderKey}:${groupKey}`, order);
    clearActiveLayout(orderKey);
    refreshOrderToolbar(orderKey);
  }

  // Un champ déplacé D'UNE section vers une autre aplatit toute la fiche : au-delà
  // de ce point, l'ordre des sections d'origine ne décrit plus rien de fiable.
  function persistFieldOrder(wrapper) {
    const orderKey = wrapper.getAttribute("data-order-key");
    if (!orderKey) return;
    flattenFieldGroup(wrapper);
    const order = Array.from(wrapper.querySelectorAll(".detail-row"))
      .map((r) => r.getAttribute("data-field-key"))
      .filter(Boolean);
    saveFieldOrder(orderKey, order);
    clearActiveLayout(orderKey);
    refreshOrderToolbar(orderKey);
  }

  function persistGroupOrder(wrapper) {
    const orderKey = wrapper.getAttribute("data-order-key");
    if (!orderKey) return;
    const order = Array.from(wrapper.querySelectorAll(":scope > .detail-group"))
      .map((g) => g.getAttribute("data-group-key"))
      .filter(Boolean);
    saveGroupOrder(orderKey, order);
    clearActiveLayout(orderKey);
    refreshOrderToolbar(orderKey);
  }

  // Glisser-déposer des champs et des sections : délégué au document car
  // modalBody/dealBody sont entièrement regénérés à chaque ouverture de fiche.
  // Implémenté en Pointer Events (et non l'API HTML5 dragstart/dragover/drop) :
  // les navigateurs mobiles ne déclenchent jamais ces événements pour une
  // interaction tactile, ce qui rendait les pastilles totalement inertes sur
  // téléphone. Les Pointer Events unifient souris/tactile/stylet en un seul
  // jeu d'écouteurs.
  let dragFieldEl = null;
  let dragFieldSourceGroup = null;
  let dragGroupEl = null;
  let dragPointerId = null;
  let dragOverEl = null;
  let dragOverBefore = false;

  function clearDragOverClasses() {
    document
      .querySelectorAll(".drag-over-top, .drag-over-bottom")
      .forEach((r) => r.classList.remove("drag-over-top", "drag-over-bottom"));
  }
  function updateDragOver(selector, dragEl, x, y) {
    const target = document.elementFromPoint(x, y);
    const el = target && target.closest(selector);
    clearDragOverClasses();
    if (!el || el === dragEl || !el.closest(".detail-fields")) {
      dragOverEl = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    const before = y - rect.top < rect.height / 2;
    el.classList.toggle("drag-over-top", before);
    el.classList.toggle("drag-over-bottom", !before);
    dragOverEl = el;
    dragOverBefore = before;
  }
  function endDrag() {
    if (dragFieldEl) dragFieldEl.classList.remove("is-dragging");
    if (dragGroupEl) dragGroupEl.classList.remove("is-dragging");
    clearDragOverClasses();
    dragFieldEl = null;
    dragFieldSourceGroup = null;
    dragGroupEl = null;
    dragPointerId = null;
    dragOverEl = null;
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const fieldHandle = e.target.closest(".detail-drag-handle");
      const groupHandle = e.target.closest(".detail-group-drag-handle");
      if (fieldHandle) {
        const row = fieldHandle.closest(".detail-row");
        if (!row) return;
        e.preventDefault();
        dragFieldEl = row;
        dragFieldSourceGroup = row.closest(".detail-group") || null;
        dragPointerId = e.pointerId;
        row.classList.add("is-dragging");
      } else if (groupHandle) {
        const group = groupHandle.closest(".detail-group");
        if (!group) return;
        e.preventDefault();
        dragGroupEl = group;
        dragPointerId = e.pointerId;
        group.classList.add("is-dragging");
      }
    },
    { passive: false },
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (dragPointerId === null || e.pointerId !== dragPointerId) return;
      e.preventDefault();
      if (dragFieldEl) updateDragOver(".detail-row", dragFieldEl, e.clientX, e.clientY);
      else if (dragGroupEl) updateDragOver(".detail-group", dragGroupEl, e.clientX, e.clientY);
    },
    { passive: false },
  );
  document.addEventListener("pointerup", (e) => {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    if (dragFieldEl && dragOverEl && dragOverEl !== dragFieldEl) {
      const row = dragOverEl;
      const wrapper = dragFieldEl.closest(".detail-fields");
      if (wrapper && row.closest(".detail-fields") === wrapper) {
        const targetGroup = row.closest(".detail-group");
        const sameSection =
          !wrapper.classList.contains("detail-fields--flat") &&
          dragFieldSourceGroup &&
          targetGroup === dragFieldSourceGroup;
        row.parentNode.insertBefore(dragFieldEl, dragOverBefore ? row : row.nextSibling);
        if (sameSection) persistGroupFieldOrder(wrapper, dragFieldSourceGroup);
        else persistFieldOrder(wrapper);
      }
    } else if (dragGroupEl && dragOverEl && dragOverEl !== dragGroupEl) {
      const group = dragOverEl;
      const wrapper = dragGroupEl.closest(".detail-fields");
      if (wrapper && group.closest(".detail-fields") === wrapper) {
        group.parentNode.insertBefore(dragGroupEl, dragOverBefore ? group : group.nextSibling);
        persistGroupOrder(wrapper);
      }
    }
    endDrag();
  });
  document.addEventListener("pointercancel", (e) => {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    endDrag();
  });

  async function saveCurrentAsLayout(orderKey, groups) {
    const name = await showMiniDialog({
      title: "Enregistrer la disposition",
      message: "Donne un nom à cette disposition pour la retrouver plus tard.",
      withInput: true,
      inputPlaceholder: "Ex. Vue visio client",
      confirmLabel: "Enregistrer",
    });
    if (!name) return;
    const state = readLiveOrderState(orderKey, groups);
    const layouts = loadLayouts(orderKey);
    const id = `l${Date.now()}${Math.floor(Math.random() * 1000)}`;
    layouts.push({ id, name, ...state });
    saveLayouts(orderKey, layouts);
    saveActiveLayout(orderKey, id);
    rerenderForOrderKey(orderKey);
  }

  document.addEventListener("change", (e) => {
    const select = e.target.closest(".detail-layout-select");
    if (!select) return;
    const orderKey = select.getAttribute("data-order-key");
    if (!orderKey) return;
    const groups = groupsForOrderKey(orderKey);
    const val = select.value;
    if (val === "__save__") {
      select.value = loadActiveLayout(orderKey);
      saveCurrentAsLayout(orderKey, groups);
      return;
    }
    if (val === "") {
      clearLiveOrderState(orderKey, groups);
      clearActiveLayout(orderKey);
    } else {
      const layout = loadLayouts(orderKey).find((l) => l.id === val);
      if (!layout) return;
      applyOrderState(orderKey, groups, layout);
      saveActiveLayout(orderKey, layout.id);
    }
    rerenderForOrderKey(orderKey);
  });

  document.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".detail-layout-delete");
    if (deleteBtn) {
      const orderKey = deleteBtn.getAttribute("data-order-key");
      const id = orderKey ? loadActiveLayout(orderKey) : "";
      if (!orderKey || !id) return;
      const layout = loadLayouts(orderKey).find((l) => l.id === id);
      const confirmed = await showMiniDialog({
        title: "Supprimer la disposition",
        message: `Supprimer définitivement la disposition « ${layout ? layout.name : ""} » ? Elle ne sera plus proposée dans la liste.`,
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!confirmed) return;
      saveLayouts(
        orderKey,
        loadLayouts(orderKey).filter((l) => l.id !== id),
      );
      clearActiveLayout(orderKey);
      clearLiveOrderState(orderKey, groupsForOrderKey(orderKey));
      rerenderForOrderKey(orderKey);
      return;
    }
    const resetBtn = e.target.closest(".detail-order-reset");
    if (resetBtn) {
      const orderKey = resetBtn.getAttribute("data-order-key");
      if (!orderKey) return;
      const confirmed = await showMiniDialog({
        title: "Réinitialiser l'ordre",
        message:
          "Les champs et les sections retrouveront leur disposition d'origine. Cette action n'efface pas tes dispositions enregistrées.",
        confirmLabel: "Réinitialiser",
        danger: true,
      });
      if (!confirmed) return;
      clearLiveOrderState(orderKey, groupsForOrderKey(orderKey));
      clearActiveLayout(orderKey);
      rerenderForOrderKey(orderKey);
    }
  });

  function renderCrmLink(crmUrl) {
    return crmUrl
      ? `<a class="crm-link" href="${escapeHtml(crmUrl)}" target="_blank" rel="noopener">Voir la fiche sur Zoho CRM</a>`
      : "";
  }

  function renderDealRecapGrid(d) {
    const cells = [
      ["Montant", formatMoney(d.amount)],
      ["Clôture prévue", formatDateShort(d.closingDate)],
      ["Prochaine étape", d.nextStep ? escapeHtml(d.nextStep) : ""],
    ].filter(([, v]) => v);
    if (!cells.length) return "";
    return `
  <div class="deal-recap-grid">
    ${cells
      .map(
        ([label, val]) => `
    <div class="deal-recap-cell">
      <span class="deal-recap-label">${label}</span>
      <span class="deal-recap-value">${val}</span>
    </div>`,
      )
      .join("")}
  </div>`;
  }

  function renderDeal(d, recap) {
    const meta = [d.type, d.accountName].filter(Boolean).map(escapeHtml).join(" · ");
    return `
  <div class="deal-card${recap ? " deal-card--recap" : ""}" data-deal-id="${escapeHtml(d.id)}" title="Voir l'affaire">
    <div class="deal-card-head">
      <span class="deal-name">${escapeHtml(d.name) || "Deal sans nom"}</span>
      ${d.stage ? `<span class="${statusBadgeClass(d.stage)}">${escapeHtml(d.stage)}</span>` : ""}
    </div>
    ${meta ? `<p class="deal-card-meta">${meta}</p>` : ""}
    ${d.reasonForLoss ? `<p class="deal-card-reason">Raison de perte : ${escapeHtml(d.reasonForLoss)}</p>` : ""}
    ${recap ? renderDealRecapGrid(d) : ""}
  </div>`;
  }

  // --- Fil d'activité (Notes + Tâches réelles) + composeur de remarque ---
  function activityPillClass(kind) {
    if (kind === "stage") return "activity-pill activity-pill--stage";
    if (kind === "task") return "activity-pill activity-pill--task";
    return "activity-pill";
  }
  function activityPillLabel(kind) {
    if (kind === "stage") return "Étape";
    if (kind === "task") return "Tâche";
    return "Remarque";
  }

  function renderActivityEntry(e) {
    const text =
      e.kind === "stage" ? escapeHtml((e.text || "").replace(/^Étape\s*:\s*/, "")) : escapeHtml(e.text);
    const dateLabel = e.pending ? "à l'instant" : relativeDate(e.date);
    return `
  <div class="activity-entry${e.pending ? " activity-entry--pending" : ""}"${
      e.taskId ? ` data-task-id="${escapeHtml(e.taskId)}"` : ""
    }>
    <span class="${activityPillClass(e.kind)}">${activityPillLabel(e.kind)}</span>
    <span class="activity-text">${text}</span>
    <span class="activity-date">${escapeHtml(dateLabel)}</span>
  </div>`;
  }

  function renderActivityList(entries) {
    if (!entries.length) return '<p class="activity-empty">Aucune activité pour le moment.</p>';
    return `<div class="activity-list">${entries.map(renderActivityEntry).join("")}</div>`;
  }

  function renderNoteComposer() {
    return `
  <div class="note-composer">
    <input type="text" class="note-input" placeholder="Ajouter une remarque…" />
    <button class="note-send" type="button" title="Ajouter">➤</button>
  </div>
  <p class="note-error" hidden></p>`;
  }

  function renderActivitySection(entries) {
    return `
  <div class="activity-section">
    <div class="activity-heading">
      <span>Historique</span>
      <span class="activity-heading-line"></span>
    </div>
    ${renderActivityList(entries)}
  </div>
  ${renderNoteComposer()}`;
  }

  // Insère une nouvelle entrée en tête du fil, sans reconstruire tout le corps.
  function prependActivityEntry(containerEl, entry) {
    animatePanelHeight(() => {
      const section = containerEl.querySelector(".activity-section");
      if (!section) return;
      let list = section.querySelector(".activity-list");
      const empty = section.querySelector(".activity-empty");
      if (!list) {
        list = document.createElement("div");
        list.className = "activity-list";
        if (empty) empty.replaceWith(list);
        else section.appendChild(list);
      } else if (empty) {
        empty.remove();
      }
      list.insertAdjacentHTML("afterbegin", renderActivityEntry(entry));
    });
  }

  function wireNoteComposer(containerEl, module, id, onAdded) {
    const input = containerEl.querySelector(".note-input");
    const btn = containerEl.querySelector(".note-send");
    const errorEl = containerEl.querySelector(".note-error");
    if (!input || !btn) return;
    const submit = async () => {
      const content = input.value.trim();
      if (!content || btn.disabled) return;
      btn.disabled = true;
      input.value = "";
      if (errorEl) errorEl.hidden = true;
      try {
        await apiSend("POST", "/notes", { module, id, content });
        onAdded({ kind: "note", text: content, date: new Date().toISOString() });
        showToast("Remarque ajoutée");
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = `La remarque n'a pas été enregistrée : ${err.message}`;
          errorEl.hidden = false;
        }
        input.value = content;
      } finally {
        btn.disabled = false;
      }
    };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
  }

  // Bouton compact qui remplace le fil d'activité inline : ouvre le panneau
  // (voir openActivityPanel) plutôt que d'occuper la hauteur de la fiche.
  function renderActivityTrigger(entries) {
    return `
  <button class="activity-trigger" type="button">
    <span>💬 Remarques et activité</span>
    <span class="activity-trigger-count">${(entries || []).length}</span>
  </button>`;
  }

  function updateActivityTriggerCount(containerEl, count) {
    const el = containerEl.querySelector(".activity-trigger-count");
    if (el) el.textContent = String(count);
  }

  // --- Panneau des remarques et de l'activité : prolonge la popup plutôt que
  // de la recouvrir (voir .modal-panel.is-activity / .activity-panel en CSS) ---
  function openActivityPanel() {
    if (!els.activityPanel.hidden) return; // déjà ouvert
    const isDeal = els.modalViews.classList.contains("show-deal");
    let module, id, entries;
    if (isDeal) {
      if (!currentDeal) return;
      module = "Deals";
      id = currentDeal.id;
      entries = dealActivity;
    } else {
      if (!currentEntity || !currentDetailData) return;
      module = currentEntity.module;
      id = currentEntity.id;
      entries = currentDetailData.activity;
    }
    els.activityPanelBody.innerHTML = renderActivitySection(entries);
    wireNoteComposer(els.activityPanelBody, module, id, (entry) => {
      if (isDeal) {
        dealActivity = [entry, ...dealActivity];
        updateActivityTriggerCount(els.dealBody, dealActivity.length);
      } else {
        currentDetailData.activity = [entry, ...currentDetailData.activity];
        updateActivityTriggerCount(els.modalBody, currentDetailData.activity.length);
      }
      prependActivityEntry(els.activityPanelBody, entry);
    });
    // La piste (fiche principale / affaire) est verrouillée à sa largeur
    // actuelle avant que la popup ne s'élargisse, sinon son width:200% se
    // recalculerait sur la nouvelle largeur et étirerait les volets existants.
    const viewsWidth = els.modalViews.getBoundingClientRect().width;
    els.modalViews.style.flexShrink = "0";
    els.modalViews.style.width = `${viewsWidth}px`;
    els.modalPanel.classList.add("is-activity");
    els.activityPanel.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.activityPanel.classList.add("is-open");
      });
    });
  }

  function closeActivityPanel() {
    if (els.activityPanel.hidden) return;
    els.activityPanel.classList.remove("is-open");
    els.modalPanel.classList.remove("is-activity");
    setTimeout(() => {
      els.activityPanel.hidden = true;
      els.activityPanelBody.innerHTML = "";
      els.modalViews.style.width = "";
      els.modalViews.style.flexShrink = "";
    }, 600);
  }

  els.activityPanelBack.addEventListener("click", closeActivityPanel);
  document.addEventListener("click", (e) => {
    if (e.target.closest(".activity-trigger")) openActivityPanel();
  });

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

  // --- Mise à jour rapide (volet affaire, mode édition) ---
  function isLossStage(label) {
    return /lost|perdu/i.test(label || "");
  }

  function renderStagePills(stages, currentStage, selectedStage) {
    if (!stages || !stages.length) {
      return '<p class="empty-sub">Pipeline indisponible.</p>';
    }
    return (
      `<div class="stage-pills">` +
      stages
        .map((s) => {
          const isSelected = s.value === selectedStage;
          const isCurrent = !isSelected && s.value === currentStage;
          const cls = isSelected
            ? "stage-pill stage-pill--selected"
            : isCurrent
              ? "stage-pill stage-pill--current"
              : "stage-pill";
          return `<button type="button" class="${cls}" data-stage="${escapeHtml(s.value)}">${escapeHtml(s.label)}${isCurrent ? " · actuel" : ""}</button>`;
        })
        .join("") +
      `</div>`
    );
  }

  function renderLossPanel(meta) {
    const options = (meta.reasons || [])
      .map(
        (r) =>
          `<option value="${escapeHtml(r.value)}"${r.value === dealDraft.reasonForLoss ? " selected" : ""}>${escapeHtml(r.label)}</option>`,
      )
      .join("");
    return `
  <div class="loss-panel">
    <p class="loss-warning">Une perte se documente avant de s'enregistrer</p>
    <label class="qu-field">
      <span class="qu-label">Raison de perte</span>
      <select class="qu-input" id="quReason">
        <option value="">Choisir…</option>
        ${options}
      </select>
    </label>
  </div>`;
  }

  function renderQuickUpdateFields() {
    return `
  <div class="qu-row">
    <label class="qu-field">
      <span class="qu-label">Montant</span>
      <input type="number" class="qu-input" id="quAmount" value="${dealDraft.amount != null ? escapeHtml(String(dealDraft.amount)) : ""}" />
    </label>
    <label class="qu-field qu-field--grow">
      <span class="qu-label">Prochaine étape</span>
      <input type="text" class="qu-input" id="quNextStep" value="${escapeHtml(dealDraft.nextStep || "")}" />
    </label>
  </div>
  <label class="qu-chain">
    <input type="checkbox" id="quChain" ${dealDraft.chainFollowUp ? "checked" : ""} />
    <span>Créer une relance dans 3 jours ouvrables</span>
  </label>`;
  }

  function renderQuickUpdateBody() {
    const meta = dealMeta || { stages: [], reasons: [] };
    const stagesHtml = renderStagePills(meta.stages, currentDeal.stage, dealDraft.stage);
    const showLoss = isLossStage(dealDraft.stage);
    return `
  <div class="qu-section">
    <span class="qu-label">Étape</span>
    ${stagesHtml}
  </div>
  ${showLoss ? renderLossPanel(meta) : renderQuickUpdateFields()}`;
  }

  function renderDealFooterView() {
    const relanceBtn = dealRelance
      ? `<button class="btn btn--secondary btn--sm" type="button" disabled>✓ Relance créée</button>`
      : `<button class="btn btn--primary btn--sm" type="button" data-action="relance">➕ Relance</button>`;
    return `${relanceBtn}<button class="btn btn--outline btn--sm" type="button" data-action="edit">Mise à jour rapide</button>`;
  }

  function renderDealFooterEdit() {
    const showLoss = isLossStage(dealDraft.stage);
    const disableSave = showLoss && !dealDraft.reasonForLoss;
    return `
    <button class="btn btn--primary btn--sm" type="button" data-action="save"${disableSave ? " disabled" : ""}>Enregistrer</button>
    <button class="btn btn--ghost btn--sm" type="button" data-action="cancel">Annuler</button>
    <span class="modal-footer-flex"></span>
    ${showLoss ? '<span class="modal-footer-hint modal-footer-hint--warn">Raison requise</span>' : ""}`;
  }

  function wireQuickUpdateForm() {
    els.dealBody.querySelectorAll(".stage-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        dealDraft.stage = btn.getAttribute("data-stage");
        dealDraft.reasonForLoss = "";
        animatePanelHeight(renderDealView);
      });
    });
    const amountEl = els.dealBody.querySelector("#quAmount");
    if (amountEl)
      amountEl.addEventListener("input", () => {
        dealDraft.amount = amountEl.value;
      });
    const nextStepEl = els.dealBody.querySelector("#quNextStep");
    if (nextStepEl)
      nextStepEl.addEventListener("input", () => {
        dealDraft.nextStep = nextStepEl.value;
      });
    const chainEl = els.dealBody.querySelector("#quChain");
    if (chainEl)
      chainEl.addEventListener("change", () => {
        dealDraft.chainFollowUp = chainEl.checked;
      });
    const reasonEl = els.dealBody.querySelector("#quReason");
    if (reasonEl)
      reasonEl.addEventListener("change", () => {
        dealDraft.reasonForLoss = reasonEl.value;
        els.dealFooter.innerHTML = renderDealFooterEdit();
      });
  }

  async function ensureDealMeta() {
    if (!dealMeta) {
      try {
        dealMeta = await apiGet("/deals/meta");
      } catch (err) {
        dealMeta = { stages: [], reasons: [] };
      }
    }
    return dealMeta;
  }

  async function enterDealEdit() {
    if (!currentDeal) return;
    await ensureDealMeta();
    dealDraft = {
      stage: currentDeal.stage,
      amount: currentDeal.amount,
      nextStep: currentDeal.nextStep,
      reasonForLoss: "",
      chainFollowUp: false,
    };
    dealEditing = true;
    animatePanelHeight(renderDealView);
  }

  function exitDealEdit() {
    dealEditing = false;
    dealDraft = null;
    animatePanelHeight(renderDealView);
  }

  async function saveDealEdit() {
    if (!currentDeal || !dealDraft) return;
    const showLoss = isLossStage(dealDraft.stage);
    if (showLoss && !dealDraft.reasonForLoss) return;
    const saveBtn = els.dealFooter.querySelector('[data-action="save"]');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const payload = {
        stage: dealDraft.stage,
        amount: dealDraft.amount,
        nextStep: dealDraft.nextStep,
        chainFollowUp: dealDraft.chainFollowUp,
      };
      if (showLoss) payload.reasonForLoss = dealDraft.reasonForLoss;
      const data = await apiSend("PATCH", `/deals/${encodeURIComponent(currentDeal.id)}`, payload);
      currentDeal = { id: currentDeal.id, ...data };
      dealEditing = false;
      dealDraft = null;
      showToast("Affaire mise à jour");
      if (data.relance) dealRelance = { taskId: data.relance.id, dueDate: data.relance.dueDate };
      try {
        const activityData = await apiGet(`/activity/Deals/${encodeURIComponent(currentDeal.id)}`);
        dealActivity = activityData.activity || [];
      } catch (e) {
        // on garde l'ancien fil si l'appel échoue
      }
      animatePanelHeight(() => {
        els.dealTitle.textContent = currentDeal.title || "Affaire";
        if (currentDeal.subtitle) {
          els.dealSubtitle.textContent = currentDeal.subtitle;
          els.dealSubtitle.hidden = false;
        }
        renderDealView();
      });
    } catch (err) {
      if (saveBtn) saveBtn.disabled = false;
      els.dealFooter.insertAdjacentHTML(
        "beforeend",
        `<span class="modal-footer-hint modal-footer-hint--warn">Erreur : ${escapeHtml(err.message)}</span>`,
      );
    }
  }

  // --- Relance en un clic + bandeau d'annulation ---
  function showRelanceToast(dueDate, taskId) {
    const dateLabel = formatDateShort(dueDate) || dueDate;
    els.relanceToast.innerHTML = `
    <span>Relance créée pour le ${escapeHtml(dateLabel)}</span>
    <button type="button" class="relance-toast-undo" data-task-id="${escapeHtml(taskId)}">Annuler</button>`;
    els.relanceToast.hidden = false;
    clearTimeout(relanceToastTimer);
    relanceToastTimer = setTimeout(hideRelanceToast, 8000);
  }

  function hideRelanceToast() {
    clearTimeout(relanceToastTimer);
    relanceToastTimer = null;
    if (els.relanceToast) {
      els.relanceToast.hidden = true;
      els.relanceToast.innerHTML = "";
    }
  }

  async function doRelance() {
    if (!currentDeal || dealRelance) return;
    const btn = els.dealFooter.querySelector('[data-action="relance"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Création…";
    }
    try {
      const relance = await apiSend(
        "POST",
        `/deals/${encodeURIComponent(currentDeal.id)}/relance`,
        {},
      );
      dealRelance = { taskId: relance.id, dueDate: relance.dueDate };
      dealActivity = [
        { kind: "task", text: relance.subject, date: new Date().toISOString(), taskId: relance.id },
        ...dealActivity,
      ];
      updateActivityTriggerCount(els.dealBody, dealActivity.length);
      els.dealFooter.innerHTML = renderDealFooterView();
      showRelanceToast(relance.dueDate, relance.id);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "➕ Relance";
      }
      els.dealFooter.insertAdjacentHTML(
        "beforeend",
        `<span class="modal-footer-hint modal-footer-hint--warn">Erreur : ${escapeHtml(err.message)}</span>`,
      );
    }
  }

  async function cancelRelance(taskId) {
    hideRelanceToast();
    try {
      await apiSend("DELETE", `/tasks/${encodeURIComponent(taskId)}`);
    } catch (err) {
      console.error("Annulation relance échouée:", err.message);
    }
    dealRelance = null;
    dealActivity = dealActivity.filter((e) => e.taskId !== taskId);
    updateActivityTriggerCount(els.dealBody, dealActivity.length);
    const entry = els.activityPanelBody.querySelector(`.activity-entry[data-task-id="${CSS.escape(taskId)}"]`);
    if (entry) entry.remove();
    if (currentDeal && !dealEditing) els.dealFooter.innerHTML = renderDealFooterView();
  }

  // --- Rendu du volet affaire (vue lecture ou édition) ---
  function renderDealView() {
    if (!currentDeal) return;
    if (dealEditing) {
      setDealBody(renderQuickUpdateBody());
      els.dealFooter.innerHTML = renderDealFooterEdit();
      wireQuickUpdateForm();
    } else {
      const orderToolbarHtml = renderOrderToolbar("deals", currentDeal.groups);
      const groupsHtml = renderDetailGroups(currentDeal.groups, {}, "deals");
      const crmLink = renderCrmLink(currentDeal.crmUrl);
      const triggerHtml = renderActivityTrigger(dealActivity);
      setDealBody(orderToolbarHtml + triggerHtml + groupsHtml + crmLink);
      els.dealFooter.innerHTML = renderDealFooterView();
    }
  }

  async function openDealDetail(id) {
    els.modalPanel.classList.add("is-deal");
    els.modalViews.classList.add("show-deal");
    const widthReady = waitForPanelWidthTransition();
    // La flèche retour n'a de sens que si une fiche lead/contact est
    // affichée en dessous (voir currentDetailData) — ouverte directement
    // (onglet Affaires, recherche globale), il n'y a rien vers quoi revenir.
    if (currentDetailData) showBackButton();
    else hideBackButton();
    closeActivityPanel();

    dealEditing = false;
    dealDraft = null;
    dealRelance = null;
    hideRelanceToast();

    els.dealTitle.textContent = "Affaire";
    els.dealAvatar.textContent = "";
    els.dealSubtitle.hidden = true;
    els.dealFooter.innerHTML = "";
    setDealBody('<div class="spinner"></div>');

    try {
      const [data, activityData] = await Promise.all([
        apiGet(`/deals/detail/${encodeURIComponent(id)}`),
        apiGet(`/activity/Deals/${encodeURIComponent(id)}`).catch(() => ({ activity: [] })),
      ]);
      currentDeal = { id, ...data };
      dealActivity = activityData.activity || [];

      await widthReady;
      animatePanelHeight(() => {
        els.dealTitle.textContent = data.title || "Affaire";
        els.dealAvatar.textContent = initials(data.title);
        if (data.subtitle) {
          els.dealSubtitle.textContent = data.subtitle;
          els.dealSubtitle.hidden = false;
        }
        renderDealView();
      });
    } catch (err) {
      currentDeal = null;
      await widthReady;
      animatePanelHeight(() => {
        setDealBody(`<p class="empty-sub">Erreur : ${escapeHtml(err.message)}</p>`);
        els.dealFooter.innerHTML = "";
      });
    }
  }

  function closeDealDetail() {
    hideBackButton();
    hideRelanceToast();
    closeActivityPanel();
    // Vide le volet affaire en même temps qu'on recalcule la hauteur : sinon
    // son contenu (potentiellement plus grand) reste dans le DOM et continue
    // de gonfler la hauteur partagée de la rangée à deux volets. La largeur
    // du panneau rétrécit en même temps (retrait de is-deal) : on attend la
    // fin de cette transition avant de mesurer/verrouiller la hauteur (voir
    // animatePanelHeight/waitForPanelWidthTransition), sinon la fiche
    // principale révélée se retrouve rognée pendant que la largeur finit de
    // se stabiliser.
    const widthReady = waitForPanelWidthTransition();
    animatePanelHeight(() => {
      els.modalViews.classList.remove("show-deal");
      els.modalPanel.classList.remove("is-deal");
      els.dealBody.innerHTML = "";
      els.dealFooter.innerHTML = "";
      els.dealAvatar.textContent = "";
      els.dealSubtitle.hidden = true;
      els.dealSubtitle.textContent = "";
    }, widthReady);
    currentDeal = null;
    dealActivity = [];
    dealEditing = false;
    dealDraft = null;
    dealRelance = null;
  }

  // --- Fiche principale (lead/contact) ---
  function renderMainDetailBody() {
    if (!currentDetailData) return;
    const { cfg, data, activity, view } = currentDetailData;
    const orderToolbarHtml = renderOrderToolbar(view, data.groups);
    const groupsHtml = renderDetailGroups(data.groups, cfg, view);

    // Rappel visible : les deals associés, en carte "recap", au-dessus du détail complet
    const deals = data.deals || [];
    const recapHtml = deals.map((d) => renderDeal(d, true)).join("");

    const crmLink = renderCrmLink(data.crmUrl);
    const triggerHtml = renderActivityTrigger(activity);
    setModalBody(orderToolbarHtml + recapHtml + triggerHtml + groupsHtml + crmLink);
  }

  async function openDetailModal(id, viewOverride) {
    const view = viewOverride || currentView;
    const cfg = VIEWS[view];
    closeDealDetail();
    els.modalBack.hidden = true;
    els.modalTitle.textContent = "Détails";
    els.modalAvatar.textContent = "";
    els.modalSubtitle.hidden = true;
    setModalBody('<div class="spinner"></div>');
    openModal();

    const activityModule = view === "leads" ? "Leads" : "Contacts";
    currentEntity = { module: activityModule, id };

    try {
      const [data, activityData] = await Promise.all([
        apiGet(`${cfg.detail}/${encodeURIComponent(id)}`),
        apiGet(`/activity/${activityModule}/${encodeURIComponent(id)}`).catch(() => ({ activity: [] })),
      ]);
      currentDetailData = { view, cfg, data, activity: activityData.activity || [] };

      animatePanelHeight(() => {
        els.modalTitle.textContent = data.title || "Détails";
        els.modalAvatar.textContent = initials(data.title);
        if (data.subtitle) {
          els.modalSubtitle.textContent = data.subtitle;
          els.modalSubtitle.hidden = false;
        }
        renderMainDetailBody();
      });
    } catch (err) {
      currentDetailData = null;
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
  // Si l'affaire a été ouverte directement (onglet Affaires, recherche globale)
  // il n'y a pas de fiche lead/contact sous-jacente vers laquelle revenir :
  // la flèche de retour ferme alors toute la popup plutôt que de révéler un
  // premier volet vide.
  els.modalBack.addEventListener("click", () => {
    if (currentDetailData) closeDealDetail();
    else closeModal();
  });
  els.dealFooter.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "relance") doRelance();
    else if (action === "edit") enterDealEdit();
    else if (action === "save") saveDealEdit();
    else if (action === "cancel") exitDealEdit();
  });
  els.relanceToast.addEventListener("click", (e) => {
    const btn = e.target.closest(".relance-toast-undo");
    if (!btn) return;
    cancelRelance(btn.getAttribute("data-task-id"));
  });

  els.modalClose.addEventListener("click", closeModal);
  els.modalOverlay.addEventListener("click", (e) => {
    if (e.target === els.modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.miniDialogOverlay.hidden) {
      closeMiniDialog(null);
      return;
    }
    if (!els.mobileSearchOverlay.hidden) {
      closeMobileSearch();
      return;
    }
    if (!els.drawerOverlay.hidden) {
      if (els.drawerViews.classList.contains("show-theme")) showDrawerMenu();
      else closeMenu();
      return;
    }
    if (!els.qcOverlay.hidden) {
      closeQuickCreate();
      return;
    }
    if (!els.dcOverlay.hidden) {
      closeDealCreate();
      return;
    }
    if (!els.activityPanel.hidden) {
      closeActivityPanel();
      return;
    }
    if (els.modalOverlay.hidden) return;
    if (els.modalPanel.classList.contains("is-deal") && currentDetailData) closeDealDetail();
    else closeModal();
  });

  // --- Recherche globale (⌘K / Ctrl+K) — liste déroulante sous la barre existante ---
  function hideSearchDropdown() {
    els.searchDropdown.hidden = true;
    els.searchDropdown.innerHTML = "";
    searchResults = [];
    searchIndex = -1;
  }

  function updateSearchActiveRow() {
    els.searchDropdown.querySelectorAll(".palette-row").forEach((row) => {
      row.classList.toggle("is-active", Number(row.getAttribute("data-index")) === searchIndex);
    });
    const active = els.searchDropdown.querySelector(".palette-row.is-active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function renderSearchRow(item, index) {
    if (item.type === "deal") {
      const meta = [formatMoney(item.amount), item.contactName].filter(Boolean).join(" · ");
      return `
    <div class="palette-row" data-index="${index}">
      <div class="palette-row-main">
        <span class="palette-row-title">${escapeHtml(item.name) || "Deal sans nom"}</span>
        <span class="palette-row-meta">${escapeHtml(meta)}</span>
      </div>
      ${item.stage ? `<span class="${statusBadgeClass(item.stage)}">${escapeHtml(item.stage)}</span>` : ""}
    </div>`;
    }
    const meta = [item.status, item.company].filter(Boolean).join(" · ");
    return `
    <div class="palette-row" data-index="${index}">
      <div class="palette-row-main">
        <span class="palette-row-title">${escapeHtml(item.name) || "Sans nom"}</span>
        <span class="palette-row-meta">${escapeHtml(meta)}</span>
      </div>
    </div>`;
  }

  // Rejoue le fade-in-vers-le-haut déjà utilisé ailleurs dans l'app (voir
  // setModalBody/setDealBody) à chaque rafraîchissement des résultats — sans
  // retirer puis reforcer un reflow, la classe resterait posée dès le
  // premier rendu et l'animation ne rejouerait jamais aux saisies suivantes.
  function replaySearchDropdownAnimation() {
    els.searchDropdown.classList.remove("fade-in");
    void els.searchDropdown.offsetWidth;
    els.searchDropdown.classList.add("fade-in");
  }

  function renderSearchResults(groups) {
    searchResults = [];
    let html = "";
    groups.forEach((group) => {
      if (!group.items.length) return;
      html += `<div class="palette-group-label">${escapeHtml(group.label)} · ${group.items.length}</div>`;
      group.items.forEach((item) => {
        const index = searchResults.length;
        searchResults.push(item);
        html += renderSearchRow(item, index);
      });
    });
    els.searchDropdown.innerHTML = html || '<p class="palette-empty">Aucun résultat.</p>';
    els.searchDropdown.hidden = false;
    replaySearchDropdownAnimation();
    searchIndex = searchResults.length ? 0 : -1;
    updateSearchActiveRow();
  }

  async function runSpotlightSearch(term) {
    try {
      const [dealsRes, leadsRes, contactsRes] = await Promise.all([
        apiGet(`/deals/search?q=${encodeURIComponent(term)}`).catch(() => ({ deals: [] })),
        apiGet(`/leads/search?q=${encodeURIComponent(term)}`).catch(() => ({ leads: [] })),
        apiGet(`/contacts/search?q=${encodeURIComponent(term)}`).catch(() => ({ leads: [] })),
      ]);
      if (els.search.value.trim() !== term) return; // réponse obsolète, une saisie plus récente est en cours
      const deals = (dealsRes.deals || []).map((d) => ({ ...d, type: "deal" }));
      const leads = (leadsRes.leads || []).map((l) => ({ ...l, type: "lead" }));
      const contacts = (contactsRes.leads || []).map((c) => ({ ...c, type: "contact" }));
      renderSearchResults([
        { label: "Deals", items: deals },
        { label: "Leads et contacts", items: [...leads, ...contacts] },
      ]);
    } catch (err) {
      els.searchDropdown.innerHTML = `<p class="palette-empty">Erreur : ${escapeHtml(err.message)}</p>`;
      els.searchDropdown.hidden = false;
      replaySearchDropdownAnimation();
    }
  }

  function openSearchResult(item) {
    closeMobileSearch(); // no-op sur bureau (overlay déjà fermé)
    hideSearchDropdown();
    els.search.value = "";
    els.clear.hidden = true;
    els.searchKbdHint.hidden = false;
    if (item.type === "deal") {
      openModal();
      openDealDetail(item.id);
    } else {
      openDetailModal(item.id, item.type === "lead" ? "leads" : "contacts");
    }
  }

  els.searchKbdHint.addEventListener("click", () => {
    els.search.focus();
    els.search.select();
  });
  // Recherche mobile en popup : .search-wrap est déplacé physiquement dans
  // la popup à l'ouverture (et réinséré dans la barre d'outils à la
  // fermeture) plutôt que dupliqué — le champ/la logique de recherche
  // existants continuent de fonctionner tel quels, peu importe leur parent
  // du moment.
  const toolbarEl = document.querySelector(".toolbar");
  // Même recette que les autres popups de l'appli (voir openModal/openMenu) :
  // .search-wrap est déplacé physiquement dans la feuille à l'ouverture, puis
  // hidden=false + double rAF + classe "is-open" déclenchent la transition
  // CSS déjà définie sur #mobileSearchPanel (voir style.css) — un essai
  // précédent qui animait la position de la barre du bas à la main (JS) au
  // lieu de laisser une transition CSS faire le travail sur le panneau
  // s'est révélé peu fiable ; on revient donc au mécanisme éprouvé, identique
  // à celui du tiroir de menu.
  function openMobileSearch() {
    if (els.mobileSearchBody && els.searchWrap) {
      els.mobileSearchBody.appendChild(els.searchWrap);
    }
    els.mobileSearchOverlay.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.mobileSearchOverlay.classList.add("is-open");
      });
    });
    setTimeout(() => els.search.focus(), 60);
  }
  function closeMobileSearch() {
    if (els.mobileSearchOverlay.hidden) return;
    els.mobileSearchOverlay.classList.remove("is-open");
    setTimeout(() => {
      els.mobileSearchOverlay.hidden = true;
      if (toolbarEl && els.searchWrap) {
        toolbarEl.insertBefore(els.searchWrap, toolbarEl.firstChild);
      }
    }, 350); // laisse le temps à la feuille de redescendre (transition 0.35s, voir CSS)
  }
  if (els.mobileSearchBtn) {
    els.mobileSearchBtn.addEventListener("click", openMobileSearch);
  }
  if (els.mobileSearchClose) {
    els.mobileSearchClose.addEventListener("click", closeMobileSearch);
  }
  if (els.mobileSearchHandle) {
    els.mobileSearchHandle.addEventListener("click", closeMobileSearch);
  }
  els.mobileSearchOverlay.addEventListener("click", (e) => {
    if (e.target === els.mobileSearchOverlay) closeMobileSearch();
  });

  // Glisser la poignée (ou l'en-tête) vers le bas referme la feuille — portée
  // à cette seule zone plutôt qu'à toute la feuille pour ne pas interférer
  // avec le défilement des résultats dans le corps.
  (function initSheetCloseSwipe() {
    const SHEET_CLOSE_THRESHOLD_PX = 60;
    const SHEET_CLOSE_CANCEL_HORIZONTAL_PX = 40;
    let startX = null;
    let startY = null;
    let tracking = false;
    [els.mobileSearchHandle, els.mobileSearchHeader].forEach((zone) => {
      if (!zone) return;
      zone.addEventListener(
        "pointerdown",
        (e) => {
          if (e.pointerType !== "touch") return;
          startX = e.clientX;
          startY = e.clientY;
          tracking = true;
        },
        { passive: false },
      );
      zone.addEventListener(
        "pointermove",
        (e) => {
          if (!tracking) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          e.preventDefault();
          if (Math.abs(dx) > SHEET_CLOSE_CANCEL_HORIZONTAL_PX && Math.abs(dx) > Math.abs(dy)) {
            tracking = false;
            return;
          }
          if (dy > SHEET_CLOSE_THRESHOLD_PX) {
            tracking = false;
            closeMobileSearch();
          }
        },
        { passive: false },
      );
      zone.addEventListener("pointerup", () => {
        tracking = false;
      });
      zone.addEventListener("pointercancel", () => {
        tracking = false;
      });
    });
  })();

  // Glisser la poignée centrale vers le haut ouvre la feuille de recherche —
  // même recette que le swipe qui ouvre le tiroir de menu (seuil à franchir,
  // pas de suivi 1:1 du doigt) : une fois le seuil dépassé, on déclenche
  // l'ouverture d'un coup et la transition CSS du panneau fait le reste.
  // Portée à la poignée elle-même : c'est là que le pouce doit être posé pour
  // que le geste soit capté. passive:false + preventDefault dès qu'un
  // mouvement est mesuré : sans ça, le navigateur interprète le glissement
  // comme un défilement de page et annule le suivi (pointercancel) avant que
  // le seuil ne soit atteint — la poignée a aussi touch-action:none en CSS
  // pour la même raison.
  (function initSheetOpenSwipe() {
    if (!els.mobileSearchBtn) return;
    const SHEET_OPEN_THRESHOLD_PX = 40;
    const SHEET_OPEN_CANCEL_HORIZONTAL_PX = 40;
    let startX = null;
    let startY = null;
    let tracking = false;
    els.mobileSearchBtn.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch") return;
        if (anyOverlayOpen()) return;
        startX = e.clientX;
        startY = e.clientY;
        tracking = true;
      },
      { passive: false },
    );
    els.mobileSearchBtn.addEventListener(
      "pointermove",
      (e) => {
        if (!tracking) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        e.preventDefault();
        if (Math.abs(dx) > SHEET_OPEN_CANCEL_HORIZONTAL_PX && Math.abs(dx) > Math.abs(dy)) {
          tracking = false;
          return;
        }
        if (dy < -SHEET_OPEN_THRESHOLD_PX) {
          tracking = false;
          openMobileSearch();
        }
      },
      { passive: false },
    );
    els.mobileSearchBtn.addEventListener("pointerup", () => {
      tracking = false;
    });
    els.mobileSearchBtn.addEventListener("pointercancel", () => {
      tracking = false;
    });
  })();
  els.searchDropdown.addEventListener("click", (e) => {
    const row = e.target.closest(".palette-row");
    if (!row) return;
    const item = searchResults[Number(row.getAttribute("data-index"))];
    if (item) openSearchResult(item);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) hideSearchDropdown();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      els.search.focus();
      els.search.select();
      onSearchInput();
      return;
    }
    if (els.searchDropdown.hidden) return;
    if (e.key === "Escape") {
      hideSearchDropdown();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (searchResults.length) {
        searchIndex = (searchIndex + 1) % searchResults.length;
        updateSearchActiveRow();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (searchResults.length) {
        searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length;
        updateSearchActiveRow();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = searchResults[searchIndex];
      if (item) openSearchResult(item);
    }
  });

  // --- Création rapide d'un deal ---
  function renderAndWireDealCreateStages(meta) {
    els.dcStages.innerHTML = renderStagePills(meta.stages, null, dealCreateStage);
    els.dcStages.querySelectorAll(".stage-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        dealCreateStage = btn.getAttribute("data-stage");
        renderAndWireDealCreateStages(meta);
      });
    });
  }

  function updateDealCreateSubmitState() {
    els.dcSubmit.disabled = !dealCreateContact || !els.dcName.value.trim();
  }

  function selectDealCreateContact(id, name, company) {
    dealCreateContact = { id, name, company };
    els.dcContactResults.hidden = true;
    els.dcContactResults.innerHTML = "";
    els.dcContactInput.hidden = true;
    els.dcContactInput.value = "";
    els.dcContactSelected.hidden = false;
    els.dcContactSelected.innerHTML = `
    <div class="palette-row-main">
      <span class="palette-row-title">${escapeHtml(name) || "Sans nom"}</span>
      <span class="palette-row-meta">${escapeHtml(company || "")}</span>
    </div>
    <button type="button" class="dc-contact-clear" title="Changer de contact">×</button>`;
    updateDealCreateSubmitState();
  }

  function clearDealCreateContact() {
    dealCreateContact = null;
    els.dcContactSelected.hidden = true;
    els.dcContactSelected.innerHTML = "";
    els.dcContactInput.hidden = false;
    els.dcContactInput.value = "";
    requestAnimationFrame(() => els.dcContactInput.focus());
    updateDealCreateSubmitState();
  }

  function onDealCreateContactInput() {
    const term = els.dcContactInput.value.trim();
    clearTimeout(dealCreateSearchTimer);
    if (term.length < 2) {
      els.dcContactResults.hidden = true;
      els.dcContactResults.innerHTML = "";
      return;
    }
    dealCreateSearchTimer = setTimeout(async () => {
      try {
        const data = await apiGet(`/contacts/search?q=${encodeURIComponent(term)}`);
        const contacts = data.leads || [];
        els.dcContactResults.innerHTML = contacts.length
          ? contacts
              .slice(0, 8)
              .map(
                (c) => `
    <div class="dc-contact-option" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" data-company="${escapeHtml(c.company)}">
      <span class="palette-row-title">${escapeHtml(c.name) || "Sans nom"}</span>
      <span class="palette-row-meta">${escapeHtml(c.company || "")}</span>
    </div>`,
              )
              .join("")
          : '<p class="palette-empty">Aucun contact trouvé.</p>';
        els.dcContactResults.hidden = false;
      } catch (err) {
        els.dcContactResults.innerHTML = `<p class="palette-empty">Erreur : ${escapeHtml(err.message)}</p>`;
        els.dcContactResults.hidden = false;
      }
    }, 250);
  }

  function openDealCreate() {
    dealCreateContact = null;
    dealCreateStage = null;
    els.dcContactInput.hidden = false;
    els.dcContactInput.value = "";
    els.dcContactResults.hidden = true;
    els.dcContactResults.innerHTML = "";
    els.dcContactSelected.hidden = true;
    els.dcContactSelected.innerHTML = "";
    els.dcName.value = "";
    els.dcAmount.value = "";
    els.dcNextStep.value = "";
    els.dcError.hidden = true;
    els.dcStages.innerHTML = "";
    updateDealCreateSubmitState();

    els.dcOverlay.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.dcOverlay.classList.add("is-open");
      });
    });
    requestAnimationFrame(() => els.dcContactInput.focus());

    ensureDealMeta().then((meta) => {
      dealCreateStage = meta.stages.length ? meta.stages[0].value : null;
      renderAndWireDealCreateStages(meta);
    });
  }

  function closeDealCreate() {
    if (els.dcOverlay.hidden) return;
    els.dcOverlay.classList.remove("is-open");
    let done = false;
    const panel = els.dcOverlay.querySelector(".modal-panel");
    const finish = () => {
      if (done) return;
      done = true;
      els.dcOverlay.hidden = true;
    };
    panel.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 500);
  }

  async function submitDealCreate() {
    if (!dealCreateContact || !els.dcName.value.trim()) return;
    els.dcSubmit.disabled = true;
    els.dcError.hidden = true;
    try {
      const payload = {
        contactId: dealCreateContact.id,
        dealName: els.dcName.value.trim(),
        stage: dealCreateStage || undefined,
        amount: els.dcAmount.value.trim() || undefined,
        nextStep: els.dcNextStep.value.trim() || undefined,
      };
      const data = await apiSend("POST", "/deals", payload);
      closeDealCreate();
      // Ouvre directement la fiche du deal fraîchement créé.
      openModal();
      openDealDetail(data.id);
    } catch (err) {
      els.dcSubmit.disabled = false;
      els.dcError.textContent = `Erreur : ${err.message}`;
      els.dcError.hidden = false;
    }
  }

  els.dealCreateBtn.addEventListener("click", () => {
    if (currentView === "deals") openDealCreate();
    else openQuickCreate(currentView);
  });
  els.dcClose.addEventListener("click", closeDealCreate);
  els.dcCancel.addEventListener("click", closeDealCreate);
  els.dcOverlay.addEventListener("click", (e) => {
    if (e.target === els.dcOverlay) closeDealCreate();
  });
  els.dcName.addEventListener("input", updateDealCreateSubmitState);
  els.dcContactInput.addEventListener("input", onDealCreateContactInput);
  els.dcContactResults.addEventListener("click", (e) => {
    const opt = e.target.closest(".dc-contact-option");
    if (!opt) return;
    selectDealCreateContact(
      opt.getAttribute("data-id"),
      opt.getAttribute("data-name"),
      opt.getAttribute("data-company"),
    );
  });
  els.dcContactSelected.addEventListener("click", (e) => {
    if (e.target.closest(".dc-contact-clear")) clearDealCreateContact();
  });
  els.dcSubmit.addEventListener("click", submitDealCreate);

  // --- Création rapide d'un lead ou d'un contact (formulaire commun) ---
  let quickCreateModule = null; // "leads" | "contacts"

  function updateQuickCreateSubmitState() {
    const lastNameOk = els.qcLastName.value.trim();
    const companyOk = quickCreateModule !== "leads" || els.qcCompany.value.trim();
    els.qcSubmit.disabled = !lastNameOk || !companyOk;
  }

  function openQuickCreate(module) {
    quickCreateModule = module;
    els.qcFirstName.value = "";
    els.qcLastName.value = "";
    els.qcCompany.value = "";
    els.qcEmail.value = "";
    els.qcPhone.value = "";
    els.qcError.hidden = true;
    els.qcCompanyField.hidden = module !== "leads";
    els.qcTitle.textContent = module === "leads" ? "Nouveau lead" : "Nouveau contact";
    updateQuickCreateSubmitState();

    els.qcOverlay.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.qcOverlay.classList.add("is-open");
      });
    });
    requestAnimationFrame(() => els.qcFirstName.focus());
  }

  function closeQuickCreate() {
    if (els.qcOverlay.hidden) return;
    els.qcOverlay.classList.remove("is-open");
    let done = false;
    const panel = els.qcOverlay.querySelector(".modal-panel");
    const finish = () => {
      if (done) return;
      done = true;
      els.qcOverlay.hidden = true;
    };
    panel.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 500);
  }

  async function submitQuickCreate() {
    if (els.qcSubmit.disabled) return;
    els.qcSubmit.disabled = true;
    els.qcError.hidden = true;
    try {
      const payload = {
        lastName: els.qcLastName.value.trim(),
        firstName: els.qcFirstName.value.trim() || undefined,
        email: els.qcEmail.value.trim() || undefined,
        phone: els.qcPhone.value.trim() || undefined,
      };
      if (quickCreateModule === "leads") payload.company = els.qcCompany.value.trim();
      const path = quickCreateModule === "leads" ? "/leads" : "/contacts";
      const data = await apiSend("POST", path, payload);
      closeQuickCreate();
      showToast(quickCreateModule === "leads" ? "Lead créé" : "Contact créé");
      if (currentView === quickCreateModule) loadRecords();
      openDetailModal(data.id, quickCreateModule);
    } catch (err) {
      els.qcSubmit.disabled = false;
      els.qcError.textContent = `Erreur : ${err.message}`;
      els.qcError.hidden = false;
    }
  }

  els.qcClose.addEventListener("click", closeQuickCreate);
  els.qcCancel.addEventListener("click", closeQuickCreate);
  els.qcOverlay.addEventListener("click", (e) => {
    if (e.target === els.qcOverlay) closeQuickCreate();
  });
  els.qcLastName.addEventListener("input", updateQuickCreateSubmitState);
  els.qcCompany.addEventListener("input", updateQuickCreateSubmitState);
  els.qcSubmit.addEventListener("click", submitQuickCreate);

  // --- Menu + thèmes ---
  const THEME_STORAGE_KEY = "toolyTheme";
  const THEMES = [
    {
      id: "tooly",
      name: "Tooly",
      tagline: "La charte officielle — magenta signature",
      swatch: ["#c000a9", "#840073", "#00cece"],
    },
    {
      id: "jaune",
      name: "Jaune",
      tagline: "Variante officielle Tooly — optimisme et vivacité",
      swatch: ["#6f6107", "#ffe924", "#00cece"],
    },
    {
      id: "bleu",
      name: "Bleu",
      tagline: "Variante officielle Tooly — clarté et fiabilité",
      swatch: ["#005555", "#00cece", "#ff482f"],
    },
    {
      id: "rouge",
      name: "Rouge",
      tagline: "Variante officielle Tooly — passion et détermination",
      swatch: ["#ba301e", "#ff482f", "#00cece"],
    },
    {
      id: "macchiato",
      name: "Macchiato",
      tagline: "Doux et feutré, pour les longues sessions",
      swatch: ["#8839ef", "#24273a", "#00cece"],
    },
    {
      id: "cappuccino",
      name: "Cappuccino",
      tagline: "Chaleureux et clair, comme un café du matin",
      swatch: ["#b5622b", "#f7ede1", "#00cece"],
    },
    {
      id: "tokyo",
      name: "Tokyo",
      tagline: "Nocturne et électrique",
      swatch: ["#3f59a8", "#16161e", "#00cece"],
    },
  ];
  // Thème secret : caché de la grille tant qu'il n'est pas débloqué (voir
  // LIQUID_GLASS_SEQUENCE ci-dessous). Une fois débloqué, le déverrouillage
  // est mémorisé pour rester acquis d'une session à l'autre.
  const LIQUID_GLASS_THEME = {
    id: "liquid-glass",
    name: "Liquid Glass",
    tagline: "Thème secret — verre dépoli et reflets translucides",
    swatch: ["#a8d8ff", "#eaf6ff", "#00cece"],
  };
  const LIQUID_GLASS_UNLOCK_KEY = "toolyLiquidGlassUnlocked";
  const LIQUID_GLASS_SEQUENCE = ["tokyo", "macchiato", "tokyo", "cappuccino"];
  let themeClickHistory = [];
  function isLiquidGlassUnlocked() {
    try {
      return localStorage.getItem(LIQUID_GLASS_UNLOCK_KEY) === "1";
    } catch (e) {
      return false;
    }
  }
  function unlockLiquidGlass() {
    try {
      localStorage.setItem(LIQUID_GLASS_UNLOCK_KEY, "1");
    } catch (e) {
      // stockage indisponible (navigation privée…) : reste débloqué pour la session
    }
  }
  function visibleThemes() {
    return isLiquidGlassUnlocked() ? THEMES.concat(LIQUID_GLASS_THEME) : THEMES;
  }

  function renderThemeGrid(activeId) {
    els.themeGrid.innerHTML = visibleThemes().map(
      (t) => `
    <button type="button" class="theme-card${t.id === activeId ? " is-active" : ""}" data-theme-id="${t.id}">
      <span class="theme-swatch">${t.swatch.map((c) => `<span style="background:${c}"></span>`).join("")}</span>
      <span class="theme-card-text">
        <span class="theme-card-name">${escapeHtml(t.name)}</span>
        <span class="theme-card-tagline">${escapeHtml(t.tagline)}</span>
      </span>
      <span class="theme-card-check">✓</span>
    </button>`,
    ).join("");
  }

  function applyTheme(id) {
    document.documentElement.setAttribute("data-theme", id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch (e) {
      // stockage indisponible (navigation privée…) : le thème reste actif pour la session
    }
    renderThemeGrid(id);
  }

  function loadStoredTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || "tooly";
    } catch (e) {
      return "tooly";
    }
  }

  // Menu principal <-> Personnalisation, même principe de retour que la vue
  // affaire de la popup de détail (showBackButton/hideBackButton).
  function showDrawerMenu() {
    els.drawerViews.classList.remove("show-theme");
    els.drawerTitle.textContent = "Menu";
    els.drawerBack.classList.remove("is-visible");
    setTimeout(() => {
      els.drawerBack.hidden = true;
    }, 200);
  }
  function showDrawerTheme() {
    els.drawerViews.classList.add("show-theme");
    els.drawerTitle.textContent = "Personnalisation";
    els.drawerBack.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.drawerBack.classList.add("is-visible");
      });
    });
  }

  function openMenu() {
    if (!els.drawerOverlay.hidden) return;
    showDrawerMenu();
    els.drawerOverlay.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.drawerOverlay.classList.add("is-open");
      });
    });
  }

  function closeMenu() {
    if (els.drawerOverlay.hidden) return;
    els.drawerOverlay.classList.remove("is-open");
    let done = false;
    const panel = els.drawerOverlay.querySelector(".drawer-panel");
    const finish = () => {
      if (done) return;
      done = true;
      els.drawerOverlay.hidden = true;
    };
    panel.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 500);
  }

  els.menuBtn.addEventListener("click", openMenu);
  els.drawerClose.addEventListener("click", closeMenu);
  els.drawerBack.addEventListener("click", showDrawerMenu);
  els.drawerOverlay.addEventListener("click", (e) => {
    if (e.target === els.drawerOverlay) closeMenu();
  });
  els.menuPersonalization.addEventListener("click", showDrawerTheme);
  els.menuCreateDeal.addEventListener("click", () => {
    closeMenu();
    openDealCreate();
  });
  els.menuCreateLead.addEventListener("click", () => {
    closeMenu();
    openQuickCreate("leads");
  });
  els.menuCreateContact.addEventListener("click", () => {
    closeMenu();
    openQuickCreate("contacts");
  });

  // Le pictogramme et le bouton burger sont retirés du bandeau sur mobile
  // (voir CSS, faute de place à côté du titre) : le menu s'ouvre à la place
  // par un balayage vers la gauche (le tiroir vient de la droite), uniquement
  // sous 620px. Volontairement
  // PAS ancré au bord de l'écran (comme un premier essai) : sur Android en
  // navigation gestuelle (sans bouton), le système capte lui-même tout
  // balayage démarré dans la bande de bord pour son propre geste "retour",
  // avant même que la page ne reçoive l'événement. La zone de départ exclut
  // donc une marge de sécurité de chaque côté et fonctionne sur le reste de
  // l'écran — comme le tiroir de navigation de nombreuses apps mobiles.
  const SWIPE_EDGE_MARGIN_PX = 32;
  const SWIPE_OPEN_THRESHOLD_PX = 70;
  const SWIPE_CANCEL_VERTICAL_PX = 40;
  const SWIPE_IGNORE_SELECTOR = "input, textarea, select, button, a, [role='button']";
  let swipeStartX = null;
  let swipeStartY = null;
  let swipeTracking = false;
  function anyOverlayOpen() {
    return (
      !els.drawerOverlay.hidden ||
      !els.modalOverlay.hidden ||
      !els.miniDialogOverlay.hidden ||
      !els.dcOverlay.hidden ||
      !els.mobileSearchOverlay.hidden ||
      !els.qcOverlay.hidden
    );
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      if (!window.matchMedia("(max-width: 620px)").matches) return;
      if (anyOverlayOpen()) return;
      if (e.target.closest(SWIPE_IGNORE_SELECTOR)) return;
      if (e.clientX < SWIPE_EDGE_MARGIN_PX || e.clientX > window.innerWidth - SWIPE_EDGE_MARGIN_PX) return;
      swipeStartX = e.clientX;
      swipeStartY = e.clientY;
      swipeTracking = true;
    },
    { passive: false },
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!swipeTracking) return;
      const dx = e.clientX - swipeStartX;
      const dy = e.clientY - swipeStartY;
      if (Math.abs(dy) > SWIPE_CANCEL_VERTICAL_PX && Math.abs(dy) > Math.abs(dx)) {
        swipeTracking = false; // défilement vertical : pas une intention d'ouverture
        return;
      }
      // Dès que l'intention est clairement horizontale, on annule l'événement :
      // sans ça, Firefox pour Android interprète le même geste comme sa propre
      // navigation retour/avant et le page ne le reçoit jamais jusqu'au bout.
      if (Math.abs(dx) > 10) e.preventDefault();
      if (dx < -SWIPE_OPEN_THRESHOLD_PX) {
        swipeTracking = false;
        openMenu();
      }
    },
    { passive: false },
  );
  document.addEventListener("pointerup", () => {
    swipeTracking = false;
  });
  document.addEventListener("pointercancel", () => {
    swipeTracking = false;
  });

  // Barre Leads/Contacts + bulle "Nouveau deal" façon X (Twitter) sur mobile :
  // se dérobent au même rythme que le scroll descendant (la barre glisse
  // vers le bas, la bulle rétrécit et s'estompe), et reviennent au même
  // rythme dès qu'on remonte — piloté en style inline à chaque frame, calé
  // 1:1 sur la distance scrollée (pas un simple show/hide déclenché à un
  // seuil), pour un vrai effet qui suit le doigt. Un seul accumulateur de
  // scroll partagé pour que les deux restent synchronisés. Uniquement sous
  // 620px : au-delà, les deux restent dans le bandeau/la barre d'outils (voir
  // CSS) et ces transformations ne doivent rien faire.
  (function initMobileScrollHide() {
    const bar = els.viewToggle;
    const fab = els.dealCreateBtn;
    if (!bar) return;
    let lastScrollY = window.scrollY;
    let hideOffset = 0;
    let barHeight = bar.getBoundingClientRect().height || 64;
    let ticking = false;

    function positionFab() {
      if (fab) fab.style.bottom = `${barHeight + 16}px`;
    }

    function update() {
      ticking = false;
      if (!window.matchMedia("(max-width: 620px)").matches) {
        bar.style.transform = "";
        if (fab) {
          fab.style.transform = "";
          fab.style.opacity = "";
          fab.style.pointerEvents = "";
        }
        lastScrollY = window.scrollY;
        hideOffset = 0;
        return;
      }
      const y = Math.max(0, window.scrollY);
      const delta = y - lastScrollY;
      lastScrollY = y;
      hideOffset = Math.min(barHeight, Math.max(0, hideOffset + delta));
      if (y < 8) hideOffset = 0; // toujours visible tout en haut de la liste
      bar.style.transform = `translateY(${hideOffset}px)`;
      if (fab) {
        const progress = barHeight ? hideOffset / barHeight : 0;
        fab.style.transform = `scale(${1 - progress})`;
        fab.style.opacity = String(1 - progress);
        fab.style.pointerEvents = progress > 0.9 ? "none" : "";
      }
    }

    window.addEventListener("resize", () => {
      if (!window.matchMedia("(max-width: 620px)").matches) {
        bar.style.transform = "";
        hideOffset = 0;
      }
      barHeight = bar.getBoundingClientRect().height || barHeight;
      positionFab();
      lastScrollY = window.scrollY;
    });
    positionFab();
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
      },
      { passive: true },
    );
  })();

  els.themeGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".theme-card");
    if (!card) return;
    const id = card.getAttribute("data-theme-id");
    applyTheme(id);

    // Easter egg : tokyo → macchiato → tokyo → cappuccino débloque le thème
    // secret "Liquid Glass". Le suivi ne compte que les clics volontaires
    // dans la grille (pas la restauration du thème au chargement de la page).
    if (!isLiquidGlassUnlocked()) {
      themeClickHistory.push(id);
      if (themeClickHistory.length > LIQUID_GLASS_SEQUENCE.length) themeClickHistory.shift();
      if (themeClickHistory.join(",") === LIQUID_GLASS_SEQUENCE.join(",")) {
        unlockLiquidGlass();
        themeClickHistory = [];
        applyTheme("liquid-glass");
        showToast("Thème secret débloqué : Liquid Glass ✨");
      }
    }
  });

  applyTheme(loadStoredTheme());

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

  // --- Bascule de vue ---
  function switchView(view) {
    if (view === currentView) return;
    currentView = view;
    const cfg = VIEWS[view];

    // Onglets actifs
    els.btnLeads.classList.toggle("active", view === "leads");
    els.btnContacts.classList.toggle("active", view === "contacts");
    if (els.btnDeals) els.btnDeals.classList.toggle("active", view === "deals");
    els.btnLeads.setAttribute("aria-selected", view === "leads");
    els.btnContacts.setAttribute("aria-selected", view === "contacts");
    if (els.btnDeals) els.btnDeals.setAttribute("aria-selected", view === "deals");

    // Libellés dynamiques
    if (els.statLabel) els.statLabel.textContent = cfg.statLabel;
    if (els.colStatut) els.colStatut.textContent = cfg.colStatut;
    if (els.colSociete) els.colSociete.textContent = cfg.colSociete;
    if (els.colCol3) els.colCol3.textContent = cfg.col3 === "amount" ? "Montant" : "Email";
    if (els.colCol4) els.colCol4.textContent = cfg.col4 === "closingDate" ? "Clôture prévue" : "Téléphone";
    if (els.dealCreateBtnLabel) els.dealCreateBtnLabel.textContent = cfg.createLabel;

    // Réinitialisation
    els.search.value = "";
    els.clear.hidden = true;
    els.searchKbdHint.hidden = false;
    hideSearchDropdown();
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
    els.searchKbdHint.hidden = !!term;
    clearTimeout(searchTimer);
    if (term.length < 2) {
      hideSearchDropdown();
      return;
    }
    searchTimer = setTimeout(() => runSpotlightSearch(term), 250);
  }

  // --- Événements ---
  els.search.addEventListener("input", onSearchInput);
  els.clear.addEventListener("click", () => {
    els.search.value = "";
    els.clear.hidden = true;
    els.searchKbdHint.hidden = false;
    hideSearchDropdown();
  });
  els.status.addEventListener("change", () => render(allRecords));
  if (els.btnLeads)
    els.btnLeads.addEventListener("click", () => switchView("leads"));
  if (els.btnContacts)
    els.btnContacts.addEventListener("click", () => switchView("contacts"));
  if (els.btnDeals)
    els.btnDeals.addEventListener("click", () => switchView("deals"));

  // --- Démarrage ---
  if (!BASE || BASE.includes("REMPLACER")) {
    els.errorMsg.textContent =
      "Configure FUNCTION_BASE_URL dans js/config.js avec l'URL de ta fonction Catalyst.";
    showState("error");
  } else {
    loadRecords();
  }
})();
