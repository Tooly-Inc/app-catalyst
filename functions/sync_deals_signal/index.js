"use strict";

/**
 * Event Function — cible d'un Catalyst Signal (Source: Zoho CRM, Event:
 * Deal créé/modifié, Target Input: Full Data). Reçoit directement
 * l'enregistrement complet du deal et l'upsert dans Deals_Cache, sans appel
 * API CRM (Full Data évite tout getRecordById).
 *
 * Même mécanique que sync_contacts_signal (voir ce fichier pour le détail de
 * l'enveloppe Signal) : seule getRawData() renvoie une valeur exploitable,
 * le deal est retrouvé par recherche récursive plutôt que par un chemin figé.
 */

const catalyst = require("zcatalyst-sdk-node");

async function resolveMaybeAsync(value) {
  if (value && typeof value.then === "function") return await value;
  return value;
}

function describeShape(value, path, depth, maxDepth, lines) {
  if (depth > maxDepth || value === undefined) return lines;
  if (value === null) {
    lines.push(`${path} = null`);
    return lines;
  }
  if (Array.isArray(value)) {
    lines.push(`${path} : array(${value.length})`);
    if (value.length) describeShape(value[0], `${path}[0]`, depth + 1, maxDepth, lines);
    return lines;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    lines.push(`${path} : object {${keys.join(", ")}}`);
    keys.forEach((k) => describeShape(value[k], `${path}.${k}`, depth + 1, maxDepth, lines));
    return lines;
  }
  lines.push(`${path} = ${JSON.stringify(value)}`);
  return lines;
}

// Champs propres à un Deal — cf. sync_contacts_signal pour le détail du
// raisonnement (2 indices minimum + exclusion des sous-objets de lookup
// connus, pour ne jamais confondre Owner/Contact_Name/Account_Name imbriqués
// avec le deal lui-même).
const RECORD_FIELD_HINTS = [
  "Deal_Name", "Stage", "Amount", "Closing_Date", "Next_Step",
  "Account_Name", "Contact_Name", "Type", "Reason_For_Loss__s",
];
const MIN_RECORD_FIELD_HINT_MATCHES = 2;
const LOOKUP_KEY_BLOCKLIST = new Set([
  "Owner", "Created_By", "Modified_By", "Reporting_To", "Layout",
  "actor", "initiator", "Approved_By", "$owner", "Who_Id", "What_Id",
]);
function looksLikeCrmRecord(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const idVal = obj.id || obj.ID;
  if (!idVal || !/^[0-9]+$/.test(String(idVal))) return false;
  const matches = RECORD_FIELD_HINTS.filter((k) => Object.prototype.hasOwnProperty.call(obj, k));
  return matches.length >= MIN_RECORD_FIELD_HINT_MATCHES;
}

function findCrmRecords(value, depth, maxDepth, found, keyName) {
  if (depth > maxDepth || value == null) return found;
  if (Array.isArray(value)) {
    value.forEach((v) => findCrmRecords(v, depth + 1, maxDepth, found, keyName));
    return found;
  }
  if (typeof value === "object") {
    if (!LOOKUP_KEY_BLOCKLIST.has(keyName) && looksLikeCrmRecord(value)) {
      found.push(value);
      return found;
    }
    Object.keys(value).forEach((k) => findCrmRecords(value[k], depth + 1, maxDepth, found, k));
  }
  return found;
}

// Même filtre que le cron sync_deals : le dashboard n'affiche que les deals
// liés à un contact (limitation connue, cf. Deals_Cache).
async function upsertDeal(catalystApp, rec) {
  const crmId = rec.id || rec.ID;
  if (!crmId) {
    throw new Error("Enregistrement sans id CRM, ignoré : " + JSON.stringify(rec).slice(0, 200));
  }
  if (!rec.Contact_Name || !rec.Contact_Name.id) {
    console.log(`Deal ${crmId} ignoré (pas de contact associé).`);
    return null;
  }

  const zcql = catalystApp.zcql();
  const escapedId = String(crmId).replace(/'/g, "''");
  const existing = await zcql.executeZCQLQuery(
    `SELECT ROWID FROM Deals_Cache WHERE crm_id = '${escapedId}'`,
  );

  const row = {
    crm_id: String(crmId),
    Deal_Name: rec.Deal_Name || "",
    Stage: rec.Stage || "",
    contact_name: rec.Contact_Name.name || "",
    account_name: rec.Account_Name ? rec.Account_Name.name : "",
    type: rec.Type || "",
    Reason_For_Loss: rec.Reason_For_Loss__s || "",
    amount: rec.Amount || null,
    closing_date: rec.Closing_Date || null,
    next_step: rec.Next_Step || "",
  };

  const table = catalystApp.datastore().table("Deals_Cache");
  if (existing.length) {
    row.ROWID = existing[0].Deals_Cache.ROWID;
    await table.updateRow(row);
  } else {
    await table.insertRow(row);
  }
  return row.crm_id;
}

function finish(context, success) {
  try {
    if (success && typeof context.closeWithSuccess === "function") return context.closeWithSuccess();
    if (!success && typeof context.closeWithFailure === "function") return context.closeWithFailure();
  } catch (e) {
    console.error("Erreur lors de la fermeture du contexte:", e.message);
  }
  return undefined;
}

module.exports = async (event, context) => {
  const app = catalyst.initialize(context);

  const raw = await resolveMaybeAsync(event.getRawData ? event.getRawData() : undefined);
  const records = findCrmRecords(raw, 0, 6, [], null);

  if (!records.length) {
    console.warn("Aucun enregistrement CRM détecté dans la donnée brute — dump de la structure complète :");
    describeShape(raw, "raw", 0, 6, []).forEach((line) => console.log(line));
    return finish(context, true);
  }

  if (records.length > 1) {
    console.warn(
      `${records.length} enregistrements détectés pour un seul événement (attendu : 1) :`,
      records.map((r) => ({ id: r.id || r.ID, name: r.Deal_Name || "" })),
    );
  }

  let okCount = 0;
  const errors = [];
  for (const rec of records) {
    try {
      const id = await upsertDeal(app, rec);
      if (id) {
        okCount++;
        console.log(`Deal synchronisé : ${id}`);
      }
    } catch (err) {
      errors.push(err.message);
      console.error("Échec sync deal:", err.message);
    }
  }

  console.log(`Signal traité : ${okCount}/${records.length} deal(s) synchronisé(s).`);
  return finish(context, errors.length === 0);
};
