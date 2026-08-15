"use strict";
const catalyst = require("zcatalyst-sdk-node");
const axios = require("axios");

const ACCOUNTS_HOST =
  process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.eu";
const API_HOST = process.env.ZOHO_API_HOST || "https://www.zohoapis.eu";

// La colonne crm_created_time/synced_at est en type datetime (voir Contacts_Cache) :
// elle rejette l'ISO 8601 brut de Created_Time/toISOString() ("2024-03-15T10:22:31-04:00")
// avec "Invalid input value ... datetime value expected". Même format que
// sync_contacts_signal.
function formatDateTime(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

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
    console.log(
      "DIAG token présent:",
      !!token,
      "| longueur:",
      token ? token.length : 0,
    );
    const fields =
      "Last_Name,First_Name,Full_Name,Account_Name,Email,Phone,Title,Owner,Created_Time";

    let page = 1,
      all = [],
      more = true;
    while (more) {
      const { data } = await axios.get(`${API_HOST}/crm/v6/Contacts`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { fields, page, per_page: 200 },
        validateStatus: (s) => s < 500,
      });
      console.log(
        "DIAG Contacts page",
        page,
        ":",
        JSON.stringify(data).slice(0, 600),
      );
      const records = (data && data.data) || [];
      all.push(...records);
      more = data && data.info && data.info.more_records;
      page++;
      if (page > 100) break;
    }

    const zcql = app.zcql();
    const existing = await zcql.executeZCQLQuery(
      "SELECT ROWID, crm_id FROM Contacts_Cache",
    );
    const idMap = {};
    existing.forEach((r) => {
      idMap[r.Contacts_Cache.crm_id] = r.Contacts_Cache.ROWID;
    });

    const table = app.datastore().table("Contacts_Cache");
    const now = formatDateTime(new Date());
    const toInsert = [],
      toUpdate = [];

    for (const rec of all) {
      const row = {
        crm_id: rec.id,
        name:
          rec.Full_Name ||
          `${rec.First_Name || ""} ${rec.Last_Name || ""}`.trim(),
        account_name: rec.Account_Name ? rec.Account_Name.name : "",
        email: rec.Email || "",
        phone: rec.Phone || "",
        title: rec.Title || "",
        owner: rec.Owner ? rec.Owner.name : "",
        crm_created_time: formatDateTime(rec.Created_Time),
        synced_at: now,
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
      `Sync contacts OK : ${toInsert.length} insérés, ${toUpdate.length} mis à jour`,
    );
    return context.closeWithSuccess();
  } catch (err) {
    console.error("Cron sync_contacts error:", err.message);
    return context.closeWithFailure();
  }
};
