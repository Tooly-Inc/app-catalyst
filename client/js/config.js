/**
 * Configuration du widget.
 *
 * FUNCTION_BASE_URL : l'URL de base de ta fonction Advanced I/O Catalyst.
 * Tu la trouves dans la Console Catalyst > Functions > leads_api > Function URL.
 * Elle ressemble à :
 *   https://<projet>-<id>.development.catalystserverless.com/server/leads_api
 * (retire le /health à la fin, garde jusqu'à /leads_api)
 *
 * En production, remplace "development" par l'URL de prod après déploiement.
 */
// window.APP_CONFIG = {
//   FUNCTION_BASE_URL: "https://app-catalyst-20115848591.development.catalystserverless.eu/server/leads_api/",
// };
// window.APP_CONFIG = {
//   FUNCTION_BASE_URL: "http://localhost:3000/server/leads_api",
// };

window.APP_CONFIG = {
  FUNCTION_BASE_URL: "/server/leads_api",
};