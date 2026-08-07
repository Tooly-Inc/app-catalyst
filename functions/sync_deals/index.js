"use strict";
const catalyst = require("zcatalyst-sdk-node");
const axios = require("axios");

const ACCOUNTS_HOST =
  process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.eu";
const API_HOST = process.env.ZOHO_API_HOST || "https://www.zohoapis.eu";

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
    const fields =
      "Deal_Name,Stage,Contact_Name,Account_Name,Type,Reason_For_Loss__s";

    // 1. Récupérer tous les deals du CRM (pagination)
    let page = 1,
      all = [],
      more = true;
    while (more) {
      const { data } = await axios.get(`${API_HOST}/crm/v6/Deals`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { fields, page, per_page: 200 },
        validateStatus: (s) => s < 500,
      });
      const records = (data && data.data) || [];
      all.push(...records);
      more = data && data.info && data.info.more_records;
      page++;
      if (page > 100) break; // garde-fou anti-boucle
    }

    // 2. Ne garder que les deals associés à un contact
    const linked = all.filter((rec) => rec.Contact_Name && rec.Contact_Name.id);

    // 3. Charger les ROWID existants (map crm_id -> ROWID) pour l'upsert
    const zcql = app.zcql();
    const existing = await zcql.executeZCQLQuery(
      "SELECT ROWID, crm_id FROM Deals_Cache",
    );
    const idMap = {};
    existing.forEach((r) => {
      idMap[r.Deals_Cache.crm_id] = r.Deals_Cache.ROWID;
    });

    // 4. Upsert
    const table = app.datastore().table("Deals_Cache");
    const toInsert = [],
      toUpdate = [];

    for (const rec of linked) {
      const row = {
        crm_id: rec.id,
        Deal_Name: rec.Deal_Name || "",
        Stage: rec.Stage || "",
        contact_name: rec.Contact_Name.name || "",
        account_name: rec.Account_Name ? rec.Account_Name.name : "",
        type: rec.Type || "",
        Reason_For_Loss: rec.Reason_For_Loss__s || "",
      };
      if (idMap[rec.id]) {
        row.ROWID = idMap[rec.id];
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
      `Sync deals OK : ${toInsert.length} insérés, ${toUpdate.length} mis à jour`,
    );
    return context.closeWithSuccess();
  } catch (err) {
    console.error("Cron sync_deals error:", err.message);
    return context.closeWithFailure();
  }
};
