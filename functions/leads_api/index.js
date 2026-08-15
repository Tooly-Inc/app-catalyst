"use strict";

/**
 * Advanced I/O Function — Leads API proxy for the CRM dashboard widget.
 *
 *   GET  /leads_api/leads          -> liste paginée des leads
 *   GET  /leads_api/leads/search   -> recherche (nom, société, email, tél, statut)
 *   GET  /leads_api/health         -> healthcheck
 *
 * Les credentials OAuth sont lus depuis les variables d'environnement Catalyst
 * (Console > Settings > Environment Variables). NE PAS les committer sur GitHub.
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const catalyst = require("zcatalyst-sdk-node");

const app = express();
app.use(express.json());
app.use(cors());

// --- Configuration (variables d'environnement Catalyst) ---------------------
// Datacenter EUROPE (.eu) par défaut, adapté à ton org.
const ACCOUNTS_HOST =
  process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.eu";
const API_HOST = process.env.ZOHO_API_HOST || "https://www.zohoapis.eu";
const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;

const LEAD_FIELDS = [
  "Last_Name",
  "First_Name",
  "Full_Name",
  "Company",
  "Email",
  "Phone",
  "Lead_Status",
  "Lead_Source",
  "Owner",
  "Created_Time",
];

// URL de base du CRM pour construire les liens vers les fiches.
const CRM_BASE_URL = process.env.ZOHO_CRM_BASE_URL || "https://crm.zoho.eu";
const CRM_ORG_ID = process.env.ZOHO_CRM_ORG_ID || "";

// --- Gestion du token (cache mémoire, ~55 min) ------------------------------
let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) return cachedToken;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error(
      "Credentials OAuth manquants. Configure ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET et ZOHO_REFRESH_TOKEN.",
    );
  }
  const params = new URLSearchParams({
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const { data } = await axios.post(
    `${ACCOUNTS_HOST}/oauth/v2/token`,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  if (!data.access_token) {
    throw new Error(
      "Réponse OAuth sans access_token : " + JSON.stringify(data),
    );
  }
  cachedToken = data.access_token;
  cachedTokenExpiry = now + (data.expires_in - 300) * 1000;
  return cachedToken;
}

async function crmRequest(path, query = {}) {
  const token = await getAccessToken();
  const { data } = await axios.get(`${API_HOST}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    params: query,
    validateStatus: (s) => s < 500,
  });
  return data;
}

// Appel d'écriture générique (PUT/POST/DELETE) — crmRequest ne fait que du GET.
async function crmWrite(method, path, body) {
  const token = await getAccessToken();
  const { data } = await axios({
    method,
    url: `${API_HOST}${path}`,
    data: body,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    validateStatus: (s) => s < 500,
  });
  return data;
}

// Vérifie qu'un appel d'écriture Zoho CRM (data[0].status === "success") a réussi ;
// sinon relaie le message d'erreur du CRM plutôt qu'un succès trompeur.
function assertCrmWriteOk(data, fallbackMessage) {
  const entry = data && Array.isArray(data.data) && data.data[0];
  if (!entry || entry.status !== "success") {
    const detail = (entry && entry.message) || JSON.stringify(data);
    throw new Error(`${fallbackMessage} : ${detail}`);
  }
  return entry;
}

// +n jours ouvrables (saute samedi/dimanche), à partir de maintenant.
function addBusinessDays(n) {
  const d = new Date();
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

// Crée une tâche de relance CRM pour un deal (échéance : +3 jours ouvrables,
// liée au deal et, si connu, au contact). Utilisée par la route dédiée et par
// l'enchaînement optionnel depuis la mise à jour rapide.
async function createRelance(dealId, dealRecord) {
  const contactId = dealRecord.Contact_Name && dealRecord.Contact_Name.id;
  const contactName = dealRecord.Contact_Name && dealRecord.Contact_Name.name;
  const ownerId = dealRecord.Owner && dealRecord.Owner.id;
  const dealName = dealRecord.Deal_Name || "cette affaire";
  const dueDate = addBusinessDays(3);
  const subject = contactName
    ? `Relancer ${contactName} — ${dealName}`
    : `Relancer — ${dealName}`;

  const task = {
    Subject: subject,
    Due_Date: dueDate.toISOString().slice(0, 10),
    What_Id: dealId,
    $se_module: "Deals",
  };
  if (contactId) task.Who_Id = contactId;
  if (ownerId) task.Owner = { id: ownerId };

  const data = await crmWrite("POST", "/crm/v6/Tasks", { data: [task] });
  const entry = assertCrmWriteOk(data, "Échec de la création de la relance");
  return {
    id: entry.details && entry.details.id,
    dueDate: task.Due_Date,
    subject,
  };
}

// Récupère et met en cache (~1h) les valeurs réelles des picklists Stage et
// Reason_For_Loss__s : le pipeline et les raisons de perte sont propres à
// chaque org CRM, on ne peut pas les coder en dur.
let cachedDealsMeta = null;
let cachedDealsMetaExpiry = 0;
async function getDealsMeta() {
  const now = Date.now();
  if (cachedDealsMeta && now < cachedDealsMetaExpiry) return cachedDealsMeta;
  const data = await crmRequest("/crm/v6/settings/fields", { module: "Deals" });
  const fields = (data && data.fields) || [];
  const pick = (apiName) => {
    const f = fields.find((x) => x.api_name === apiName);
    const values = (f && f.pick_list_values) || [];
    return values
      .slice()
      .sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0))
      .map((v) => ({ value: v.actual_value, label: v.display_value || v.actual_value }));
  };
  cachedDealsMeta = { stages: pick("Stage"), reasons: pick("Reason_For_Loss__s") };
  cachedDealsMetaExpiry = now + 60 * 60 * 1000;
  return cachedDealsMeta;
}

// Construit l'URL de la fiche CRM pour un module et un id donnés (fallback sans
// org : CRM résout souvent quand même).
function buildCrmUrl(module, id) {
  if (!id) return "";
  return CRM_ORG_ID
    ? `${CRM_BASE_URL}/crm/org${CRM_ORG_ID}/tab/${module}/${id}`
    : `${CRM_BASE_URL}/crm/tab/${module}/${id}`;
}

function mapLead(record) {
  const id = record.id;
  const crmUrl = buildCrmUrl("Leads", id);
  return {
    id,
    crmUrl,
    name:
      record.Full_Name ||
      `${record.First_Name || ""} ${record.Last_Name || ""}`.trim(),
    company: record.Company || "",
    email: record.Email || "",
    phone: record.Phone || "",
    status: record.Lead_Status || "",
    source: record.Lead_Source || "",
    owner: record.Owner ? record.Owner.name : "",
    createdTime: record.Created_Time || "",
  };
}

// --- Fiche détail : formatage générique d'un enregistrement CRM -------------
const DETAIL_LABELS = {
  Full_Name: "Nom complet",
  Company: "Société",
  Account_Name: "Compte",
  Email: "Email",
  Phone: "Téléphone",
  Mobile: "Mobile",
  Lead_Status: "Statut",
  Lead_Source: "Source",
  Title: "Poste",
  Department: "Département",
  Owner: "Propriétaire",
  Industry: "Secteur",
  Website: "Site web",
  Description: "Description",
  Mailing_Street: "Adresse",
  Mailing_City: "Ville",
  Mailing_State: "Province / État",
  Mailing_Zip: "Code postal",
  Mailing_Country: "Pays",
  Created_Time: "Créé le",
  Modified_Time: "Modifié le",
  Amount: "Montant",
  Closing_Date: "Date de clôture",
  Probability: "Probabilité",
  Contact_Name: "Contact",
  Type: "Type",
  Reason_For_Loss__s: "Raison de perte",
  Next_Step: "Prochaine étape",
};

const DETAIL_EXCLUDE = new Set([
  "id",
  "Created_By",
  "Modified_By",
  "Layout",
  "Tag",
  "Last_Activity_Time",
]);

function formatDetailValue(key, value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      const parts = value
        .map((v) => (v && typeof v === "object" ? v.name || v.Name : v))
        .filter(Boolean);
      return parts.length ? parts.join(", ") : null;
    }
    if (value.name) return value.name;
    if (value.Name) return value.Name;
    return null; // objet imbriqué non représentable simplement
  }
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (/_Time$/.test(key) && typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleString("fr-CA");
  }
  return String(value);
}

// Regroupement des champs par section, à la manière d'une fiche CRM
const GROUP_ORDER = ["Entreprise", "Coordonnées", "Suivi", "Autres informations"];
const FIELD_GROUPS = {
  Company: "Entreprise",
  Account_Name: "Entreprise",
  Title: "Entreprise",
  Department: "Entreprise",
  Industry: "Entreprise",
  Website: "Entreprise",
  Email: "Coordonnées",
  Phone: "Coordonnées",
  Mobile: "Coordonnées",
  Mailing_Street: "Coordonnées",
  Mailing_City: "Coordonnées",
  Mailing_State: "Coordonnées",
  Mailing_Zip: "Coordonnées",
  Mailing_Country: "Coordonnées",
  Lead_Status: "Suivi",
  Lead_Source: "Suivi",
  Owner: "Suivi",
  Description: "Suivi",
  Created_Time: "Suivi",
  Modified_Time: "Suivi",
  Amount: "Suivi",
  Closing_Date: "Suivi",
  Probability: "Suivi",
  Contact_Name: "Entreprise",
  Type: "Suivi",
  Reason_For_Loss__s: "Suivi",
  Next_Step: "Suivi",
};

// Transforme un enregistrement CRM brut en sections { name, fields: [{ label, value }] }
// titleKey/subtitleKey sont déjà affichés dans l'en-tête du popup et donc exclus de la liste.
function buildDetailGroups(record, { titleKey, subtitleKey } = {}) {
  if (!record) return [];
  const skip = new Set([titleKey, subtitleKey].filter(Boolean));
  const buckets = {};
  const seen = new Set();

  const pushField = (key, label) => {
    if (seen.has(key) || skip.has(key) || DETAIL_EXCLUDE.has(key) || key.startsWith("$")) return;
    seen.add(key);
    const val = formatDetailValue(key, record[key]);
    if (val === null) return;
    const group = FIELD_GROUPS[key] || "Autres informations";
    (buckets[group] = buckets[group] || []).push({ label, value: val });
  };

  Object.keys(DETAIL_LABELS).forEach((key) => {
    if (key in record) pushField(key, DETAIL_LABELS[key]);
  });
  Object.keys(record).forEach((key) => pushField(key, key.replace(/_/g, " ")));

  return GROUP_ORDER.filter((g) => buckets[g] && buckets[g].length).map((g) => ({
    name: g,
    fields: buckets[g],
  }));
}

// --- Routes -----------------------------------------------------------------
// app.get("/leads", async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const perPage = Math.min(parseInt(req.query.per_page, 10) || 50, 200);
//     const data = await crmRequest("/crm/v6/Leads", {
//       fields: LEAD_FIELDS.join(","),
//       page,
//       per_page: perPage,
//       sort_by: "Created_Time",
//       sort_order: "desc",
//     });
//     const records = (data && data.data) || [];
//     res.status(200).json({
//       leads: records.map(mapLead),
//       info: (data && data.info) || { more_records: false },
//     });
//   } catch (err) {
//     console.error("GET /leads error:", err.message);
//     res.status(500).json({
//       error: "Impossible de récupérer les leads.",
//       detail: err.message,
//     });
//   }
// });

// app.get("/leads/search", async (req, res) => {
//   try {
//     const { q, field, value } = req.query;
//     const params = { fields: LEAD_FIELDS.join(","), per_page: 200 };

//     if (field && value) {
//       params.criteria = `(${field}:starts_with:${value})`;
//     } else if (q && q.trim()) {
//       const term = q.trim();
//       const searchable = [
//         "Last_Name",
//         "First_Name",
//         "Company",
//         "Email",
//         "Phone",
//         "Lead_Status",
//       ];
//       params.criteria =
//         "(" +
//         searchable.map((f) => `(${f}:starts_with:${term})`).join("or") +
//         ")";
//     } else {
//       return res
//         .status(400)
//         .json({ error: "Paramètre 'q' ou 'field'+'value' requis." });
//     }

//     const data = await crmRequest("/crm/v6/Leads/search", params);
//     const records = (data && data.data) || [];
//     res.status(200).json({
//       leads: records.map(mapLead),
//       info: (data && data.info) || { count: records.length },
//     });
//   } catch (err) {
//     console.error("GET /leads/search error:", err.message);
//     res
//       .status(500)
//       .json({ error: "La recherche a échoué.", detail: err.message });
//   }
// });

// Liste : lit le Data Store, plus le CRM
app.get("/leads", async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const zcql = app.zcql();
    const rows = await zcql.executeZCQLQuery(
      "SELECT crm_id, name, company, email, phone, status FROM Leads_Cache ORDER BY crm_created_time DESC LIMIT 200",
    );
    const leads = rows.map((r) => {
      const id = r.Leads_Cache.crm_id;
      return {
        id,
        name: r.Leads_Cache.name,
        company: r.Leads_Cache.company,
        email: r.Leads_Cache.email,
        phone: r.Leads_Cache.phone,
        status: r.Leads_Cache.status,
      };
    });
    res.status(200).json({ leads });
  } catch (err) {
    res.status(500).json({ error: "Erreur Data Store", detail: err.message });
  }
});

// Recherche leads (depuis Data Store)
app.get("/leads/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim().replace(/'/g, "''");
    if (!q) return res.status(400).json({ error: "Paramètre 'q' requis." });
    const app = catalyst.initialize(req);
    const zcql = app.zcql();
    const rows = await zcql.executeZCQLQuery(
      `SELECT crm_id, name, company, email, phone, status FROM Leads_Cache WHERE name LIKE '*${q}*' OR company LIKE '*${q}*' OR email LIKE '*${q}*' OR phone LIKE '*${q}*' OR status LIKE '*${q}*' LIMIT 200`
    );
    const leads = rows.map((r) => {
      const id = r.Leads_Cache.crm_id;
      return {
        id,
        name: r.Leads_Cache.name,
        company: r.Leads_Cache.company,
        email: r.Leads_Cache.email,
        phone: r.Leads_Cache.phone,
        status: r.Leads_Cache.status,
      };
    });
    res.status(200).json({ leads });
  } catch (err) {
    res.status(500).json({ error: "Erreur recherche leads", detail: err.message });
  }
});

// Détail : appel CRM à la demande (fiche fraîche)
app.get("/leads/detail/:id", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { data } = await axios.get(
      `${API_HOST}/crm/v6/Leads/${req.params.id}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      },
    );
    const record = (data && data.data && data.data[0]) || null;
    const id = (record && record.id) || req.params.id;
    res.status(200).json({
      title: record ? record.Full_Name || record.Company || "Lead" : "Lead",
      subtitle: record ? record.Company || "" : "",
      crmUrl: buildCrmUrl("Leads", id),
      groups: buildDetailGroups(record, { titleKey: "Full_Name", subtitleKey: "Company" }),
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur détail CRM", detail: err.message });
  }
});

// Récupère les deals associés à un contact, par correspondance de nom
async function findDealsForContact(app, contactName) {
  if (!contactName) return [];
  const escaped = contactName.replace(/'/g, "''");
  const zcql = app.zcql();
  const rows = await zcql.executeZCQLQuery(
    `SELECT crm_id, Deal_Name, Stage, type, account_name, Reason_For_Loss, amount, closing_date, next_step FROM Deals_Cache WHERE contact_name = '${escaped}' LIMIT 50`,
  );
  return rows.map((r) => {
    const crmId = r.Deals_Cache.crm_id;
    return {
      id: crmId,
      name: r.Deals_Cache.Deal_Name,
      stage: r.Deals_Cache.Stage,
      type: r.Deals_Cache.type,
      accountName: r.Deals_Cache.account_name,
      reasonForLoss: r.Deals_Cache.Reason_For_Loss,
      amount: r.Deals_Cache.amount,
      closingDate: r.Deals_Cache.closing_date,
      nextStep: r.Deals_Cache.next_step,
      crmUrl: buildCrmUrl("Deals", crmId),
    };
  });
}

// Forme de réponse partagée entre /deals/detail/:id et PATCH /deals/:id : les
// champs bruts (stage/amount/nextStep/reasonForLoss) permettent au formulaire
// de mise à jour rapide de démarrer sans reparser le texte déjà formaté des
// groupes de détail.
function buildDealDetail(record, id) {
  return {
    title: record ? record.Deal_Name || "Affaire" : "Affaire",
    subtitle: record ? record.Stage || "" : "",
    stage: record ? record.Stage || "" : "",
    amount: record && record.Amount != null ? record.Amount : null,
    nextStep: record ? record.Next_Step || "" : "",
    reasonForLoss: record ? record.Reason_For_Loss__s || "" : "",
    crmUrl: buildCrmUrl("Deals", id),
    groups: buildDetailGroups(record, { titleKey: "Deal_Name", subtitleKey: "Stage" }),
  };
}

// Détail affaire : appel CRM à la demande, affiché comme second volet de la popup
app.get("/deals/detail/:id", async (req, res) => {
  try {
    const data = await crmRequest(`/crm/v6/Deals/${req.params.id}`);
    const record = (data && data.data && data.data[0]) || null;
    const id = (record && record.id) || req.params.id;
    res.status(200).json(buildDealDetail(record, id));
  } catch (err) {
    res.status(500).json({ error: "Erreur détail affaire CRM", detail: err.message });
  }
});

// Métadonnées deals : pipeline (Stage) et raisons de perte réels de l'org.
app.get("/deals/meta", async (_req, res) => {
  try {
    const meta = await getDealsMeta();
    res.status(200).json(meta);
  } catch (err) {
    res.status(500).json({ error: "Erreur métadonnées deals", detail: err.message });
  }
});

// Création rapide d'un deal (fiche simplifiée), lié à un contact existant.
app.post("/deals", async (req, res) => {
  try {
    const { contactId, dealName, stage, amount, nextStep } = req.body || {};
    if (!contactId || !dealName || !dealName.trim()) {
      return res.status(400).json({ error: "Paramètres 'contactId' et 'dealName' requis." });
    }

    // Récupère le contact en direct : Account_Name (souvent obligatoire pour un
    // deal) n'est pas dans Contacts_Cache, et Full_Name sert au cache local.
    const contactData = await crmRequest(`/crm/v6/Contacts/${contactId}`);
    const contactRecord = (contactData && contactData.data && contactData.data[0]) || {};
    const account = contactRecord.Account_Name;

    const fields = { Deal_Name: dealName.trim(), Contact_Name: { id: contactId } };
    if (account && account.id) fields.Account_Name = { id: account.id };
    if (stage) fields.Stage = stage;
    if (amount !== undefined && amount !== "") fields.Amount = Number(amount);
    if (nextStep) fields.Next_Step = nextStep;

    const data = await crmWrite("POST", "/crm/v6/Deals", { data: [fields] });
    const entry = assertCrmWriteOk(data, "Échec de la création du deal");
    const dealId = entry.details && entry.details.id;

    // Cache best-effort : le deal apparaît tout de suite dans la recherche et
    // le rappel, sans attendre le prochain cron sync_deals.
    try {
      const catalystApp = catalyst.initialize(req);
      await catalystApp.datastore().table("Deals_Cache").insertRows([
        {
          crm_id: dealId,
          Deal_Name: dealName.trim(),
          Stage: stage || "",
          contact_name: contactRecord.Full_Name || "",
          account_name: account ? account.name || "" : "",
          type: "",
          Reason_For_Loss: "",
          amount: amount !== undefined && amount !== "" ? Number(amount) : null,
          closing_date: null,
          next_step: nextStep || "",
        },
      ]);
    } catch (cacheErr) {
      console.error("Cache Deals_Cache non alimenté à la création:", cacheErr.message);
    }

    res.status(200).json({ id: dealId });
  } catch (err) {
    console.error("POST /deals error:", err.message);
    res.status(500).json({ error: "Erreur création deal", detail: err.message });
  }
});

// Mise à jour rapide d'un deal : étape, montant, prochaine étape, raison de
// perte. Trace le changement d'étape par une note automatique et peut
// enchaîner la création d'une relance.
app.patch("/deals/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const { stage, amount, nextStep, reasonForLoss, chainFollowUp } = req.body || {};

    const before = await crmRequest(`/crm/v6/Deals/${id}`);
    const beforeRecord = (before && before.data && before.data[0]) || {};
    const previousStage = beforeRecord.Stage || "";

    const fields = {};
    if (stage !== undefined) fields.Stage = stage;
    if (amount !== undefined) fields.Amount = amount === "" ? null : Number(amount);
    if (nextStep !== undefined) fields.Next_Step = nextStep;
    if (reasonForLoss !== undefined) fields.Reason_For_Loss__s = reasonForLoss;

    if (Object.keys(fields).length) {
      const updateData = await crmWrite("PUT", "/crm/v6/Deals", {
        data: [{ id, ...fields }],
      });
      assertCrmWriteOk(updateData, "Échec de la mise à jour du deal");
    }

    if (stage !== undefined && stage !== previousStage) {
      try {
        await crmWrite("POST", `/crm/v6/Deals/${id}/Notes`, {
          data: [{ Note_Content: `Étape : ${previousStage || "—"} → ${stage}` }],
        });
      } catch (noteErr) {
        console.error("Note auto étape non créée:", noteErr.message);
      }
    }

    let relance = null;
    if (chainFollowUp) {
      try {
        relance = await createRelance(id, { ...beforeRecord, ...fields });
      } catch (relanceErr) {
        console.error("Relance enchaînée non créée:", relanceErr.message);
      }
    }

    // Cache Data Store : best-effort, ne doit jamais faire échouer la requête.
    try {
      const catalystApp = catalyst.initialize(req);
      const zcql = catalystApp.zcql();
      const escapedId = id.replace(/'/g, "''");
      const rows = await zcql.executeZCQLQuery(
        `SELECT ROWID FROM Deals_Cache WHERE crm_id = '${escapedId}' LIMIT 1`,
      );
      const rowId = rows[0] && rows[0].Deals_Cache.ROWID;
      if (rowId) {
        const cacheRow = { ROWID: rowId };
        if (stage !== undefined) cacheRow.Stage = stage;
        if (amount !== undefined) cacheRow.amount = amount === "" ? null : Number(amount);
        if (nextStep !== undefined) cacheRow.next_step = nextStep;
        if (reasonForLoss !== undefined) cacheRow.Reason_For_Loss = reasonForLoss;
        if (Object.keys(cacheRow).length > 1) {
          await catalystApp.datastore().table("Deals_Cache").updateRows([cacheRow]);
        }
      }
    } catch (cacheErr) {
      console.error("Cache Deals_Cache non mis à jour:", cacheErr.message);
    }

    const after = await crmRequest(`/crm/v6/Deals/${id}`);
    const record = (after && after.data && after.data[0]) || null;
    res.status(200).json({ ...buildDealDetail(record, id), relance });
  } catch (err) {
    console.error("PATCH /deals/:id error:", err.message);
    res.status(500).json({ error: "Erreur mise à jour deal", detail: err.message });
  }
});

// Relance en un clic : crée une tâche de suivi sans formulaire.
app.post("/deals/:id/relance", async (req, res) => {
  try {
    const id = req.params.id;
    const data = await crmRequest(`/crm/v6/Deals/${id}`);
    const record = (data && data.data && data.data[0]) || {};
    const relance = await createRelance(id, record);
    res.status(200).json(relance);
  } catch (err) {
    console.error("POST /deals/:id/relance error:", err.message);
    res.status(500).json({ error: "Erreur création relance", detail: err.message });
  }
});

// Annulation d'une relance (bouton "Annuler" du bandeau).
app.delete("/tasks/:id", async (req, res) => {
  try {
    const data = await crmWrite("DELETE", `/crm/v6/Tasks/${encodeURIComponent(req.params.id)}`);
    assertCrmWriteOk(data, "Échec de l'annulation de la relance");
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("DELETE /tasks/:id error:", err.message);
    res.status(500).json({ error: "Erreur suppression tâche", detail: err.message });
  }
});

// Ajout d'une remarque sur un lead, contact ou deal.
app.post("/notes", async (req, res) => {
  try {
    const { module, id, content } = req.body || {};
    if (!module || !id || !content || !content.trim()) {
      return res.status(400).json({ error: "Paramètres 'module', 'id' et 'content' requis." });
    }
    if (!["Leads", "Contacts", "Deals"].includes(module)) {
      return res.status(400).json({ error: "Module invalide." });
    }
    const data = await crmWrite("POST", `/crm/v6/${module}/${id}/Notes`, {
      data: [{ Note_Content: content.trim() }],
    });
    const entry = assertCrmWriteOk(data, "Échec de la création de la remarque");
    res.status(200).json({
      id: entry.details && entry.details.id,
      content: content.trim(),
      date: new Date().toISOString(),
    });
  } catch (err) {
    console.error("POST /notes error:", err.message);
    res.status(500).json({ error: "Erreur création remarque", detail: err.message });
  }
});

// Fil d'activité (Notes + Tâches réelles) d'un lead, contact ou deal.
app.get("/activity/:module/:id", async (req, res) => {
  try {
    const { module, id } = req.params;
    if (!["Leads", "Contacts", "Deals"].includes(module)) {
      return res.status(400).json({ error: "Module invalide." });
    }
    const [notesData, tasksData] = await Promise.all([
      crmRequest(`/crm/v6/${module}/${id}/Notes`).catch(() => null),
      crmRequest(`/crm/v6/${module}/${id}/Tasks`).catch(() => null),
    ]);
    const notes = (notesData && notesData.data) || [];
    const tasks = (tasksData && tasksData.data) || [];

    const entries = notes
      .map((n) => {
        const content = n.Note_Content || "";
        return {
          kind: /^Étape\s*:/.test(content) ? "stage" : "note",
          text: content,
          date: n.Modified_Time || n.Created_Time || "",
        };
      })
      .concat(
        tasks.map((t) => ({
          kind: "task",
          text: t.Subject || "Tâche",
          date: t.Modified_Time || t.Created_Time || "",
          taskId: t.id,
          status: t.Status || "",
          dueDate: t.Due_Date || "",
        })),
      )
      .filter((e) => e.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 30);

    res.status(200).json({ activity: entries });
  } catch (err) {
    console.error("GET /activity error:", err.message);
    res.status(500).json({ error: "Erreur fil d'activité", detail: err.message });
  }
});

// Recherche deals (Data Store) — utilisée par la recherche globale.
app.get("/deals/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim().replace(/'/g, "''");
    if (!q) return res.status(400).json({ error: "Paramètre 'q' requis." });
    const catalystApp = catalyst.initialize(req);
    const zcql = catalystApp.zcql();
    const rows = await zcql.executeZCQLQuery(
      `SELECT crm_id, Deal_Name, Stage, account_name, contact_name, amount, closing_date FROM Deals_Cache WHERE Deal_Name LIKE '*${q}*' OR account_name LIKE '*${q}*' OR contact_name LIKE '*${q}*' LIMIT 50`,
    );
    const deals = rows.map((r) => {
      const d = r.Deals_Cache;
      return {
        id: d.crm_id,
        name: d.Deal_Name,
        stage: d.Stage,
        accountName: d.account_name,
        contactName: d.contact_name,
        amount: d.amount,
        closingDate: d.closing_date,
      };
    });
    res.status(200).json({ deals });
  } catch (err) {
    res.status(500).json({ error: "Erreur recherche deals", detail: err.message });
  }
});

// Détail contact : appel CRM à la demande (fiche fraîche) + deals associés (Data Store)
app.get("/contacts/detail/:id", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { data } = await axios.get(
      `${API_HOST}/crm/v6/Contacts/${req.params.id}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      },
    );
    const record = (data && data.data && data.data[0]) || null;
    const id = (record && record.id) || req.params.id;
    const subtitleKey = record && record.Title ? "Title" : "Account_Name";
    const app = catalyst.initialize(req);
    const deals = await findDealsForContact(app, record && record.Full_Name);
    res.status(200).json({
      title: record ? record.Full_Name || record.Account_Name || "Contact" : "Contact",
      subtitle: record ? record.Title || record.Account_Name || "" : "",
      crmUrl: buildCrmUrl("Contacts", id),
      groups: buildDetailGroups(record, { titleKey: "Full_Name", subtitleKey }),
      deals,
    });
  } catch (err) {
    // err.response.data porte le code CRM réel (ex. INVALID_ID quand le crm_id
    // en cache ne correspond à aucun Contact) — bien plus parlant que le
    // message générique d'axios pour diagnostiquer une fiche inaccessible.
    const crmDetail = err.response && err.response.data;
    res.status(500).json({ error: "Erreur détail CRM", detail: crmDetail || err.message });
  }
});

// Liste des contacts (depuis Data Store)
app.get("/contacts", async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const zcql = catalystApp.zcql();
    const rows = await zcql.executeZCQLQuery(
      "SELECT crm_id, name, account_name, email, phone, title FROM Contacts_Cache ORDER BY crm_created_time DESC LIMIT 200"
    );
    const contacts = rows.map((r) => {
      const id = r.Contacts_Cache.crm_id;
      return {
        id,
        name: r.Contacts_Cache.name,
        company: r.Contacts_Cache.account_name, // réutilise la colonne "Société" du tableau
        email: r.Contacts_Cache.email,
        phone: r.Contacts_Cache.phone,
        status: r.Contacts_Cache.title,          // réutilise la colonne "Statut" pour le poste
      };
    });
    res.status(200).json({ leads: contacts }); // même clé "leads" → réutilise le front tel quel
  } catch (err) {
    res.status(500).json({ error: "Erreur Data Store contacts", detail: err.message });
  }
});

// Recherche contacts
app.get("/contacts/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim().replace(/'/g, "''");
    if (!q) return res.status(400).json({ error: "Paramètre 'q' requis." });
    const catalystApp = catalyst.initialize(req);
    const zcql = catalystApp.zcql();
    const rows = await zcql.executeZCQLQuery(
      `SELECT crm_id, name, account_name, email, phone, title FROM Contacts_Cache WHERE name LIKE '*${q}*' OR account_name LIKE '*${q}*' OR email LIKE '*${q}*' LIMIT 200`
    );
    const contacts = rows.map((r) => {
      const id = r.Contacts_Cache.crm_id;
      return {
        id,
        name: r.Contacts_Cache.name,
        company: r.Contacts_Cache.account_name,
        email: r.Contacts_Cache.email,
        phone: r.Contacts_Cache.phone,
        status: r.Contacts_Cache.title,
      };
    });
    res.status(200).json({ leads: contacts });
  } catch (err) {
    res.status(500).json({ error: "Erreur recherche contacts", detail: err.message });
  }
});

// Healthcheck : vérifie que les variables d'environnement sont présentes

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    env_check: {
      hasClientId: !!process.env.ZOHO_CLIENT_ID,
      hasSecret: !!process.env.ZOHO_CLIENT_SECRET,
      hasRefresh: !!process.env.ZOHO_REFRESH_TOKEN,
      apiHost: process.env.ZOHO_API_HOST || "NON DÉFINI",
    },
  });
});

module.exports = app;
