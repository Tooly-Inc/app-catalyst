"use strict";
const axios = require("axios");
const catalyst = require("zcatalyst-sdk-node");

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
      "Last_Name,First_Name,Full_Name,Company,Email,Phone,Lead_Status,Lead_Source,Owner,Created_Time";

    // 1. Récupérer tous les leads du CRM (pagination)
    let page = 1,
      allLeads = [],
      more = true;
    while (more) {
      const { data } = await axios.get(`${API_HOST}/crm/v6/Leads`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { fields, page, per_page: 200 },
        validateStatus: (s) => s < 500,
      });
      const records = (data && data.data) || [];
      allLeads.push(...records);
      more = data && data.info && data.info.more_records;
      page++;
      if (page > 100) break; // garde-fou anti-boucle
    }

    // 2. Charger les ROWID existants (map crm_id -> ROWID) pour l'upsert
    const zcql = app.zcql();
    const existing = await zcql.executeZCQLQuery(
      "SELECT ROWID, crm_id FROM Leads_Cache",
    );
    const idMap = {};
    existing.forEach((r) => {
      idMap[r.Leads_Cache.crm_id] = r.Leads_Cache.ROWID;
    });

    // 3. Upsert
    const table = app.datastore().table("Leads_Cache");
    const now = new Date().toISOString();
    const toInsert = [],
      toUpdate = [];

    for (const rec of allLeads) {
      const row = {
        crm_id: rec.id,
        name:
          rec.Full_Name ||
          `${rec.First_Name || ""} ${rec.Last_Name || ""}`.trim(),
        company: rec.Company || "",
        email: rec.Email || "",
        phone: rec.Phone || "",
        status: rec.Lead_Status || "",
        source: rec.Lead_Source || "",
        owner: rec.Owner ? rec.Owner.name : "",
        crm_created_time: rec.Created_Time || "",
        synced_at: now,
      };
      if (idMap[rec.id]) {
        row.ROWID = idMap[rec.id];
        toUpdate.push(row);
      } else {
        toInsert.push(row);
      }
    }

    if (toInsert.length) await table.insertRows(toInsert);
    if (toUpdate.length) await table.updateRows(toUpdate);

    console.log(
      `Sync OK : ${toInsert.length} insérés, ${toUpdate.length} mis à jour`,
    );
    return context.closeWithSuccess();
  } catch (err) {
    console.error("Cron sync error:", err.message);
    return context.closeWithFailure();
  }
};
