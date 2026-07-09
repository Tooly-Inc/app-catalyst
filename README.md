# Dashboard Leads — Zoho CRM × Catalyst

Widget de dashboard pour Zoho CRM affichant les leads dans une interface épurée,
avec recherche en temps réel. Le front est un widget statique hébergé sur
**Catalyst Web Client Hosting**, alimenté par une **fonction Advanced I/O Node.js**
qui interroge l'API Zoho CRM v6.

```
VS Code (dev)  →  GitHub Tooly-Inc (source)  →  Catalyst (host + function)  →  Widget dans Zoho CRM
```

---

## Architecture

| Couche | Techno | Rôle |
|--------|--------|------|
| Front | HTML/CSS/JS vanilla | Table des leads, recherche, filtre statut |
| Backend | Catalyst Advanced I/O (Node.js + Express) | Proxy vers l'API CRM, gestion OAuth serveur |
| Auth | OAuth2 refresh token | Stocké **côté serveur uniquement** (variables d'env Catalyst) |
| Hosting | Catalyst Web Client Hosting | Sert le widget en HTTPS |

**Pourquoi un backend et pas un appel direct depuis le widget ?**
Le refresh token OAuth ne doit jamais être exposé dans du JS navigateur (repo public).
La fonction le garde côté serveur et n'expose que des endpoints en lecture.

---

## Prérequis

- Node.js 18+
- Catalyst CLI : `npm install -g zcatalyst-cli`
- Un compte Zoho CRM + un projet Catalyst (https://catalyst.zoho.com)

---

## 1. Récupérer le projet

```bash
git clone https://github.com/Tooly-Inc/lead-dashboard.git
cd lead-dashboard
```

## 2. Installer les dépendances de la fonction

```bash
cd functions/leads_api
npm install
cd ../..
```

## 3. Créer les credentials OAuth (Zoho API Console)

1. Va sur **https://api-console.zoho.com** (ou `.eu` selon ton datacenter).
2. Crée un client de type **Self Client** (le plus simple pour un token serveur).
3. Génère un **grant token** avec le scope :
   ```
   ZohoCRM.modules.leads.READ,ZohoCRM.settings.READ
   ```
4. Échange le grant token contre un **refresh token** :
   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=TON_CLIENT_ID" \
     -d "client_secret=TON_CLIENT_SECRET" \
     -d "code=TON_GRANT_TOKEN"
   ```
   Récupère `refresh_token` dans la réponse.

> **⚠️ Datacenter** — adapte les URLs à ta région :
> | Région | accounts | api |
> |--------|----------|-----|
> | US/Global | `accounts.zoho.com` | `www.zohoapis.com` |
> | Europe | `accounts.zoho.eu` | `www.zohoapis.eu` |
> | Inde | `accounts.zoho.in` | `www.zohoapis.in` |
> | Canada | `accounts.zohocloud.ca` | `www.zohoapis.ca` |

## 4. Configurer les variables d'environnement

**En local** (pour `catalyst serve`) : copie `.env.example` en `.env` dans
`functions/leads_api/` et renseigne les valeurs.

**En production** : Console Catalyst > ton projet > **Settings > Environment
Variables**, ajoute :
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_ACCOUNTS_HOST` (ex : `https://accounts.zoho.eu`)
- `ZOHO_API_HOST` (ex : `https://www.zohoapis.eu`)

## 5. Tester en local

```bash
catalyst serve
```
La fonction est dispo sur une URL locale. Teste :
```bash
curl "http://localhost:3000/server/leads_api/health"
curl "http://localhost:3000/server/leads_api/leads?per_page=5"
```

## 6. Renseigner l'URL de la fonction dans le front

Une fois la fonction déployée (étape 7), récupère la **Function URL** dans
Console Catalyst > Functions > `leads_api`, et colle-la dans
`client/js/config.js` :

```js
window.APP_CONFIG = {
  FUNCTION_BASE_URL: "https://<projet>-<id>.development.catalystserverless.com/server/leads_api",
};
```

## 7. Déployer sur Catalyst

```bash
catalyst deploy
```
Cela déploie la fonction **et** le web client dans l'environnement Development.
Pour la production : Console Catalyst > **Deploy to Production**.

> Alternative GitHub → Catalyst : la Console permet de connecter ton repo
> Tooly-Inc et de déclencher des déploiements depuis GitHub (Web Client Hosting
> > Deploy from GitHub). Pratique pour un flux CI simple.

---

## 8. Intégrer comme widget dans Zoho CRM

Deux façons :

**A. Onglet web (le plus rapide)**
CRM > Setup > Customization > **Tabs > Web Tabs** > New. Colle l'URL du web
client Catalyst (prod). Le dashboard apparaît comme un onglet CRM.

**B. Widget Sigma (intégré natif)**
1. Installe Sigma : `npm install -g zoho-extension-toolkit`
2. Le fichier `client/plugin-manifest.json` est déjà prêt (emplacement
   `crm.customTab.container`).
3. Package : `zet pack` puis upload dans CRM > Setup > **Developer Space > Widgets**.
4. Associe le widget à un onglet personnalisé.

> Note : avec Sigma, le widget est servi par Zoho. Il continue d'appeler ta
> fonction Catalyst pour les données (le `cspDomains` du manifest autorise le
> domaine `catalystserverless.com`).

---

## Endpoints de la fonction

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/leads?page=1&per_page=50` | Liste paginée (triée par date desc) |
| GET | `/leads/search?q=terme` | Recherche multi-champs |
| GET | `/leads/search?field=Lead_Status&value=Contacted` | Recherche ciblée |
| GET | `/health` | Healthcheck |

Champs remontés : nom, société, email, téléphone, statut (+ source, propriétaire,
date de création disponibles dans la fonction si besoin d'étendre).

---

## Sécurité

- Le refresh token vit **uniquement** dans les variables d'env Catalyst.
- `.gitignore` bloque `.env` — vérifie qu'il n'est jamais committé sur le repo public.
- Envisage de restreindre l'accès à la fonction via les **règles d'invocation**
  Catalyst (Console > Functions > Access) pour éviter un appel public non authentifié.

---

## Structure

```
lead-dashboard/
├── catalyst.json
├── .gitignore
├── README.md
├── functions/
│   └── leads_api/
│       ├── index.js          # Fonction Advanced I/O (Express)
│       ├── package.json
│       └── .env.example
└── client/
    ├── index.html
    ├── plugin-manifest.json  # Manifest widget Sigma
    ├── css/style.css
    └── js/
        ├── config.js         # ⚠️ URL de la fonction à renseigner
        └── app.js
```
