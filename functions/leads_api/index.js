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

const CRM_BASE = process.env.ZOHO_CRM_BASE_URL || "https://crm.zoho.eu";
const ORG = process.env.ZOHO_CRM_ORG_ID || "";

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

function mapLead(record) {
  const id = record.id;
  const crmUrl = CRM_ORG_ID
    ? `${CRM_BASE_URL}/crm/org${CRM_ORG_ID}/tab/Leads/${id}`
    : `${CRM_BASE_URL}/crm/tab/Leads/${id}`; // fallback sans org : CRM résout souvent quand même
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
        crmUrl: ORG
          ? `${CRM_BASE}/crm/org${ORG}/tab/Leads/${id}`
          : `${CRM_BASE}/crm/tab/Leads/${id}`,
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

// Détail : appel CRM à la demande (fiche fraîche)
app.get("/leads/detail/:id", async (req, res) => {
  try {
    const token = await getAccessToken(); // ta fonction existante
    const { data } = await axios.get(
      `${API_HOST}/crm/v6/Leads/${req.params.id}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      },
    );
    res.status(200).json({ lead: (data && data.data && data.data[0]) || null });
  } catch (err) {
    res.status(500).json({ error: "Erreur détail CRM", detail: err.message });
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
        crmUrl: ORG ? `${CRM_BASE}/crm/org${ORG}/tab/Contacts/${id}` : `${CRM_BASE}/crm/tab/Contacts/${id}`,
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
      `SELECT crm_id, name, account_name, email, phone, title FROM Contacts_Cache WHERE name LIKE '%${q}%' OR account_name LIKE '%${q}%' OR email LIKE '%${q}%' LIMIT 200`
    );
    const contacts = rows.map((r) => {
      const id = r.Contacts_Cache.crm_id;
      return {
        id,
        crmUrl: ORG ? `${CRM_BASE}/crm/org${ORG}/tab/Contacts/${id}` : `${CRM_BASE}/crm/tab/Contacts/${id}`,
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
