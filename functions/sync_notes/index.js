"use strict";
const catalyst = require("zcatalyst-sdk-node");
const axios = require("axios");

const ACCOUNTS_HOST =
  process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.eu";
const API_HOST = process.env.ZOHO_API_HOST || "https://www.zohoapis.eu";

// Modules affichés dans le dashboard — toute note rattachée à un autre
// module CRM (Accounts, Campaigns...) est ignorée.
const TRACKED_MODULES = new Set(["Leads", "Contacts", "Deals"]);

async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const { data } = await axios.post(
    `${ACCOUNTS_HOST}/oauth/v2/token`,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  return data.access_token;
}

module.exports = async (cronDetails, context) => {
  const app = catalyst.initialize(context);
  try {
    const token = await getAccessToken();
    const fields = "Note_Title,Note_Content,Parent_Id,Owner";

    // 1. Récupérer toutes les notes du CRM, tous modules confondus (le module
    // Notes est transverse : $se_module indique le module du parent).
    let page = 1,
      all = [],
      more = true;
    while (more) {
      const { data } = await axios.get(`${API_HOST}/crm/v6/Notes`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { fields, page, per_page: 200 },
        validateStatus: (s) => s < 500,
      });
      const records = (data && data.data) || [];
      all.push(...records);
      more = data && data.info && data.info.more_records;
      page++;
      if (page > 200) break; // garde-fou anti-boucle
    }

    // 2. Ne garder que les notes rattachées à Leads/Contacts/Deals, avec un id
    // purement numérique (crm_id/parent_id sont en bigint côté Data Store).
    const isNumericId = (v) => v != null && /^[0-9]+$/.test(String(v));
    const tracked = all.filter(
      (rec) =>
        rec.Parent_Id &&
        isNumericId(rec.Parent_Id.id) &&
        isNumericId(rec.id) &&
        TRACKED_MODULES.has(rec.$se_module),
    );

    // 3. Charger les ROWID existants (map crm_id -> ROWID) pour l'upsert.
    // Comparaison en chaîne : un id CRM (~19 chiffres) dépasse la précision
    // entière sûre de Number (2^53), donc on ne caste jamais ces id en Number.
    const zcql = app.zcql();
    const existing = await zcql.executeZCQLQuery(
      "SELECT ROWID, crm_id FROM Notes_Cache",
    );
    const idMap = {};
    existing.forEach((r) => {
      idMap[String(r.Notes_Cache.crm_id)] = r.Notes_Cache.ROWID;
    });

    // 4. Upsert (CREATEDTIME/MODIFIEDTIME sont gérées automatiquement par le
    // Data Store, pas de colonne synced_at dédiée).
    const table = app.datastore().table("Notes_Cache");
    const toInsert = [],
      toUpdate = [];

    for (const rec of tracked) {
      const row = {
        crm_id: rec.id,
        parent_id: rec.Parent_Id.id,
        module: rec.$se_module,
        title: rec.Note_Title || "",
        content: rec.Note_Content || "",
        owner: rec.Owner ? rec.Owner.name : "",
      };
      if (idMap[String(rec.id)]) {
        row.ROWID = idMap[String(rec.id)];
        toUpdate.push(row);
      } else {
        toInsert.push(row);
      }
    }

    // Découpage par lots de 200 (indispensable au-delà de 200 lignes)
    const chunk = (arr, n) =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
        arr.slice(i * n, i * n + n),
      );
    for (const c of chunk(toInsert, 200)) await table.insertRows(c);
    for (const c of chunk(toUpdate, 200)) await table.updateRows(c);

    console.log(
      `Sync notes OK : ${toInsert.length} insérées, ${toUpdate.length} mises à jour`,
    );
    return context.closeWithSuccess();
  } catch (err) {
    console.error("Cron sync_notes error:", err.message);
    return context.closeWithFailure();
  }
};
