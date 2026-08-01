/* ==========================================================================
   GLITCHBOX — shared backend config
   --------------------------------------------------------------------------
   Single source of truth for the Cloudflare Worker URL. The hub (index.html)
   uses it for accounts / friends / invites; multiplayer games use it for the
   WebSocket room relay at `<base>/ws?room=CODE&role=host|guest`.

   👉 After deploying the Worker (`cd glitchbox-api && npx wrangler deploy`),
      paste the URL wrangler prints below — that one edit switches on friend
      codes, friend requests, invites and online play everywhere.
   ========================================================================== */
(function () {
  var API = 'https://glitchbox-api.levtheduck.workers.dev';

  window.GLITCHBOX_API = API;
  // Backend is "ready" only once the placeholder has been replaced with a real host.
  window.GLITCHBOX_BACKEND_READY = /^https?:\/\//.test(API) && !/PLACEHOLDER/i.test(API);
  // http(s):// → ws(s)://, so the relay follows the API's scheme automatically.
  window.GLITCHBOX_WS = API.replace(/^http/, 'ws') + '/ws';
})();
