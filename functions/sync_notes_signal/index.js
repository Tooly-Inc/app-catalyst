"use strict";

/**
 * Event Function — cible d'un Catalyst Signal (Source: Zoho CRM, module
 * Notes, Event: Note créée, Target Input: Full Data). Reçoit directement
 * l'enregistrement complet de la note et l'upsert dans Notes_Cache, sans
 * appel API CRM (Full Data évite tout getRecordById).
 *
 * Même mécanique que sync_contacts_signal/sync_deals_signal/sync_leads_signal
 * (voir sync_contacts_signal pour le détail de l'enveloppe Signal) : seule
 * getRawData() renvoie une valeur exploitable, la note est retrouvée par
 * recherche récursive plutôt que par un chemin figé. Même filtre de module
 * que le cron sync_notes : seules les notes rattachées à Leads/Contacts/Deals
 * ($se_module) sont conservées.
 */

const catalyst = require("zcatalyst-sdk-node");

const TRACKED_MODULES = new Set(["Leads", "Contacts", "Deals"]);

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

// Champs propres à une Note — cf. sync_contacts_signal pour le détail du
// raisonnement (2 indices minimum + exclusion des sous-objets de lookup
// connus, pour ne jamais confondre Owner/Parent_Id imbriqué avec la note
// elle-même).
const RECORD_FIELD_HINTS = ["Note_Title", "Note_Content", "Parent_Id"];
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

// crm_id/parent_id sont en bigint côté Data Store : on exige un id purement
// numérique et on ne le caste jamais en Number côté JS (un id CRM, ~19
// chiffres, dépasse la précision entière sûre de Number, 2^53).
function isNumericId(v) {
  return v != null && /^[0-9]+$/.test(String(v));
}

async function upsertNote(catalystApp, rec) {
  const crmId = rec.id || rec.ID;
  if (!isNumericId(crmId)) {
    throw new Error("Enregistrement sans id CRM numérique, ignoré : " + JSON.stringify(rec).slice(0, 200));
  }
  if (!rec.Parent_Id || !isNumericId(rec.Parent_Id.id) || !TRACKED_MODULES.has(rec.$se_module)) {
    console.log(`Note ${crmId} ignorée (module non suivi : ${rec.$se_module || "inconnu"}).`);
    return null;
  }

  const zcql = catalystApp.zcql();
  const existing = await zcql.executeZCQLQuery(
    `SELECT ROWID FROM Notes_Cache WHERE crm_id = ${crmId}`,
  );

  // CREATEDTIME/MODIFIEDTIME sont gérées automatiquement par le Data Store,
  // pas de colonne synced_at dédiée.
  const row = {
    crm_id: crmId,
    parent_id: rec.Parent_Id.id,
    module: rec.$se_module,
    title: rec.Note_Title || "",
    content: rec.Note_Content || "",
    owner: rec.Owner ? rec.Owner.name : "",
  };

  const table = catalystApp.datastore().table("Notes_Cache");
  if (existing.length) {
    row.ROWID = existing[0].Notes_Cache.ROWID;
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
      records.map((r) => ({ id: r.id || r.ID, title: r.Note_Title || "" })),
    );
  }

  let okCount = 0;
  const errors = [];
  for (const rec of records) {
    try {
      const id = await upsertNote(app, rec);
      if (id) {
        okCount++;
        console.log(`Note synchronisée : ${id}`);
      }
    } catch (err) {
      errors.push(err.message);
      console.error("Échec sync note:", err.message);
    }
  }

  console.log(`Signal traité : ${okCount}/${records.length} note(s) synchronisée(s).`);
  return finish(context, errors.length === 0);
};
