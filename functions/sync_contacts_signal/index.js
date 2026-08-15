"use strict";

/**
 * Event Function — cible d'un Catalyst Signal (Source: Zoho CRM, Event:
 * Contact créé, Target Input: Full Data). Reçoit directement l'enregistrement
 * complet du contact et l'upsert dans Contacts_Cache, sans aucun appel API
 * CRM (Full Data évite tout getRecordById).
 *
 * API réelle du premier argument (event), confirmée en production : seule
 * getRawData() renvoie une valeur exploitable — { version, account, events: [...] }
 * — les autres méthodes (getData(), getAction(), getSource(),
 * getSourceEntityId(), getProjectDetails(), getEventBusDetails(), getTime())
 * renvoient toutes undefined, et getSourceDetails() est dépréciée. Le contact
 * est imbriqué quelque part dans events[0] ; findCrmRecords() le retrouve par
 * recherche récursive plutôt que par un chemin figé, pour tolérer la structure
 * exacte choisie par Zoho. Le contexte (2e argument) expose bien
 * closeWithSuccess()/closeWithFailure(), comme les fonctions cron de ce projet.
 */

const catalyst = require("zcatalyst-sdk-node");

async function resolveMaybeAsync(value) {
  if (value && typeof value.then === "function") return await value;
  return value;
}

// getRawData() confirmé comme seule méthode utile (les autres — getData(),
// getAction(), getSource(), getSourceEntityId(), getProjectDetails(),
// getEventBusDetails(), getTime() — renvoient toutes undefined ; getSourceDetails()
// est dépréciée et renvoie {}). Elle donne l'enveloppe complète du Signal :
// { version, account, events: [ ... ] }, avec le contact quelque part imbriqué
// dans events[0] (profondeur exacte pas encore confirmée).

// Dump ligne par ligne (chemin + type/valeur) plutôt qu'un JSON.stringify
// unique : évite toute troncature côté affichage des logs, quelle que soit la
// profondeur réelle de l'enveloppe.
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

// Un vrai enregistrement CRM a un id purement numérique (contrairement à
// l'id d'événement, un UUID) ET au moins DEUX champs typiques de fiche
// Contact — un seul champ suffisait auparavant, mais des sous-objets de
// lookup (Owner, Created_By, Modified_By…) ont eux aussi un id numérique ET
// peuvent porter un seul champ qui ressemble à un des indices (ex. un champ
// email) sans être un Contact. Exiger au moins deux indices simultanés, et
// exclure explicitement ces clés de lookup connues, évite qu'un objet
// utilisateur (Owner…) soit confondu avec le contact et upserté dans
// Contacts_Cache sous un crm_id qui ne correspond à aucun Contact réel — un
// tel contact « fantôme » apparaît dans la liste (les rares champs présents
// suffisent à générer un nom) mais échoue à l'ouverture, sa fiche détail
// interrogeant /crm/v6/Contacts/{id} en direct avec un id invalide pour ce
// module.
const RECORD_FIELD_HINTS = [
  "Email", "First_Name", "Last_Name", "Full_Name", "Mailing_State",
  "Department", "Account_Name", "Phone", "Lead_Score",
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

// Recherche récursive dans toute l'enveloppe plutôt qu'un chemin figé :
// tolère n'importe quel niveau d'imbrication choisi par Zoho pour le contact.
// keyName est le nom de la clé par laquelle on est arrivé sur `value` — permet
// d'exclure les sous-objets de lookup connus même s'ils ressemblaient par
// erreur à un contact.
function findCrmRecords(value, depth, maxDepth, found, keyName) {
  if (depth > maxDepth || value == null) return found;
  if (Array.isArray(value)) {
    value.forEach((v) => findCrmRecords(v, depth + 1, maxDepth, found, keyName));
    return found;
  }
  if (typeof value === "object") {
    if (!LOOKUP_KEY_BLOCKLIST.has(keyName) && looksLikeCrmRecord(value)) {
      found.push(value);
      return found; // pas besoin de descendre plus bas dans un enregistrement déjà identifié
    }
    Object.keys(value).forEach((k) => findCrmRecords(value[k], depth + 1, maxDepth, found, k));
  }
  return found;
}

// yyyy-MM-dd HH:mm:ss — compatible colonne texte ou datetime (voir schéma
// Contacts_Cache : crm_created_time/synced_at à repasser en datetime si besoin
// de tri/filtrage chronologique).
function formatDateTime(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function upsertContact(catalystApp, rec) {
  const crmId = rec.id || rec.ID;
  if (!crmId) {
    throw new Error("Enregistrement sans id CRM, ignoré : " + JSON.stringify(rec).slice(0, 200));
  }
  const zcql = catalystApp.zcql();
  const escapedId = String(crmId).replace(/'/g, "''");
  // Suppose crm_id en Is Unique + Search Indexed = true (voir corrections de
  // schéma à faire) : sans ça, l'idempotence de cet upsert n'est pas garantie.
  const existing = await zcql.executeZCQLQuery(
    `SELECT ROWID FROM Contacts_Cache WHERE crm_id = '${escapedId}'`,
  );

  const row = {
    crm_id: String(crmId),
    name: rec.Full_Name || `${rec.First_Name || ""} ${rec.Last_Name || ""}`.trim(),
    // Champs lookup CRM : arrivent en objet { id, name }, pas en chaîne.
    account_name: rec.Account_Name ? rec.Account_Name.name : "",
    email: rec.Email || "",
    phone: rec.Phone || "",
    title: rec.Title || "",
    owner: rec.Owner ? rec.Owner.name : "",
    crm_created_time: formatDateTime(rec.Created_Time),
    synced_at: formatDateTime(new Date()),
  };

  const table = catalystApp.datastore().table("Contacts_Cache");
  if (existing.length) {
    row.ROWID = existing[0].Contacts_Cache.ROWID;
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

  // Un événement "Contact créé" ne devrait produire qu'un seul enregistrement.
  // Si plusieurs remontent, c'est le signe qu'un objet imbriqué (lookup) a été
  // confondu avec le contact — à surveiller après le durcissement de
  // looksLikeCrmRecord/LOOKUP_KEY_BLOCKLIST ci-dessus.
  if (records.length > 1) {
    console.warn(
      `${records.length} enregistrements détectés pour un seul événement (attendu : 1) :`,
      records.map((r) => ({ id: r.id || r.ID, name: r.Full_Name || r.Email || "" })),
    );
  }

  let okCount = 0;
  const errors = [];
  for (const rec of records) {
    try {
      const id = await upsertContact(app, rec);
      okCount++;
      console.log(`Contact synchronisé : ${id}`);
    } catch (err) {
      errors.push(err.message);
      console.error("Échec sync contact:", err.message);
    }
  }

  console.log(`Signal traité : ${okCount}/${records.length} contact(s) synchronisé(s).`);
  // Un échec partiel déclenche un retry (Retry Count configuré côté Signal) :
  // l'upsert étant idempotent, retraiter les contacts déjà réussis est sans risque.
  return finish(context, errors.length === 0);
};
