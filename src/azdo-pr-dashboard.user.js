// ==UserScript==

// @name         More Awesome Azure DevOps (userscript)
// @version      3.13.0
// @author       Alejandro Barreto (NI)
// @description  Makes general improvements to the Azure DevOps experience, particularly around pull requests. Also contains workflow improvements for NI engineers.
// @license      MIT

// @namespace    https://github.com/alejandro5042
// @homepageURL  https://alejandro5042.github.io/azdo-userscripts/
// @supportURL   https://alejandro5042.github.io/azdo-userscripts/SUPPORT.html
// @updateURL    https://github.com/alejandro5042/azdo-userscripts/releases/latest/download/azdo-pr-dashboard.user.js
// @contributionURL  https://github.com/alejandro5042/azdo-userscripts

// @include      https://dev.azure.com/*
// @include      https://*.visualstudio.com/*

// @run-at       document-body
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.3.1/jquery.min.js#sha256-FgpCb/KJQlLNfOu91ta32o/NMZxltwRo8QtmkMRdAu8=
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery-once/2.2.3/jquery.once.min.js#sha256-HaeXVMzafCQfVtWoLtN3wzhLWNs8cY2cH9OIQ8R9jfM=
// @require      https://cdnjs.cloudflare.com/ajax/libs/date-fns/1.30.1/date_fns.min.js#sha256-wCBClaCr6pJ7sGU5kfb3gQMOOcIZNzaWpWcj/lD9Vfk=
// @require      https://cdn.jsdelivr.net/npm/lodash@4.17.11/lodash.min.js#sha256-7/yoZS3548fXSRXqc/xYzjsmuW3sFKzuvOCHd06Pmps=

// @require      https://cdn.jsdelivr.net/npm/sweetalert2@9.13.1/dist/sweetalert2.all.min.js#sha384-8oDwN6wixJL8kVeuALUvK2VlyyQlpEEN5lg6bG26x2lvYQ1HWAV0k8e2OwiWIX8X
// @require      https://gist.githubusercontent.com/alejandro5042/af2ee5b0ad92b271cd2c71615a05da2c/raw/45da85567e48c814610f1627148feb063b873905/easy-userscripts.js#sha384-t7v/Pk2+HNbUjKwXkvcRQIMtDEHSH9w0xYtq5YdHnbYKIV7Jts9fSZpZq+ESYE4v

// @require      https://unpkg.com/@popperjs/core@2.11.7#sha384-zYPOMqeu1DAVkHiLqWBUTcbYfZ8osu1Nd6Z89ify25QV9guujx43ITvfi12/QExE
// @require      https://unpkg.com/tippy.js@6.3.7#sha384-AiTRpehQ7zqeua0Ypfa6Q4ki/ddhczZxrKtiQbTQUlJIhBkTeyoZP9/W/5ulFt29

// @require      https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/highlight.min.js#sha384-g4mRvs7AO0/Ol5LxcGyz4Doe21pVhGNnC3EQw5shw+z+aXDN86HqUdwXWO+Gz2zI
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-yaml/3.14.0/js-yaml.min.js#sha512-ia9gcZkLHA+lkNST5XlseHz/No5++YBneMsDp1IZRJSbi1YqQvBeskJuG1kR+PH1w7E0bFgEZegcj0EwpXQnww==
// @resource     linguistLanguagesYml https://raw.githubusercontent.com/github/linguist/master/lib/linguist/languages.yml?v=1
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      graph.microsoft.com
// @connect      login.microsoftonline.com

// ==/UserScript==

(function () {
  'use strict';

  // Early check: are we in an OOO auth redirect popup from the PKCE OAuth flow?
  // This runs before any other script logic and closes the popup after relaying the code.
  // Uses GM_setValue (Tampermonkey IPC) — reliable across sandboxed script contexts.
  {
    const oooParams = new URLSearchParams(window.location.search);
    const oooState = oooParams.get('state');
    if (oooState && oooState.startsWith('azdo-ooo-')) {
      try {
        // Key is state-specific to avoid collisions between concurrent attempts.
        GM_setValue(`oooAuthResult-${oooState}`, JSON.stringify({
          code: oooParams.get('code') || null,
          state: oooState,
          error: oooParams.get('error_description') || null,
          errorCode: oooParams.get('error') || null,
        }));
      } catch (e) { /* ignore */ }
      setTimeout(() => window.close(), 200);
      return;
    }
  }

  // All REST API calls should fail after a timeout, instead of going on forever.
  $.ajaxSetup({ timeout: 5000 });

  let currentUser;
  let azdoApiBaseUrl;
  let oooAccessToken = null;
  let oooAccessTokenExpiry = null;
  let oooAuthPromise = null; // coalesces concurrent token acquisitions (refresh or popup) across callers
  let oooSilentAuthAttempted = false; // limit the fallback popup to one attempt per page session

  // Some features only apply at National Instruments.
  const atNI = /^ni\./i.test(window.location.hostname) || /^\/ni\//i.test(window.location.pathname);

  function debug(...args) {
    // eslint-disable-next-line no-console
    console.log('[azdo-userscript]', args);
  }

  function error(...args) {
    // eslint-disable-next-line no-console
    console.error('[azdo-userscript]', args);
  }

  function main() {
    eus.globalSession.onFirst(document, 'body', () => {
      eus.registerCssClassConfig(document.body, 'Configure PR Status Location', 'pr-status-location', 'ni-pr-status-right-side', {
        'ni-pr-status-default': 'Default',
        'ni-pr-status-right-side': 'Right Side',
      });
    });

    if (atNI) {
      eus.registerCssClassConfig(document.body, 'Display Agent Arbitration Status', 'agent-arbitration-status', 'agent-arbitration-status-off', {
        'agent-arbitration-status-on': 'On',
        'agent-arbitration-status-off': 'Off',
      });

      eus.showTipOnce('release-2026-07-27', 'New in the AzDO userscript', `
        <p>Highlights from the 2026-07-27 update!</p>
        <ul>
          <li>OOO info is now looked up live per-reviewer via Microsoft Graph (no more stale data!)</li>
          <li>For non-NI/Emerson users, use <b>script menu → OOO Lookup: Configure Graph Client ID</b> to set up</li>
        </ul>
        <p>Comments, bugs, suggestions? File an issue on <a href="https://github.com/alejandro5042/azdo-userscripts" target="_blank">GitHub</a> 🧡</p>
      `);

      GM_registerMenuCommand('OOO Lookup: Configure Graph Client ID', async () => {
        const current = GM_getValue('oooGraphClientId', '');
        // eslint-disable-next-line no-alert
        const clientId = prompt(
          'OOO lookup works out of the box using a shared app registration – you normally do not '
          + 'need to set anything here.\n\n'
          + 'Only override the Azure AD Application (Client) ID if you are on a non-NI/Emerson tenant/org '
          + 'and want to use your own app registration (SPA redirect URI '
          + `${getOooRedirectUri()}, delegated Presence.Read.All + offline_access).\n\n`
          + 'Leave blank to use the shared default.',
          current,
        );
        if (clientId === null) {
          return;
        }
        GM_setValue('oooGraphClientId', clientId.trim());
        oooAccessToken = null;
        oooAccessTokenExpiry = null;
        oooAuthPromise = null;
        oooSilentAuthAttempted = false;
        GM_deleteValue('oooAccessToken');
        GM_deleteValue('oooAccessTokenExpiry');
        // A new client ID means any stored refresh token is for a different app; drop it.
        GM_deleteValue('oooRefreshToken');
        GM_deleteValue('oooRefreshTokenExpiry');

        // Sign in immediately so the user consents once and sees any admin-approval message;
        // after this, silent auth keeps the token fresh automatically.
        try {
          await acquireOooTokenInteractive();
          swal.fire({ icon: 'success', title: 'OOO Lookup Active', text: 'Reload a PR page to see live OOO annotations.' });
        } catch (e) {
          if (e.code && /consent_required/i.test(e.code)) {
            const tenantId = GM_getValue('oooTenantId', 'organizations');
            const adminConsentUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/adminconsent`
              + `?client_id=${encodeURIComponent(getOooClientId())}`
              + `&redirect_uri=${encodeURIComponent(getOooRedirectUri())}`;
            swal.fire({
              icon: 'warning',
              title: 'Admin approval required',
              html: 'Your organization requires an IT admin to approve this app before users can sign in.<br><br>'
                + 'Share this URL with your IT admin (one-time setup, unlocks OOO for everyone):<br><br>'
                + `<input style="width:100%;font-size:0.8em;padding:4px" readonly onclick="this.select()" value="${adminConsentUrl}">`,
            });
          } else {
            swal.fire({ icon: 'error', title: 'Authentication failed', text: String(e.message) });
          }
        }
      });
    }

    // Start modifying the page once the DOM is ready.
    if (document.readyState !== 'loading') {
      onReady();
    } else {
      document.addEventListener('DOMContentLoaded', onReady);
    }
  }

  function onReady() {
    // Find out who is our current user. In general, we should avoid using pageData because it doesn't always get updated when moving between page-to-page in AzDO's single-page application flow. Instead, rely on the AzDO REST APIs to get information from stuff you find on the page or the URL. Some things are OK to get from pageData; e.g. stuff like the user which is available on all pages.
    const pageData = JSON.parse(document.getElementById('dataProviders').innerHTML).data;
    currentUser = pageData['ms.vss-web.page-data'].user;
    debug('init', pageData, currentUser);

    const theme = pageData['ms.vss-web.theme-data'].requestedThemeId;
    const isDarkTheme = /(dark|night|neptune)/i.test(theme);

    // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
    azdoApiBaseUrl = `${window.location.origin}${pageData['ms.vss-tfs-web.header-action-data'].suiteHomeUrl}`;

    // Invoke our new eus-style features.
    watchPullRequestDashboard();
    watchForWorkItemForms();
    watchForNewDiffs(isDarkTheme);
    watchForShowMoreButtons();
    watchForBuildResultsPage();

    if (atNI) {
      watchForDiffHeaders();
      watchFilesTree();
      watchForKnownBuildErrors(pageData);
    }

    eus.onUrl(/\/pullrequest\//gi, (session, urlMatch) => {
      if (atNI) {
        watchForLVDiffsAndAddNIBinaryDiffButton(session);
        watchForReviewerList(session);
        // MOVE THIS HERE: conditionallyAddBypassReminderAsync();
      }

      watchForStatusCardAndMoveToRightSideBar(session);
      addEditButtons(session);
      addTrophiesToPullRequest(session, pageData);
      fixImageUrls(session);
    });

    eus.onUrl(/\/(agentqueues|agentpools)(\?|\/)/gi, (session, urlMatch) => {
      watchForAgentPage(session, pageData);
    });

    eus.onUrl(/\/(_build)(\?|$)/gi, (session, urlMatch) => {
      watchForPipelinesPage(session, pageData);
    });

    eus.onUrl(/\/(_git)/gi, (session, urlMatch) => {
      doEditAction(session);
      watchForRepoBrowsingPages(session);
    });

    eus.onUrl(/\/(_releaseProgress)/gi, (session, urlMatch) => {
      fixScrollBarColor();
    });

    // Throttle page update events to avoid using up CPU when AzDO is adding a lot of elements during a short time (like on page load).
    const onPageUpdatedThrottled = _.throttle(onPageUpdated, 400, { leading: false, trailing: true });

    // Handle any existing elements, flushing it to execute immediately.
    onPageUpdatedThrottled();
    onPageUpdatedThrottled.flush();

    // Call our event handler if we notice new elements being inserted into the DOM. This happens as the page is loading or updating dynamically based on user activity.
    const targetNode = $('body > div.full-size')[0];
    const observer = new MutationObserver(onPageUpdatedThrottled);
    observer.observe(targetNode, { childList: true, subtree: true });
  }

  function watchForStatusCardAndMoveToRightSideBar(session) {
    if (!document.body.classList.contains('ni-pr-status-right-side')) return;

    addStyleOnce('pr-overview-sidebar-css', /* css */ `
      /* Make the sidebar wider to accommodate the status moving there. */
      .repos-overview-right-pane {
        width: 550px;
      }`);

    session.onEveryNew(document, '.page-content .flex-column > .bolt-table-card', status => {
      $(status).prependTo('.repos-overview-right-pane');
    });
  }

  async function fetchJsonAndCache(key, secondsToCache, url, version = 1, fixer = x => x) {
    let value;

    const fullKey = `azdo-userscripts-${key}`;
    const fullVersion = `1-${version}`;

    let cached;
    try {
      cached = JSON.parse(localStorage[fullKey]);
    } catch (e) {
      cached = null;
    }

    if (cached && cached.version === fullVersion && dateFns.isFuture(dateFns.parse(cached.expiryDate))) {
      value = cached.value;
    } else {
      localStorage.removeItem(fullKey);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Bad status ${response.status} for <${url}>`);
      } else {
        value = await response.json();
        value = fixer(value);
      }

      const expirationDate = new Date(Date.now() + (secondsToCache * 1000));
      localStorage[fullKey] = JSON.stringify({
        version: fullVersion,
        expiryDate: expirationDate.toISOString(),
        value,
      });
    }

    return value;
  }

  // ===== OOO Lookup via Microsoft Graph API =====
  // Looks up each reviewer's out-of-office status live at page load time.
  // Uses a shared, single-tenant Azure AD app registration (Presence.Read.All, delegated). The
  // client ID below is public by design: this is an Authorization Code + PKCE public client, so
  // there is NO client secret to leak. The app is locked down by tenant + delegated scope + the
  // registered SPA redirect URIs (one per AZDO org root, e.g. https://dev.azure.com/ni/).
  // Power users on other orgs/tenants can override the client ID via the Tampermonkey menu.

  // offline_access is required for AAD to return a refresh token, which lets us mint new access
  // tokens via a background POST (no popup) until the refresh token's own expiry.
  const OOO_GRAPH_SCOPES = 'https://graph.microsoft.com/Presence.Read.All offline_access';
  const OOO_STATE_PREFIX = 'azdo-ooo-';
  // Shared app registration ("TM RD PR Metrics"). Safe to commit – public PKCE client, no secret.
  const OOO_DEFAULT_GRAPH_CLIENT_ID = '968d0bcc-467a-4ec6-96be-3a1ab9e339e4';

  function getOooClientId() {
    // A per-user override (via the Tampermonkey menu) takes precedence over the shared default.
    return GM_getValue('oooGraphClientId', '') || OOO_DEFAULT_GRAPH_CLIENT_ID;
  }

  function getOooRedirectUri() {
    // https://dev.azure.com/ does a server-side redirect to https://dev.azure.com/{org}/,
    // which strips the OAuth code/state query params before the userscript can intercept them.
    // Use the org-specific root URL instead — it doesn't redirect further.
    if (window.location.hostname === 'dev.azure.com') {
      const org = window.location.pathname.split('/').filter(Boolean)[0];
      if (org) return `${window.location.origin}/${org}/`;
    }
    return `${window.location.origin}/`;
  }

  function getOooRandom(len = 43) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    return Array.from(buf, b => chars[b % chars.length]).join('');
  }

  async function getOooPkceChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // Promisified GM_xmlhttpRequest — bypasses CORS for all OOO-related network calls.
  function oooXhr(method, url, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data: body,
        onload: resp => resolve(resp),
        onerror: () => reject(new Error(`Network error calling ${url}`)),
        ontimeout: () => reject(new Error(`Timeout calling ${url}`)),
      });
    });
  }

  // Auto-discovers the AAD tenant ID from the user's email domain via OIDC metadata.
  // Single-tenant apps (the default after Oct 2018) reject the /common endpoint;
  // they require a tenant-specific URL like /login.microsoftonline.com/{tenantId}/...
  async function getOooTenantId() {
    const cached = GM_getValue('oooTenantId', '');
    if (cached) return cached;

    const email = currentUser && currentUser.uniqueName;
    const domain = email && email.split('@')[1];
    if (!domain) return 'organizations';

    try {
      const resp = await oooXhr(
        'GET',
        `https://login.microsoftonline.com/${encodeURIComponent(domain)}/.well-known/openid-configuration`,
      );
      if (resp.status >= 200 && resp.status < 300) {
        const cfg = JSON.parse(resp.responseText);
        // issuer is "https://login.microsoftonline.com/{tenantId}/v2.0"
        const m = cfg.issuer && cfg.issuer.match(/\/([a-f0-9-]{36})\//i);
        if (m) {
          GM_setValue('oooTenantId', m[1]);
          return m[1];
        }
      }
    } catch (e) { /* ignore */ }

    return 'organizations';
  }

  async function acquireOooTokenInteractive(silent = false) {
    const clientId = getOooClientId();
    if (!clientId) throw new Error('OOO Graph Client ID not configured. Use the Tampermonkey menu.');

    const tenantId = await getOooTenantId();
    const verifier = getOooRandom();
    const challenge = await getOooPkceChallenge(verifier);
    const state = OOO_STATE_PREFIX + getOooRandom(16);
    const redirectUri = getOooRedirectUri();

    sessionStorage.setItem(`ooo-pkce-${state}`, verifier);

    function openAuthPopup(promptMode) {
      const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', OOO_GRAPH_SCOPES);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('login_hint', currentUser.uniqueName);
      authUrl.searchParams.set('prompt', promptMode);

      return new Promise((resolve, reject) => {
        // Clear any stale result from a prior attempt with this same state.
        GM_deleteValue(`oooAuthResult-${state}`);

        const popup = window.open(authUrl.toString(), 'ooo-auth', 'width=600,height=600,resizable=yes');
        if (!popup) { reject(new Error('Popup blocked - allow popups for this site')); return; }

        debug('OOO auth popup opened. Waiting for redirect back to', redirectUri);

        function handleResult(result) {
          clearInterval(pollId); // eslint-disable-line no-use-before-define
          clearTimeout(timer); // eslint-disable-line no-use-before-define
          GM_deleteValue(`oooAuthResult-${state}`);
          debug('OOO auth result received:', result.code ? 'code obtained' : `error: ${result.errorCode}`);
          if (result.error || result.errorCode) {
            const err = new Error(result.error || result.errorCode);
            err.code = result.errorCode;
            reject(err);
            return;
          }
          resolve(result.code);
        }

        // Poll GM storage every 200ms. GM_addValueChangeListener's 'remote' flag is unreliable
        // for popup→opener communication (may be false even across windows), so polling is safer.
        const pollId = setInterval(() => {
          const rawVal = GM_getValue(`oooAuthResult-${state}`, null);
          if (rawVal === null) return;
          try { handleResult(JSON.parse(rawVal)); } catch (e) { clearInterval(pollId); }
        }, 200);

        const timer = setTimeout(() => {
          clearInterval(pollId);
          GM_deleteValue(`oooAuthResult-${state}`);
          reject(new Error('Authentication timed out (2 min). Check that the redirect URI matches your Azure AD registration.'));
        }, 2 * 60 * 1000);
      });
    }

    // Try silent first (prompt=none); fall back to interactive if AAD requires user interaction.
    debug('Starting OOO auth. Tenant:', tenantId, 'Redirect URI:', redirectUri);
    let code;
    try {
      code = await openAuthPopup('none');
    } catch (e) {
      debug('Silent OOO auth failed, errorCode:', e.code, '— trying interactive');
      if (e.code && /interaction_required|consent_required|login_required/i.test(e.code)) {
        if (silent) throw e; // don't fall back to interactive UI in silent mode
        code = await openAuthPopup('select_account');
      } else {
        throw e;
      }
    }

    const storedVerifier = sessionStorage.getItem(`ooo-pkce-${state}`) || verifier;
    sessionStorage.removeItem(`ooo-pkce-${state}`);

    const tokenResp = await oooXhr('POST', `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      // SPA app registrations require an Origin header matching the redirect URI origin.
      // GM_xmlhttpRequest doesn't send one automatically, so we add it explicitly.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: window.location.origin },
      body: new URLSearchParams([
        ['grant_type', 'authorization_code'],
        ['client_id', clientId],
        ['code', code],
        ['redirect_uri', redirectUri],
        ['code_verifier', storedVerifier],
        ['scope', OOO_GRAPH_SCOPES],
      ]).toString(),
    });

    if (tokenResp.status < 200 || tokenResp.status >= 300) {
      const errData = JSON.parse(tokenResp.responseText || '{}');
      error('OOO token exchange failed. Status:', tokenResp.status, 'Body:', tokenResp.responseText);
      throw new Error(errData.error_description || errData.error || `Token exchange failed: HTTP ${tokenResp.status}`);
    }

    debug('OOO token exchange succeeded. Access token obtained.');
    storeOooTokens(JSON.parse(tokenResp.responseText), /* isFreshLogin= */ true);
    return oooAccessToken;
  }

  // Persists tokens returned by either the authorization_code or refresh_token grant. Refresh
  // tokens are single-use and rotated, so we always store the latest one. For SPA redirect URIs
  // the refresh token expires 24h after the original interactive login and that expiry carries
  // over across rotations, so we only stamp the 24h clock on a fresh login.
  function storeOooTokens(tokenData, isFreshLogin) {
    oooAccessToken = tokenData.access_token;
    oooAccessTokenExpiry = new Date(Date.now() + (tokenData.expires_in - 300) * 1000);
    // Cache in GM storage so the token survives page navigations.
    GM_setValue('oooAccessToken', oooAccessToken);
    GM_setValue('oooAccessTokenExpiry', oooAccessTokenExpiry.getTime());

    if (tokenData.refresh_token) {
      GM_setValue('oooRefreshToken', tokenData.refresh_token);
      if (isFreshLogin) {
        GM_setValue('oooRefreshTokenExpiry', Date.now() + 24 * 60 * 60 * 1000);
      }
    }
  }

  // Mints a new access token from the stored refresh token via a background POST — no popup.
  // Returns null (and drops the refresh token) if there's none or AAD rejects it, so the caller
  // falls back to an interactive/silent popup.
  async function refreshOooAccessToken() {
    const refreshToken = GM_getValue('oooRefreshToken', '');
    const refreshExpiry = GM_getValue('oooRefreshTokenExpiry', 0);
    // SPA refresh tokens live only 24h; once past that a popup is unavoidable, so don't bother.
    if (!refreshToken || Date.now() >= refreshExpiry) return null;

    const clientId = getOooClientId();
    if (!clientId) return null;
    const tenantId = await getOooTenantId();

    const tokenResp = await oooXhr('POST', `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: window.location.origin },
      body: new URLSearchParams([
        ['grant_type', 'refresh_token'],
        ['client_id', clientId],
        ['refresh_token', refreshToken],
        ['scope', OOO_GRAPH_SCOPES],
      ]).toString(),
    });

    if (tokenResp.status < 200 || tokenResp.status >= 300) {
      // Expired or revoked — drop it so the next acquisition falls back to a popup.
      GM_deleteValue('oooRefreshToken');
      GM_deleteValue('oooRefreshTokenExpiry');
      return null;
    }

    storeOooTokens(JSON.parse(tokenResp.responseText), /* isFreshLogin= */ false);
    return oooAccessToken;
  }

  function getOooGraphAccessToken() {
    // In-memory cache (fastest path, valid for current page session).
    if (oooAccessToken && oooAccessTokenExpiry && new Date() < oooAccessTokenExpiry) {
      return oooAccessToken;
    }
    // GM_setValue cache — survives SPA page navigation, avoids a popup on every page load.
    const savedToken = GM_getValue('oooAccessToken', '');
    const savedExpiry = GM_getValue('oooAccessTokenExpiry', 0);
    if (savedToken && Date.now() < savedExpiry) {
      oooAccessToken = savedToken;
      oooAccessTokenExpiry = new Date(savedExpiry);
      return oooAccessToken;
    }
    // No valid cached access token. Acquire one, coalescing all concurrent callers (e.g. every
    // reviewer on the page) onto a single attempt so we never fire duplicate single-use refresh
    // requests or open multiple popups. Try the refresh token first (a background POST, no popup);
    // only if that fails fall back to a silent popup, at most once per page session.
    if (!oooAuthPromise && getOooClientId()) {
      oooAuthPromise = (async () => {
        const refreshed = await refreshOooAccessToken();
        if (refreshed) return refreshed;

        if (oooSilentAuthAttempted) return null;
        oooSilentAuthAttempted = true;
        return acquireOooTokenInteractive(/* silent= */ true).catch(() => null);
      })().finally(() => { oooAuthPromise = null; });
    }
    return oooAuthPromise;
  }

  // Resolves an email to the user's AAD object ID (originId), which Graph's /presence endpoint
  // requires. Neither the reviewer's identity.id nor its "aad." descriptor is the AAD object ID
  // (they're AZDO-internal IMS/storage GUIDs), and the object ID isn't present anywhere on the page.
  // AZDO's Identity Picker is served same-origin, so it authenticates via the existing session with
  // no extra Microsoft Graph permission or admin consent.
  async function resolveOooAadObjectId(email) {
    const response = await fetch(`${azdoApiBaseUrl}_apis/IdentityPicker/Identities?api-version=5.0-preview.1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: email,
        identityTypes: ['user'],
        operationScopes: ['ims', 'source'],
        properties: ['DisplayName', 'Mail'],
        options: { MinResults: 1, MaxResults: 20 },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const identities = (data.results && data.results[0] && data.results[0].identities) || [];
    const wanted = email.toLowerCase();
    const match = identities.find(i => (i.mail || i.signInAddress || '').toLowerCase() === wanted);
    return (match && match.originId) || null;
  }

  // Graph's /presence endpoint requires the user's AAD object ID (GUID), resolved from their email.
  async function fetchOooForEmail(email) {
    const cacheKey = `azdo-userscripts-ooo-${email.replace(/[^a-z0-9]/gi, '_')}`;
    const cacheDurationMs = 2 * 60 * 60 * 1000; // 2 hours

    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() < cached.expiry) return cached.data;
    } catch (e) { /* ignore */ }

    const token = await getOooGraphAccessToken();
    if (!token) return null;

    const userGuid = await resolveOooAadObjectId(email);
    if (!userGuid) return null;

    try {
      const graphResp = await oooXhr(
        'GET',
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userGuid)}/presence`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );

      let oooData = null;

      if (graphResp.status >= 200 && graphResp.status < 300) {
        const presence = JSON.parse(graphResp.responseText);
        const oof = presence.outOfOfficeSettings;
        if (oof && oof.isOutOfOffice) {
          oooData = { Text: oof.message || '' };
        }
        localStorage.setItem(cacheKey, JSON.stringify({ expiry: Date.now() + cacheDurationMs, data: oooData }));
      } else if (graphResp.status === 401) {
        // Token rejected; clear both in-memory and GM storage so the next call re-authenticates.
        oooAccessToken = null;
        oooAccessTokenExpiry = null;
        GM_deleteValue('oooAccessToken');
        GM_deleteValue('oooAccessTokenExpiry');
      }

      return oooData;
    } catch (e) {
      error(`OOO lookup failed for ${email}:`, e);
      return null;
    }
  }

  function watchForPipelinesPage(session, pageData) {
    addStyleOnce('agent-css', /* css */ `
      .pipeline-status-icon {
        margin-left: 5px;
        font-size: 26px;
      }

      .pipeline-status-icon.ms-Icon--Blocked2Solid {
        color: var(--component-status-error);
      }

      .pipeline-status-icon.ms-Icon--CirclePauseSolid {
        color: var(--component-status-warning);
      }
    `);

    const projectName = pageData['ms.vss-tfs-web.page-data'].project.name;

    const urlParams = new URLSearchParams(window.location.search);
    const urlDefinitionId = urlParams.get('definitionId');

    if (urlDefinitionId) {
      // Single Pipeline View
      session.onEveryNew(document, '.ci-pipeline-details-header', pipelineTitleElement => {
        setPipelineDefinitionDetails(projectName, urlDefinitionId, pipelineTitleElement, 'div.title-m');
      });
    } else {
      // List of Pipelines View
      session.onEveryNew(document, '.bolt-table-row', pipelineTitleElement => {
        const href = $(pipelineTitleElement).find('.bolt-table-link')[0].href;
        if (href) {
          const pipelineHref = new URL(href);
          const pipelineUrlParams = new URLSearchParams(pipelineHref.search);
          const pipelineDefinitionId = pipelineUrlParams.get('definitionId');
          setPipelineDefinitionDetails(projectName, pipelineDefinitionId, pipelineTitleElement, 'div.bolt-table-cell-content');
        }
      });
    }
  }

  async function setPipelineDefinitionDetails(projectName, definitionId, pipelineTitleElement, classToAppendTo) {
    const pipelineDetails = await fetchJsonAndCache(
      `definitionId${definitionId}`,
      0.5,
      `${azdoApiBaseUrl}/${projectName}/_apis/build/definitions/${definitionId}`,
      1,
    );

    const pipelineQueueStatus = pipelineDetails.queueStatus;
    if (pipelineQueueStatus === 'enabled') {
      return;
    }

    const userIcon = document.createElement('span');
    userIcon.title = `Pipeline Status: ${pipelineQueueStatus.toUpperCase()}`;
    userIcon.className = 'pipeline-status-icon fabric-icon';
    userIcon.classList.add({ disabled: 'ms-Icon--Blocked2Solid', paused: 'ms-Icon--CirclePauseSolid' }[pipelineQueueStatus] || 'ms-Icon--Unknown');

    const spanElement = $(pipelineTitleElement).find(classToAppendTo)[0];
    spanElement.appendChild(userIcon);
  }

  function watchForAgentPage(session, pageData) {
    addStyleOnce('agent-css', /* css */ `
      .agent-icon.offline {
        width: 250px !important;
      }
      .disable-reason {
        padding: 5px;
        border-radius: 20px;
        margin-right: 3px;
        font-size: 12px;
        text-decoration: none;
        background: var(--search-selected-match-background);
      }
      input:read-only {
        cursor: not-allowed;
        color: #b1b1b1;
      }
      .agent-name-span {
        width: calc(100% - 60px);
      }
      .capabilities-holder {
        font-size: 20px;
        text-align: left;
        width: 40px;
        margin-right: 20px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

    `);

    session.onEveryNew(document, '.pipelines-pool-agents.page-content.page-content-top', agentsTable => {
      // Disable List Virtualization with 'CTRL + ALT + V'
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'v',
        keyCode: 86,
        code: 'KeyV',
        which: 86,
        altKey: true,
        ctrlKey: true,
        shiftKey: false,
        metaKey: false,
      }));

      if (!document.getElementById('agentFilterInput')) {
        const regexFilterString = new URL(window.location.href).searchParams.get('agentFilter') || '';
        const agentFilterBarElement = `
        <div style="padding-bottom: 16px">
          <div class="vss-FilterBar bolt-filterbar-white depth-8 no-v-margin" role="search" id="testfilter">
              <div class="vss-FilterBar--list">
                  <div class="vss-FilterBar--item vss-FilterBar--item-keyword-container">
                      <div class="flex-column flex-grow">
                          <div class="bolt-text-filterbaritem flex-grow bolt-textfield flex-row flex-center focus-keyboard-only">
                            <span aria-hidden="true" class="keyword-filter-icon prefix bolt-textfield-icon bolt-textfield-no-text flex-noshrink fabric-icon ms-Icon--Filter medium"></span>
                            <input
                              type="text" autocomplete="off"
                              class="bolt-text-filterbaritem-input bolt-textfield-input flex-grow bolt-textfield-input-with-prefix"
                              id="agentFilterInput"
                              placeholder="Regex Filter"
                              role="searchbox"
                              tabindex="0"
                              value="${regexFilterString}">
                            <div id="agentFilterCounter" style="color: var(--text-secondary-color);"/>
                            <div>
                              <button
                                id="copyMatchedAgentsToClipboard"
                                class="bolt-button bolt-icon-button subtle bolt-focus-treatment"
                                role="button"
                                tabindex="0"
                                type="button"
                                style="padding: 0px; margin-left: 10px;"
                                title="Copy Matched Agents to Clipboard">
                                <span class="left-icon flex-noshrink fabric-icon ms-Icon--Copy medium" style="padding: 5px 10px"/>
                              </button>
                              <button
                                id="agentFilterRefresh"
                                class="refresh-dashboard-button bolt-button bolt-icon-button subtle bolt-focus-treatment"
                                role="button"
                                tabindex="0"
                                type="button"
                                style="padding: 0px;">
                                <span class="left-icon flex-noshrink fabric-icon ms-Icon--Refresh medium" style="padding: 5px 10px"/>
                              </button>
                            </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
        </div>`;
        $(agentsTable).prepend(agentFilterBarElement);
        document.getElementById('agentFilterInput').addEventListener('input', filterAgentsDebouncer);
        document.getElementById('agentFilterInput').addEventListener('keydown', filterAgentsNow);
        document.getElementById('agentFilterRefresh').addEventListener('click', filterAgentsNow);
        document.getElementById('copyMatchedAgentsToClipboard').addEventListener('click', copyMatchedAgentsToClipboard);
      }
      filterAgents();
    });

    // Status of agents can change as the table is constantly updating.
    setInterval(filterAgents, 60000);
  }

  function copyMatchedAgentsToClipboard() {
    if (filterAgents.running) return;

    let matchString = '';
    let total = 0;
    const agentRows = document.querySelectorAll('a.bolt-list-row.single-click-activation');
    agentRows.forEach(agentRow => {
      const agentCells = agentRow.querySelectorAll('div');
      const agentName = agentCells[1].innerText;
      if ($(agentRow).is(':visible')) {
        matchString += `${agentName}.*,`;
        total += 1;
      }
    });

    navigator.clipboard.writeText(matchString);
    swal.fire({
      icon: 'success',
      title: `${total} matched agents copied to clipboard!`,
      showConfirmButton: false,
      timer: 1500,
    });
  }

  function filterAgentsNow(event) {
    if (event.key === 'Enter' || event.type === 'click') {
      filterAgents.enter = true;
      filterAgents();
    }
  }

  function filterAgentsDebouncer() {
    let timeout;
    if (!document.hidden) {
      clearTimeout(timeout);
      timeout = setTimeout(filterAgents, 1000);
    }
  }

  async function filterAgents() {
    if (filterAgents.running) return;
    filterAgents.running = true;

    let regexFilterString = document.getElementById('agentFilterInput').value.trim();
    let previousRegexFilterString = '';
    let filterCheckCounter = 0;
    const minimumNumberOfMatches = 10;
    while (filterCheckCounter < minimumNumberOfMatches && !filterAgents.enter) {
      if (previousRegexFilterString === regexFilterString) {
        filterCheckCounter += 1;
      } else {
        filterCheckCounter = 0;
      }
      previousRegexFilterString = regexFilterString;
      regexFilterString = document.getElementById('agentFilterInput').value.trim();
      /* eslint-disable no-await-in-loop, no-promise-executor-return */
      await new Promise(r => setTimeout(r, 100));
      /* eslint-enable no-await-in-loop, no-promise-executor-return */
    }

    let regexFilter = '';
    try {
      regexFilter = new RegExp(regexFilterString, 'i');
    } catch (e) {
      showAllAgents(e);
      return;
    }
    document.getElementById('agentFilterCounter').innerText = 'Filtering...';
    document.getElementById('agentFilterInput').readOnly = true;
    document.getElementById('copyMatchedAgentsToClipboard').disabled = true;

    // Try to push the filter term if possible.
    try {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('agentFilter', regexFilterString);
      window.history.pushState({}, '', currentUrl.toString());
    } catch (e) {
      error(e);
    }

    const agentRows = document.querySelectorAll('a.bolt-list-row.single-click-activation');
    const totalCount = agentRows.length;

    const poolName = Array.from(document.querySelectorAll('div.bolt-breadcrumb-item-text-container')).pop().innerText;
    const currentPoolId = await fetchJsonAndCache(
      `azdoPool${poolName}Id`,
      12 * 60 * 60,
      `${azdoApiBaseUrl}/_apis/distributedtask/pools?poolName=${poolName}`,
      1,
      poolInfo => poolInfo.value[0].id,
    );

    const poolAgentsInfo = await fetchJsonAndCache(
      `azdoPool${poolName}IdAgents`,
      6,
      `${azdoApiBaseUrl}/_apis/distributedtask/pools/${currentPoolId}/agents?includeCapabilities=True&propertyFilters=*`,
      2,
      poolAgentsInfoWithCapabilities => {
        const filteredAgentInfo = {};
        poolAgentsInfoWithCapabilities.value.forEach(agentInfo => {
          filteredAgentInfo[agentInfo.name] = {
            id: agentInfo.id,
            userCapabilities: agentInfo.userCapabilities || {},
            properties: agentInfo.properties,
          };
        });
        return filteredAgentInfo;
      },
    );

    try {
      $('.hiddenAgentRow').show();
      $(agentRows).find('.disable-reason').remove();
      $(agentRows).find('.capabilities-holder').remove();

      const matchedAgents = {};
      agentRows.forEach(agentRow => {
        const agentCells = agentRow.querySelectorAll('div');
        const agentName = agentCells[1].innerText;
        const disableReason = poolAgentsInfo[agentName].userCapabilities.DISABLE_REASON || null;

        const rowValue = agentRow.textContent.replace(/[\r\n]/g, '').trim() + disableReason;
        if (!regexFilter.test(rowValue)) {
          agentRow.classList.add('hiddenAgentRow');
        } else {
          agentRow.classList.remove('hiddenAgentRow');
          matchedAgents[agentName] = agentCells;
        }
      });
      $('.hiddenAgentRow').hide();

      for (const [agentName, agentCells] of Object.entries(matchedAgents)) {
        if (atNI) {
          agentCells[1].querySelectorAll('span')[0].classList.add('agent-name-span');
          addAgentExtraInformation(agentCells, agentName, currentPoolId, poolAgentsInfo);
        }
      }
      document.getElementById('agentFilterCounter').innerText = `(${Object.keys(matchedAgents).length}/${totalCount})`;
    } catch (e) {
      showAllAgents(e);
      return;
    }
    exitFilterAgents();
  }

  function exitFilterAgents() {
    document.getElementById('agentFilterInput').readOnly = false;
    document.getElementById('copyMatchedAgentsToClipboard').disabled = false;
    filterAgents.running = false;
    filterAgents.enter = false;
  }

  function addAgentExtraInformation(agentCells, agentName, currentPoolId, poolAgentsInfo) {
    const agentInfo = poolAgentsInfo[agentName];

    if (agentInfo.userCapabilities) {
      const disableReason = agentInfo.userCapabilities.DISABLE_REASON || null;
      if (disableReason) {
        const userIcon = document.createElement('span');
        userIcon.className = 'fabric-icon ms-Icon--Contact';

        const hiddenDisableReason = document.createElement('a');
        hiddenDisableReason.text = disableReason;
        hiddenDisableReason.style = 'display: none';

        const disableReasonMessage = document.createElement('a');
        let reservedBy = disableReason.match(/\[(.*)\]/);
        if (!reservedBy) {
          reservedBy = disableReason.match(/^([^-]*)/);
        }

        disableReasonMessage.className = 'disable-reason';
        disableReasonMessage.text = reservedBy ? reservedBy[1] : disableReason;
        disableReasonMessage.href = `${azdoApiBaseUrl}/_settings/agentpools?agentId=${agentInfo.id}&poolId=${currentPoolId}&view=capabilities`;
        disableReasonMessage.prepend(userIcon);
        disableReasonMessage.prepend(hiddenDisableReason);
        disableReasonMessage.title = disableReason;
        disableReasonMessage.style = 'max-width: 200px; text-overflow: ellipsis; overflow: hidden';
        $(agentCells[5]).prepend(disableReasonMessage);
      }
    }

    const capabilitiesHolder = document.createElement('div');
    capabilitiesHolder.className = 'capabilities-holder';

    const participateInRelease = agentInfo.userCapabilities.PARTICIPATE_IN_RELEASE || null;
    if (participateInRelease === '1') {
      const participateInReleaseElement = document.createElement('span');
      participateInReleaseElement.className = 'capability-icon release-machine fabric-icon ms-Icon--Rocket';
      participateInReleaseElement.title = 'PARTICIPATE_IN_RELEASE=1';
      capabilitiesHolder.append(participateInReleaseElement);
    }

    if (!document.body.classList.contains('agent-arbitration-status-off')) {
      if (agentInfo.properties && Object.prototype.hasOwnProperty.call(agentInfo.properties, 'under_arbitration')) {
        const underArbitration = agentInfo.properties.under_arbitration.$value.toLowerCase() === 'true';
        const iconType = underArbitration ? 'CirclePause' : 'Airplane';

        const arbitrationIcon = document.createElement('span');
        arbitrationIcon.className = `capability-icon arbiter fabric-icon ms-Icon--${iconType}`;
        arbitrationIcon.title = underArbitration ? 'Arbitration Started: ' : 'Last Arbitration: ';
        arbitrationIcon.title += new Date(agentInfo.properties.arbitration_start.$value * 1000);

        capabilitiesHolder.append(arbitrationIcon);
      }
    }

    agentCells[1].append(capabilitiesHolder);
  }

  function showAllAgents(searchError) {
    if (searchError) {
      document.getElementById('agentFilterCounter').innerText = searchError;
    }
    $('.hiddenAgentRow').show();
    $('.hiddenAgentRow').removeClass('hiddenAgentRow');
    exitFilterAgents();
  }

  async function watchForReviewerList(session) {
    addStyleOnce('pr-reviewer-annotations', /* css */ `
      .reviewer-status-message {
        font-size: 0.7em;
        margin-left: 2ch;
        padding: 0px 3px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid #ffffff22;
        float: right;
      }
      .reviewer-status-message.ooo {
        background: var(--status-warning-background);
        color: var(--status-warning-foreground);
      }
      .reviewer-status-message.flag {
        background: none;
        border: none;
      }
      .reviewer-status-message.owner {
        background: rgba(var(--palette-primary), 1);
        color: #fff;
      }
      .reviewer-status-message.alternate {
        background: rgba(var(--palette-primary), 0.3);
        color: #fff;
      }
      .reviewer-status-message.expert {
        background: rgba(var(--palette-primary), 0.3);
        color: #fff;
      }
      .tippy-box[data-theme~='azdo-userscript'] {
        padding: 5px 10px;
      }
      .tippy-box[data-theme~='azdo-userscript'] li {
        list-style: disc;
      }
      .tippy-box[data-theme~='azdo-userscript'] h1 {
        background: rgb(255, 255, 255, 0.3);
        border-radius: 4px;
        margin-top: 0;
        padding: 5px 10px;
        font-size: 1.1em;
        text-align: center;
        line-height: 1.8em;
      }
      .tippy-box[data-theme~='azdo-userscript'] .user-message {
      }
      .owner-dir {
        opacity: 0.7;
        font-size: 80%;
      }
      .owner-file {
        display: inline-block;
        float: right;
        margin-left: 2ex;
      }`);

    const prUrl = await getCurrentPullRequestUrlAsync();
    const ownersInfo = await getNationalInstrumentsPullRequestOwnersInfo(prUrl);

    const dataMaxAgeInDays = 3;

    let employeeInfo;
    let employeeByEmail;
    let me;
    try {
      employeeInfo = await fetchJsonAndCache('employeesLatest', 12 * 60 * 60, `${azdoApiBaseUrl}/_apis/git/repositories/3378df6b-8fc9-41dd-a9d9-16640f2392cb/items?api-version=6.0&path=/data/employeesLatest.json&version=main`, 3, employees => {
        // HACK: Make the data much smaller so it fits in local storage.

        for (const employee of employees.value) {
          delete employee.username;
          delete employee.title;
          delete employee.manager_email;
          delete employee.hr_org;

          switch (employee.status) {
            case 'Active Assignment':
              delete employee.status;
              break;
            case 'Terminate Assignment':
              employee.status = 'Ex-Employee';
              break;
            case 'LOA':
              employee.status = 'Leave of Absence';
              break;
            default:
              // Keep it.
              break;
          }
        }

        return employees;
      });

      if (employeeInfo.version === 1) {
        const dataDate = dateFns.parse(employeeInfo.date);
        if (dateFns.differenceInDays(new Date(), dataDate) >= dataMaxAgeInDays) {
          // This data is too old. It hasn't been updated properly by the pipeline producing it. Avoid annotating.
          throw new Error(`Data is too old (must be ${dataMaxAgeInDays} days old or less). Data date is: ${dataDate.toISOString()}`);
        }

        employeeByEmail = _.keyBy(employeeInfo.value, 'email');
        me = employeeByEmail[currentUser.uniqueName];
      } else {
        throw new Error(`Invalid version: ${employeeInfo.version}`);
      }
    } catch (e) {
      employeeInfo = null;
      error(`Cannot annotate employee info on PRs: ${e}`);
    }

    session.onEveryNew(document, '.repos-pr-details-page .repos-reviewer', reviewer => {
      const imageUrl = $(reviewer).find('.bolt-coin-content')[0].src;
      const reviewerInfos = getPropertyThatStartsWith(reviewer.parentElement.parentElement, '__reactInternalInstance$').return.stateNode.state.values.reviewers;
      const reviewerInfo = _.find(reviewerInfos, r => imageUrl.startsWith(r.identity.imageUrl));
      const email = reviewerInfo.baseReviewer.uniqueName.toLowerCase();
      const nameElement = $(reviewer).find('.body-m')[0];

      if (ownersInfo) {
        const reviewerIdentityIndex = _.findIndex(ownersInfo.reviewProperties.reviewerIdentities, r => r.email === email);
        if (reviewerIdentityIndex >= 0) {
          // eslint-disable-next-line no-inner-declarations
          function annotateReviewerRole(label, cssClass, matcher) {
            const files = _.filter(ownersInfo.reviewProperties.fileProperties, matcher).map(f => f.path);
            if (files.length > 0) {
              let prefix = '';
              let filesToShow = files.sort();
              const maxFilesToShow = 25;

              if (files.length > maxFilesToShow) {
                filesToShow = _.take(filesToShow, maxFilesToShow);
                prefix = `<p>Showing first ${maxFilesToShow}:</p>`;
              }

              const fileListing = filesToShow
                .map(f => `<li>${escapeStringForHtml(f).replace(/^(.*\/)?([^/]+?)$/, '<span class="owner-dir">$1</span><span class="owner-file">$2</span>')}</li>`)
                .join('');

              annotateReviewer(nameElement, cssClass, `${files.length}× ${label}`, `<div style='word-wrap : break-word;'>${prefix}${fileListing}</div>`, 'none');
            }
          }

          // Note that the values for file.owner/alternate/experts may contain the value 0 (which is not a valid 1-based index) to indicate nobody for that role.
          annotateReviewerRole('owner', 'owner', f => f.owner === reviewerIdentityIndex + 1);
          annotateReviewerRole('alternate', 'alternate', f => f.alternate === reviewerIdentityIndex + 1);
          annotateReviewerRole('expert', 'expert', f => _.some(f.experts, e => e === reviewerIdentityIndex + 1));
        }
      }

      if (employeeInfo) {
        const employee = employeeByEmail[email];
        if (employee) {
          if (me.country !== employee.country) {
            annotateReviewer(nameElement, 'flag', `<img style="height: 1.2em" src="https://flagcdn.com/h20/${employee.country.toLowerCase()}.png" alt='${employee.country} flag' />`, escapeStringForHtml(employee.location_code));
          }

          if (employee.status) {
            let status = employee.status;
            if (status === 'Leave Without Pay') {
              // Be nice and not show this status like this.
              status = 'On Leave';
            }
            annotateReviewer(nameElement, 'ooo', escapeStringForHtml(status));
          }
        }
      }

      // OOO lookup via Microsoft Graph API – fires asynchronously so it doesn't block other annotations.
      // The reviewer's AAD object ID is resolved from their email inside fetchOooForEmail.
      fetchOooForEmail(email).then(ooo => {
        if (!ooo) return;

        // Strip HTML from the OOO message for safe display. DOMParser does not
        // execute scripts or fire resource-loading events (unlike innerHTML on a live node).
        const oooText = new DOMParser().parseFromString(ooo.Text, 'text/html').body.textContent || '';

        const tooltipHtml = oooText
          ? `<p style='font-weight: bold; text-align: center'>This user is out of office:</p>
          <p class="user-message">${escapeStringForHtml(oooText).trim().replace(/\r?\n/ig, '<br><br>')}</p>`
          : '<p>This user is out of office but has not set an auto-reply message.</p>';

        annotateReviewer(nameElement, 'ooo', 'Out of Office', tooltipHtml);
      }).catch(() => {}); // Silently ignore (e.g. Graph not configured, user not found)
    });
  }

  function annotateReviewer(nameElement, cssClass, labelHtml, tooltipHtml, maxWidth = '600px') {
    const messageElement = $('<span class="reviewer-status-message" />').addClass(cssClass).html(labelHtml);

    if (tooltipHtml) {
      tippy(messageElement[0], {
        content: tooltipHtml,
        allowHTML: true,
        arrow: true,
        theme: 'azdo-userscript',
        maxWidth,
      });
    }

    $(nameElement).append(messageElement);
  }

  function addEditButtons(session) {
    session.onEveryNew(document, '.repos-summary-header > div:first-child .flex-column .secondary-text:nth-child(2)', path => {
      const end = $(path).closest('.flex-row').find('.justify-end');
      const branchUrl = $('.pr-header-branches a:first-child').attr('href');
      const url = `${branchUrl}&path=${path.innerText}&_a=diff&azdouserscriptaction=edit`;
      $('<a style="margin: 0px 1em;" class="flex-end bolt-button bolt-link-button enabled bolt-focus-treatment" data-focuszone="" data-is-focusable="true" target="_blank" role="link" onclick="window.open(this.href,\'popup\',\'width=600,height=600\'); return false;">Edit</a>').attr('href', url).appendTo(end);
    });

    session.onEveryNew(document, '.repos-compare-header-commandbar.bolt-button-group', button => {
      if (eus.seen(button)) return;

      $(button).before(setupVSCodeButton(() => {
        if ($('.pr-status-completed').length > 0) {
          eus.toast.fire({
            title: 'AzDO userscript',
            text: 'Cannot open VSCode on a completed pull request.',
            icon: 'error',
          });
          return null;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const path = urlParams.get('path') || '';

        const branchUrl = `${window.location.origin}${$('.pr-header-branches a').attr('href')}`;

        const url = `${branchUrl}&path=${path}`;
        return url;
      }));
    });
  }

  async function doEditAction(session) {
    if (window.location.search.indexOf('azdouserscriptaction=edit') >= 0) {
      await eus.sleep(1500);
      $('button#__bolt-edit').click();
      $('div#__bolt-tab-diff').click();
    }
  }

  // This is "main()" for this script. Runs periodically when the page updates.
  function onPageUpdated() {
    try {
      // The page may not have refreshed when moving between URLs--sometimes AzDO acts as a single-page application. So we must always check where we are and act accordingly.
      if (/\/(pullrequest)\//i.test(window.location.pathname)) {
        // TODO: BROKEN IN NEW PR UX: applyStickyPullRequestComments();
        // TODO: BROKEN IN NEW PR UX: highlightAwaitComments();
        addAccessKeysToPullRequestTabs();
        if (atNI) {
          conditionallyAddBypassReminderAsync();
        }
      }

      if (/\/(pullrequests)/i.test(window.location.pathname)) {
        addOrgPRLink();
      }
    } catch (e) {
      eus.toast.fire({
        title: 'AzDO userscript error',
        text: 'See JS console for more info.',
        icon: 'error',
        showConfirmButton: true,
        confirmButtonColor: '#d43',
        confirmButtonText: '<i class="fa fa-bug"></i> Get Help!',
      }).then((result) => {
        if (result.value) {
          window.open(GM_info.script.supportURL, '_blank');
        }
      });
      throw e;
    }
  }

  enhanceOverallUX();

  addStyleOnce('labels', /* css */ `
    /* Known bug severities we should style. */
    .pr-bug-severity-1 {
      background: #a008 !important;
    }
    .pr-bug-severity-2 {
      background: #fd38 !important;
    }
    /* Align labels to the right and give them a nice border. */
    .repos-pr-list .bolt-pill-group {
      flex-grow: 1;
      justify-content: flex-end;
    }
    .bolt-pill {
      border: 1px solid #0001;
    }
    /* Known labels we should style. */
    .pr-annotation:not([title=""]) {
      cursor: help !important;
    }
    .pr-annotation.file-count,
    .pr-annotation.build-status {
      background: #fff4 !important;
      min-width: 8ex;
    }`);

  if (atNI) {
    addStyleOnce('ni-labels', /* css */ `
      /* Known labels we should style. */
      .bolt-pill[aria-label='draft' i] {
        background: #8808 !important;
      }
      .bolt-pill[aria-label='tiny' i] {
        background: #0a08 !important;
      }
      .bolt-pill[aria-label~='blocked' i] {
        background: #a008 !important;
      }`);
  }

  addStyleOnce('bypassOwnersPrompt', /* css */ `
    .bypass-reminder {
      display: inline;
      position: absolute;
      top: 38px;
      left: -250px;
      z-index: 1000;
      background-color: #E6B307;
      color: #222;
      font-weight: bold;
      padding: 3ch 5ch;
      font-size: 16px;
      border-radius: 6px 0px 6px 6px;
      box-shadow: 4px 4px 4px #18181888;
      opacity: 0;
      transition: 0.3s;
    }
    .bypass-reminder-container {
      position: relative;
      display: inline-flex;
      flex-direction: column;
    }
    .vote-button-wrapper {
      border: 3px solid transparent;
      border-radius: 4px 4px 0px 0px;
      transition: 0.3s;
    }
    .vote-button-wrapper:hover {
      border-color: #E6B307;
    }
    .vote-button-wrapper:hover ~ .bypass-reminder {
      opacity: 1;
    }`);

  function watchForWorkItemForms() {
    eus.globalSession.onEveryNew(document, '#__bolt-follow', followButton => {
      followButton.addEventListener('click', async _ => {
        await eus.sleep(1000); // We need to allow the other handlers to send the request to follow/unfollow. After the request is sent, we can annotate our follows list correctly.
        await annotateWorkItemWithFollowerList(document.querySelector('.comment-editor.enter-new-comment'));
      });
    });
    // Annotate work items (under the comment box) with who is following it.
    eus.globalSession.onEveryNew(document, '.comment-editor.enter-new-comment', async commentEditor => {
      await annotateWorkItemWithFollowerList(commentEditor);
    });
  }

  async function annotateWorkItemWithFollowerList(commentEditor) {
    const commentEditorContainer = commentEditor.closest('.new-comment-div');
    commentEditorContainer.querySelectorAll('.work-item-followers-list').forEach(e => e.remove());

    const workItemId = getCurrentWorkItemId(commentEditor);
    const queryResponse = await fetch(`${azdoApiBaseUrl}_apis/notification/subscriptionquery?api-version=6.0`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conditions: [
          {
            filter: {
              type: 'Artifact',
              eventType: '',
              artifactId: workItemId,
              artifactType: 'WorkItem',
            },
          },
        ],
        queryFlags: 'alwaysReturnBasicInformation',
      }),
    });
    const followers = [...(await queryResponse.json()).value].sort((a, b) => a.subscriber.displayName.localeCompare(b.subscriber.displayName));
    const followerList = followers
      .map(s => `<a class="bolt-link no-underline-link" target="_blank" href="https://teams.microsoft.com/l/chat/0/0?users=${s.subscriber.uniqueName}">${s.subscriber.displayName}</a>`)
      .join(', ');
    if (followerList) {
      const annotation = `<div class="work-item-followers-list" style="margin: 1em 0em; opacity: 0.7"><span class="menu-item-icon bowtie-icon bowtie-watch-eye-fill" aria-hidden="true"></span> ${followerList}</div>`;
      commentEditor.insertAdjacentHTML('afterend', annotation);
    }
  }

  function getCurrentWorkItemId(commentEditor) {
    // Try getting the link from the work item header, in case this is opened in preview view
    const workItemPage = commentEditor.closest('.work-item-form-page');
    const header = workItemPage.querySelector('.work-item-form-header');
    const links = header.querySelectorAll('a');
    // Loop through the links and check if their target matches a link for a work item
    const workItemLink = Array.from(links).find(link => link.href.includes('_workitems'));

    // Default to the window URL if the find operation fails
    let currentUrl = window.location.href;
    if (workItemLink) {
      currentUrl = workItemLink.href;
    }

    const [baseUrl] = currentUrl.split('?');
    const urlSegments = baseUrl.split('/');
    const workItemId = urlSegments[urlSegments.length - 1];

    return workItemId;
  }

  function watchForRepoBrowsingPages(session) {
    // Add a copy branch button.
    session.onEveryNew(document, '.version-dropdown > button', versionSelector => {
      if (eus.seen(versionSelector.parent())) return;

      const copyButton = $('<button />')
        .attr('class', 'bolt-header-command-item-button bolt-button bolt-icon-button enabled bolt-focus-treatment subtle')
        .css('font-family', 'Bowtie')
        .css('font-size', '14px')
        .css('font-weight', 'normal')
        .attr('title', 'Copy branch name to clipboard')
        .text('\uE94B') // A copy icon in the Bowtie font.
        .click(event => {
          const branchName = $(versionSelector).find('.bolt-dropdown-expandable-button-label').text();

          navigator.clipboard.writeText(branchName);

          eus.toast.fire({
            title: 'AzDO userscript',
            text: `Copied branch name to clipboard: ${branchName}`,
            icon: 'info',
          });

          event.stopPropagation();
        });

      $(versionSelector).after(copyButton);
    });

    session.onEveryNew(document, '.repos-files-header .bolt-header-title-area', fileName => {
      if (eus.seen(fileName)) return;

      $(fileName).after(setupVSCodeButton());
    });
  }

  function setupVSCodeButton(getUrl = () => window.location.href) {
    function navigateToVSCode() {
      let url = getUrl();
      if (!url) return;

      url = url.replace('/DefaultCollection/', '/'); // For some reason, we need to remove this.
      url = url.replace(/^https?:\/\//i, 'https://vscode.dev/');

      window.location = url;
    }

    const vscodeButton = $('<button />')
      .attr('class', 'bolt-header-command-item-button bolt-button bolt-icon-button enabled bolt-focus-treatment')
      .attr('type', 'button')
      .attr('title', 'Edit in vscode.dev')
      .html('<img src="https://vscode.dev/static/stable/favicon.ico" style="width: 16px; margin-right: 1ex;" alt="vscode.dev" /><span class="bolt-button-text body-m">Open in VSCode</span>')
      .click(event => {
        navigateToVSCode();
        event.stopPropagation();
      });

    $(document.body).on('keyup', event => {
      if (event.key === '.' && event.target === document.body) {
        navigateToVSCode();
        event.stopPropagation();
      }
    });

    return vscodeButton;
  }

  function watchForShowMoreButtons() {
    // Auto-click Show More buttons on work item forms, until they disappear or until we've pressed it 10 times (a reasonable limit which will still bring in 60 more items into view).
    eus.globalSession.onEveryNew(document, 'div[role="button"].la-show-more', async showMoreButton => {
      if (eus.seen(showMoreButton)) return;

      let clicks = 0;
      while (document.body.contains(showMoreButton)) {
        showMoreButton.click();

        clicks += 1;
        if (clicks >= 10) break;

        // eslint-disable-next-line no-await-in-loop
        await eus.sleep(100);
      }
    });

    // Auto-click Show More buttons on Kanban boards, until they disappear, are hidden, or until we've pressed it 2 times (a reasonable limit which will still bring in hundreds of items into view).
    eus.globalSession.onEveryNew(document, 'a[role="button"].see-more-items', async showMoreButton => {
      if (eus.seen(showMoreButton)) return;

      // Don't expand unless the New column is visible.
      if (!document.querySelector('#boardContainer .header-container i[aria-label="Collapse New column"]')) return;

      const container = showMoreButton.closest('.page-items-container');
      let clicks = 0;

      while (document.body.contains(showMoreButton) && container.style.display !== 'none') {
        if (showMoreButton.style.display !== 'none') {
          showMoreButton.click();

          clicks += 1;
          if (clicks > 2) break;
        }

        // eslint-disable-next-line no-await-in-loop
        await eus.sleep(1000);
      }
    });
  }

  function getRepoNameFromUrl(url) {
    const repoName = url.match(/_git\/(.+)\/pullrequests/)[1];
    return repoName || '';
  }

  function addOrgPRLink() {
    $('.bolt-header-title.title-m.l').once('decorate-with-org-pr-link').each(function () {
      const titleElement = this;
      titleElement.innerText = `${getRepoNameFromUrl(window.location.pathname)} ${titleElement.innerText}`;
      const orgPRLink = document.createElement('a');
      orgPRLink.href = `${azdoApiBaseUrl}_pulls`;
      orgPRLink.text = '→ View global PR dashboard';
      orgPRLink.style = 'margin: 15px; font-size: 80%; text-decoration: none; color: var(--communication-foreground,rgba(0, 90, 158, 1)); font-weight: normal';
      titleElement.insertAdjacentElement('beforeend', orgPRLink);
    });
  }

  // eslint-disable-next-line no-unused-vars
  function highlightAwaitComments() {
    // Comments that start with this string are highlighted. No other behavior is given to them.
    const lowerCasePrefix = 'await:';

    addStyleOnce('highlight-await-comments', /* css */ `
      .vc-discussion-thread-box .vc-discussion-thread-comment .vc-discussion-thread-renderparent[content^="${lowerCasePrefix}" i] {
        border: 2px solid rgb(var(--palette-accent3));
        border-radius: 5px;
        margin: 7px 0px;
        padding: 10px 15px;
      }`);
  }

  // eslint-disable-next-line no-unused-vars
  function applyStickyPullRequestComments() {
    // Comments that start with this string become sticky. Only the first comment of the thread counts.
    const lowerCasePrefix = 'note:';

    addStyleOnce('sticky-comments', /* css */ `
      .vc-discussion-thread-box .vc-discussion-thread-comment:first-of-type .vc-discussion-thread-renderparent[content^="${lowerCasePrefix}" i] {
        border: 2px solid var(--palette-black-alpha-20);
        border-radius: 5px;
        margin: 7px 0px;
        padding: 10px 15px;
      }`);

    // Expand threads that have the sticky prefix.
    const lowerCasePrefixCssSelector = CSS.escape(`: "${lowerCasePrefix}`);
    $('.discussion-thread-host').once('expand-sticky-threads-on-load').each(async function () {
      await eus.sleep(100);
      const button = this.querySelector(`button.ms-Button.expand-button[aria-label*="${lowerCasePrefixCssSelector}" i]`);
      if (button) {
        button.click();
      }
    });
  }

  function addAccessKeysToPullRequestTabs() {
    // Give all the tabs an access key equal to their numeric position on screen.
    $('.repos-pr-details-page-tabbar a').once('add-accesskeys').each(function () {
      $(this).attr('accesskey', $(this).attr('aria-posinset'));
    });
  }

  function enhanceOverallUX() {
    addStyleOnce('enhance-overall-ux', /* css */ `
      /* Colored scrollbars */
      ::-webkit-scrollbar {
        width: 15px;
        height: 15px;
      }
      ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner {
        background: rgb(var(--palette-neutral-4));
      }
      ::-webkit-scrollbar-thumb {
        background: rgb(var(--palette-neutral-20));
      }
      /* Bigger dropdown menus */
      .identity-picker-dropdown ul.items, .scroll-tree-overflow-box, .ui-autocomplete, .vss-PickList--items {
        max-height: 50vh !important;
      }
      /* Prompts to add links to work items are much less prominent, unless hovered over */
      .zero-data-action, .deployments-zero-data {
        opacity: 0.2;
      }
      .zero-data-action img, .deployments-zero-data img,
      .zero-data-action i, .deployments-zero-data i {
        display: none;
      }
      .zero-data-action:hover, .deployments-zero-data:hover {
        opacity: 1;
      }
      /* Make the My Work / My PR dropdown on the top-right of every page much bigger. */
      .bolt-panel-callout-content.flyout-my-work {
        max-height: 90vh;
      }
      /* Make PR comments more compact! */
      .repos-discussion-comment-header {
        margin-bottom: 4px;
      }
      /* swal CSS fixes, since AzDO overrides some styles that will conflict with dialogs. */
      .swal2-footer {
        opacity: 0.6;
      }
      .swal2-html-container {
        text-align: left;
      }
      .swal2-html-container code {
        background-color: rgba(0,0,0,.06);
        padding: 0.2em 0.4em;
        border-radius: 0.2em;
      }
      .swal2-html-container li {
        list-style: disc;
        margin-left: 4ch;
        margin-bottom: 0.5em;
      }`);
  }

  // Adds a bypass suggestion message that pops up when the user mouses over the Approve button.
  async function conditionallyAddBypassReminderAsync() {
    // Only add it if the target branch requires owner approval
    if (!(await pullRequestHasRequiredOwnersPolicyAsync())) {
      return;
    }

    if ($('.bypass-reminder-container').length > 0) {
      return;
    }

    const container = document.createElement('div');
    container.classList.add('bypass-reminder-container');

    const banner = document.createElement('div');
    banner.classList.add('bypass-reminder');
    banner.appendChild(document.createTextNode('If you are confident the change needs no further review, please bypass owners.'));

    if ($('.repos-pr-header-vote-button').length === 0) {
      // "old" PR experience
      $('#pull-request-vote-button')
        .parent()
        .parent()
        .addClass('vote-button-wrapper')
        .appendTo(container);
      container.appendChild(banner);
      $('.vote-control-container').append(container);
    } else {
      // "new" PR experience
      const voteButton = document.getElementsByClassName('repos-pr-header-vote-button')[0];
      // We cannot change the parent of voteButton, or we get an error when pressing the approve button.
      // Instead, we'll wedge our "container" div between the voteButton and its children.
      // Because the voteButton's children will be moved under our container, we'll need to create a new wrapping element (by cloning the old parent) to keep them laid-out properly.
      const buttonLayoutWrapper = voteButton.cloneNode(false);
      buttonLayoutWrapper.classList.add('vote-button-wrapper');
      buttonLayoutWrapper.append(voteButton.children[0]);
      buttonLayoutWrapper.append(voteButton.children[0]);
      buttonLayoutWrapper.append(voteButton.children[0]);

      container.append(buttonLayoutWrapper);
      container.append(banner);

      voteButton.append(container);
    }
  }

  // Adds a "Trophies" section to the Overview tab of a PR for a qualifying PR number
  function addTrophiesToPullRequest(session, pageData) {
    session.onEveryNew(document, '.repos-overview-right-pane', elm => {
      if ($('#trophies-section').length > 0) return;

      const pr = pageData['ms.vss-code-web.pr-detail-data-provider'].pullRequest;
      const prId = pr.pullRequestId;
      const prAuthor = pr.createdBy.displayName;

      const trophiesAwarded = [];

      /* eslint-disable brace-style */

      // Milestone trophy: Awarded if pull request ID is greater than 1000 and is a non-zero digit followed by only zeroes (e.g. 1000, 5000, 10000).
      if (prId >= 1000 && prId.toString().match('^[1-9]0+$')) {
        const milestoneTrophyMessage = $('<div>').addClass('bolt-table-cell-content').text(`🏆 ${prAuthor} got pull request #${prId}`);
        trophiesAwarded.push(milestoneTrophyMessage);
      }
      // Repeating digits trophy: Awarded if the ID is greater than 100 and consists of only one repeated digit (e.g. 1111, 2222).
      else if (prId > 100 && /^(\d)\1+$/.test(prId.toString())) {
        const repeatingDigitMessage = $('<div>').addClass('bolt-table-cell-content').text(`🔢 ${prAuthor} got a fancy pull request #${prId}`);
        trophiesAwarded.push(repeatingDigitMessage);
      }
      // Fish trophy: Give a man a fish, he'll waste hours trying to figure out why.
      // Awarded if the ID is greater than 100 and is a palindrome (e.g. 12321).
      else if (prId > 100 && prId.toString() === prId.toString().split('').reverse().join('')) {
        const fishTrophyMessage = $('<div>').addClass('bolt-table-cell-content').text(`🐠 ${prAuthor} got a fish trophy`);
        trophiesAwarded.push(fishTrophyMessage);
      }

      // First PR.
      if (prId === 1) {
        const firstPrTrophyMessage = $('<div>').addClass('bolt-table-cell-content').text(`🥇 ${prAuthor} is first`);
        trophiesAwarded.push(firstPrTrophyMessage);
      }
      // 42: The answer to life, the universe, and everything.
      else if (prId === 42) {
        const meaningOfLifeMessage = $('<div>').addClass('bolt-table-cell-content').text(`🌌 ${prAuthor} found the answer to life, the universe, and everything`);
        trophiesAwarded.push(meaningOfLifeMessage);
      }
      // 404: Not found.
      else if (prId === 404) {
        const notFoundMessage = $('<div>').addClass('bolt-table-cell-content').text(`🔍 ${prAuthor}'s pull request was not found (just kidding, here it is)`);
        trophiesAwarded.push(notFoundMessage);
      }
      // 418: I'm a teapot.
      else if (prId === 418) {
        const teapotMessage = $('<div>').addClass('bolt-table-cell-content').text(`🫖 ${prAuthor} is a teapot`);
        trophiesAwarded.push(teapotMessage);
      }
      // 666: The number of the beast.
      else if (prId === 666) {
        const beastMessage = $('<div>').addClass('bolt-table-cell-content').text(`😈 ${prAuthor} is a beast`);
        trophiesAwarded.push(beastMessage);
      }
      // 777: Lucky sevens.
      else if (prId === 777) {
        const luckyMessage = $('<div>').addClass('bolt-table-cell-content').text(`🎰 ${prAuthor} hit the jackpot`);
        trophiesAwarded.push(luckyMessage);
      }
      // 1337 leetspeak.
      else if (prId === 1337) {
        const leetMessage = $('<div>').addClass('bolt-table-cell-content').text(`👨‍💻 ${prAuthor} speaks leet`);
        trophiesAwarded.push(leetMessage);
      }
      // 31337 elite leetspeak.
      else if (prId === 31337) {
        const eliteLeetMessage = $('<div>').addClass('bolt-table-cell-content').text(`🧠 ${prAuthor} speaks elite!`);
        trophiesAwarded.push(eliteLeetMessage);
      }

      /* eslint-enable brace-style */

      if (trophiesAwarded.length > 0) {
        const header = $('<div/>').addClass('bolt-header-title body-xl m').text('Trophies');
        const sectionContent = $('<div/>').append(trophiesAwarded);
        const section = $('<div/>').attr('id', 'trophies-section').append(header).append(sectionContent);
        $(elm).append(section);
      }
    });
  }

  function fixScrollBarColor() {
    GM_addStyle('.custom-scrollbar { scrollbar-color: rgb(99 99 99) black !important; }');
  }

  async function watchForLVDiffsAndAddNIBinaryDiffButton(session) {
    // NI Binary Diff is only supported on Windows
    if (navigator.userAgent.indexOf('Windows') === -1) return;

    addStyleOnce('ni-binary-git-diff', /* css */ `
      .ni-binary-git-diff-button {
        border-color: #03b585;
        border-radius: 2px;
        border-style: solid;
        border-width: 1px;
        color: #03b585;
      }
      .ni-binary-git-diff-dialog{
        border-color: #03b585;
        border-style: solid;
        border-width: 1px;
        display: none;
        padding: 10px;
      }`);

    const supportedFileExtensions = ['vi', 'vim', 'vit', 'ctt', 'ctl'];
    const prUrl = await getCurrentPullRequestUrlAsync();
    const iterations = (await $.get(`${prUrl}/iterations?api-version=5.0`)).value;

    session.onEveryNew(document, '.bolt-messagebar.severity-info .bolt-messagebar-buttons', boltMessageBarButtons => {
      const reposSummaryHeader = $(boltMessageBarButtons).closest('.repos-summary-header');
      const filePathElement = (reposSummaryHeader.length > 0 ? reposSummaryHeader : $('.repos-compare-toolbar')).find('.secondary-text.text-ellipsis')[0];
      if (!filePathElement) return;

      const filePath = filePathElement.innerText;
      if (!supportedFileExtensions.includes(getFileExt(filePath))) return;

      const launchDiffButton = $('<button class="bolt-button flex-grow-2 ni-binary-git-diff-button">Launch NI Binary Git Diff ▶</button>');
      const helpButton = $('<button class="bolt-button flex-grow-1 ni-binary-git-diff-button">?</button>');

      launchDiffButton.on('click', (event) => {
        const currentUrl = new URL(window.location.href);

        let iterationIndex = currentUrl.searchParams.get('iteration');
        if (iterationIndex) {
          iterationIndex -= 1;
        } else {
          iterationIndex = iterations.length - 1;
        }
        const afterCommitId = iterations[iterationIndex].sourceRefCommit.commitId;

        let beforeCommitId = iterations[0].commonRefCommit.commitId;
        let baseIndex = currentUrl.searchParams.get('base');
        if (baseIndex) {
          baseIndex -= 1;
          if (baseIndex >= 0) {
            beforeCommitId = iterations[baseIndex].sourceRefCommit.commitId;
          }
        }
        const protocolHandlerAddress = `NIBinary.GitDiff:${filePath},${beforeCommitId},${afterCommitId}`;
        window.location = protocolHandlerAddress;
      });

      helpButton.on('click', (event) => {
        swal.fire({
          title: 'This is a preview feature!',
          icon: 'warning',
          text: 'You need to install the "NIBinary.GitDiff.reg" Protocol Handler first. To get it, please talk to Humberto Garza, or search for "Launch NI Binary Git Diff" in the Azure DevOps NI Wiki for instructions.',
          confirmButtonColor: '#03b585',
          confirmButtonText: 'Close',
        });
      });

      $(boltMessageBarButtons).append(launchDiffButton);
      $(boltMessageBarButtons).append(helpButton);
    });
  }

  addStyleOnce('pr-dashboard-css', /* css */ `
    table.repos-pr-list tbody > a {
      transition: 0.2s;
    }
    table.repos-pr-list tbody > a.voted-waiting > td > * {
      opacity: 0.15;
    }
    .repos-pr-list-late-review-pill.outlined {
      border-color: #f00;
      border-color: var(--status-error-text,rgba(177, 133, 37, 1));
      color: #f00;
      color: var(--status-error-text,rgba(177, 133, 37, 1));
      background: var(--status-error-background,rgba(177, 133, 37, 1));
      cursor: help;
    }`);

  function watchPullRequestDashboard() {
    eus.onUrl(/\/(_pulls|pullrequests)/gi, (session, urlMatch) => {
      session.onEveryNew(document, '.repos-pr-section-card', section => {
        const sectionTitle = section.querySelector('.repos-pr-section-header-title > span').innerText;
        if (sectionTitle !== 'Assigned to me' && sectionTitle !== 'Created by me') return;

        session.onEveryNew(section, 'a[role="row"]', (row, addedDynamically) => {
          // AzDO re-adds PR rows when it updates them with in JS. That's the one we want to enhance.
          if (!addedDynamically) return;

          enhancePullRequestRow(row, sectionTitle);

          // React will re-use this DOM element, so we need to re-enhance.
          session.onAnyChangeTo(row, () => enhancePullRequestRow(row, sectionTitle));
        });
      });
    });
  }

  function watchForBuildResultsPage() {
    eus.onUrl(/\/(_build\/results)/gi, (session, urlMatch) => {
      session.onEveryNew(document, '.bolt-master-panel', panel => {
        $(panel).css('resize', 'horizontal');
      });
    });
  }

  async function enhancePullRequestRow(row, sectionTitle) {
    const pullRequestUrl = new URL(row.href, window.location.origin);
    const pullRequestId = parseInt(pullRequestUrl.pathname.substring(pullRequestUrl.pathname.lastIndexOf('/') + 1), 10);

    // Skip if we've already processed this PR.
    if (row.dataset.pullRequestId === pullRequestId.toString()) return;
    // eslint-disable-next-line no-param-reassign
    row.dataset.pullRequestId = pullRequestId;

    // TODO: If you switch between Active and Reviewed too fast, you may get duplicate annotations.

    // Remove annotations a previous PR may have had. Recall that React reuses DOM elements.
    row.classList.remove('voted-waiting');
    for (const element of row.querySelectorAll('.repos-pr-list-late-review-pill')) {
      element.remove();
    }
    for (const element of row.querySelectorAll('.userscript-bolt-pill-group')) {
      element.remove();
    }
    for (const element of row.querySelectorAll('.pr-annotation')) {
      element.remove();
    }

    const pr = await getPullRequestAsync(pullRequestId);

    // Sometimes, PRs lose their styling shortly after the page loads. A slight delay makes this problem go away, 99% of the time. Sucks -- but works and better to have this than not.
    await eus.sleep(333);

    if (sectionTitle === 'Assigned to me') {
      const votes = countVotes(pr);

      // TODO: If you press the PR menu button, the PR loses it's styling.
      row.classList.toggle('voted-waiting', votes.userVote === -5);

      await annotateBugsOnPullRequestRow(row, pr);
      await annotateFileCountOnPullRequestRow(row, pr);
      await annotateBuildStatusOnPullRequestRow(row, pr);
      annotateSourceBranchOnPullRequestRow(row, pr);

      if (votes.userVote === 0 && votes.missingVotes === 1 && votes.userIsRequired && !votes.userHasDeclined) {
        annotatePullRequestTitle(row, 'repos-pr-list-late-review-pill', 'Last Reviewer', 'Everyone is waiting on you!');
      }

      if (atNI && votes.userVote === 0) {
        const prThreadsNewestFirst = (await $.get(`${pr.url}/threads?api-version=5.0`)).value.filter(x => !x.isDeleted).reverse();
        const dateAdded = getReviewerAddedOrResetTime(prThreadsNewestFirst, currentUser.uniqueName) || pr.createdDate;
        const weekDays = differenceInWeekDays(new Date(dateAdded), new Date());
        if (weekDays >= 1) {
          const lastInteraction = getReviewerLastInteractionTime(prThreadsNewestFirst, currentUser.uniqueName);
          if (!lastInteraction || new Date(dateAdded) > new Date(lastInteraction)) {
            annotatePullRequestTitle(row, 'repos-pr-list-late-review-pill', `${weekDays} days old`, "# of week days since you've been added or reset. Reviewers are expected to comment or vote within 1 business day.");
          }
        }
      }
    } else {
      await annotateBugsOnPullRequestRow(row, pr);
      await annotateFileCountOnPullRequestRow(row, pr);
      await annotateBuildStatusOnPullRequestRow(row, pr);
      annotateSourceBranchOnPullRequestRow(row, pr);
    }
  }

  function differenceInWeekDays(startDate, endDate) {
    let days = (endDate - startDate) / (1000.0 * 60 * 60 * 24);
    const date = new Date(startDate);
    while (date <= endDate) {
      if (date.getDay() === 0 || date.getDay() === 6) {
        days -= 1.0;
      }
      date.setDate(date.getDate() + 1);
    }
    return days < 0 ? 0 : days.toFixed(1);
  }

  function getReviewerAddedOrResetTime(prThreadsNewestFirst, reviewerUniqueName) {
    for (const thread of prThreadsNewestFirst) {
      if (thread.properties) {
        if (Object.prototype.hasOwnProperty.call(thread.properties, 'CodeReviewReviewersUpdatedAddedIdentity')) {
          const addedReviewer = thread.identities[thread.properties.CodeReviewReviewersUpdatedAddedIdentity.$value];
          if (addedReviewer.uniqueName === reviewerUniqueName) {
            return thread.publishedDate;
          }
        } else if (Object.prototype.hasOwnProperty.call(thread.properties, 'CodeReviewResetMultipleVotesExampleVoterIdentities')) {
          if (Object.keys(thread.identities).filter(x => thread.identities[x].uniqueName === reviewerUniqueName)) {
            return thread.publishedDate;
          }
        }
      }
    }
    return null;
  }

  function getReviewerLastInteractionTime(prThreadsNewestFirst, reviewerUniqueName) {
    for (const thread of prThreadsNewestFirst) {
      // This includes both user comments, threads, and votes (since votes post comments).
      for (const comment of thread.comments) {
        if (comment.author.uniqueName === reviewerUniqueName) {
          return comment.publishedDate;
        }
      }
    }
    return null;
  }

  function countVotes(pr) {
    const votes = {
      missingVotes: 0,
      waitingOrRejectedVotes: 0,
      userVote: 0,
      userIsRequired: true,
      userHasDeclined: false,
    };

    for (const reviewer of pr.reviewers) {
      if (reviewer.uniqueName === currentUser.uniqueName) {
        votes.userVote = reviewer.vote;
        votes.userIsRequired = reviewer.isRequired;
        votes.userHasDeclined = reviewer.hasDeclined;
      }
      if (reviewer.vote === 0) {
        votes.missingVotes += 1;
      } else if (reviewer.vote < 0) {
        votes.waitingOrRejectedVotes += 1;
      }
    }

    return votes;
  }

  async function annotateBugsOnPullRequestRow(row, pr) {
    const workItemRefs = (await $.get(`${pr.url}/workitems?api-version=5.1`)).value;
    let highestSeverityBug = null;
    let highestSeverity = 100; // highest sev is lowest number
    let otherHighestSeverityBugsCount = 0;

    for (const workItemRef of workItemRefs) {
      // eslint-disable-next-line no-await-in-loop
      const workItem = await $.get(`${workItemRef.url}?api-version=5.1`);
      if (workItem.fields['System.WorkItemType'] === 'Bug') {
        const severityString = workItem.fields['Microsoft.VSTS.Common.Severity'];
        if (severityString) {
          const severity = parseInt(severityString.replace(/ - .*$/, ''), 10);
          if (severity < highestSeverity) { // lower severity value is higher severity
            highestSeverity = severity;
            highestSeverityBug = workItem;
            otherHighestSeverityBugsCount = 0;
          } else if (severity === highestSeverity) {
            otherHighestSeverityBugsCount += 1;
          }
        }
      }
    }

    if (highestSeverityBug && highestSeverity <= 2) {
      let title = highestSeverityBug.fields['System.Title'];
      if (otherHighestSeverityBugsCount) {
        title += ` (and ${otherHighestSeverityBugsCount} other)`;
      }

      annotatePullRequestLabel(row, `pr-bug-severity-${highestSeverity}`, title, `SEV${highestSeverity}`);
    }
  }

  async function annotateFileCountOnPullRequestRow(row, pr) {
    let fileCount;

    if (pr.lastMergeCommit) {
      fileCount = 0;

      // See if this PR has owners info and count the files listed for the current user.
      const ownersInfo = await getNationalInstrumentsPullRequestOwnersInfo(pr.url);
      if (ownersInfo) {
        fileCount = ownersInfo.currentUserFileCount;
      }

      // If there is no owner info or if it returns zero files to review (since we may not be on the review explicitly), then count the number of files in the merge commit.
      if (fileCount === 0) {
        const mergeCommitInfo = await $.get(`${pr.lastMergeCommit.url}/changes?api-version=5.0`);
        const files = _(mergeCommitInfo.changes).filter(item => !item.item.isFolder);
        fileCount = files.size();
      }
    } else {
      fileCount = '⛔';
    }

    const label = `<span class="contributed-icon flex-noshrink fabric-icon ms-Icon--FileCode"></span>&nbsp;${fileCount}`;
    annotatePullRequestLabel(row, 'file-count', '# of files you need to review', label);
  }

  async function annotateBuildStatusOnPullRequestRow(row, pr) {
    if (!pr.lastMergeCommit) return;

    const builds = (await $.get(`${pr.lastMergeCommit.url}/statuses?api-version=5.1&latestOnly=true`)).value;
    if (!(builds && builds.length)) return;

    let state;
    if (builds.every(b => b.state === 'succeeded' || b.description.includes('partially succeeded'))) {
      state = '✔️';
    } else if (builds.some(b => b.state === 'pending')) {
      state = '▶️';
    } else {
      state = '❌';
    }

    const tooltip = _.map(builds, 'description').join('\n');
    const label = `<span aria-hidden="true" class="contributed-icon flex-noshrink fabric-icon ms-Icon--Build"></span>&nbsp;${state}`;
    annotatePullRequestLabel(row, 'build-status', tooltip, label);
  }

  function annotateSourceBranchOnPullRequestRow(row, pr) {
    if (!pr.lastMergeCommit) return;

    const sourceBranch = pr.sourceRefName.replace(/^refs\/heads\//, '');

    const secondary = row.querySelector('.secondary-text span');
    if (['refs/heads/master', 'refs/heads/main'].includes(pr.targetRefName)) {
      // Hide target branch and icon if it's main or master, which is very common
      secondary.querySelector('.ms-Icon--OpenSource').remove(); // Branch icon
      secondary.querySelector('.monospaced-xs').remove(); // Branch name
      secondary.innerHTML = secondary.innerHTML.replace('into ', '');
    }

    const sourceBranchAnnotation = `from
      <span class="fluent-icons-enabled"><span aria-hidden="true" class="flex-noshrink fabric-icon ms-Icon--OpenSource"
      ></span></span><span class="monospaced-xs padding-horizontal-4">${sourceBranch}</span>`;
    secondary.insertAdjacentHTML('beforeend', sourceBranchAnnotation);
  }

  function annotatePullRequestTitle(row, cssClass, message, tooltip) {
    const blockingAnnotation = `
      <div aria-label="Auto-complete" class="${cssClass} flex-noshrink margin-left-4 bolt-pill flex-row flex-center outlined compact" data-focuszone="focuszone-19" role="presentation" title="${tooltip}">
        <div class="bolt-pill-content text-ellipsis">${message}</div>
      </div>`;
    const title = row.querySelector('.body-l');
    title.insertAdjacentHTML('afterend', blockingAnnotation);
  }

  function annotatePullRequestLabel(pullRequestRow, cssClass, title, html) {
    let labels = pullRequestRow.querySelector('.bolt-pill-group-inner');

    // The PR may not have any labels to begin with, so we have to construct the label container.
    if (!labels) {
      // eslint-disable-next-line prefer-destructuring
      const labelContainer = $(`
        <div class="userscript-bolt-pill-group margin-left-8 bolt-pill-group flex-row">
          <div class="bolt-pill-overflow flex-row">
            <div class="bolt-pill-group-inner flex-row">
            </div>
            <div class="bolt-pill-observe"></div>
          </div>
        </div>`)[0];
      pullRequestRow.querySelector('.bolt-table-two-line-cell-item').insertAdjacentElement('beforeend', labelContainer);
      labels = pullRequestRow.querySelector('.bolt-pill-group-inner');
    }

    const label = `
      <div class="pr-annotation bolt-pill flex-row flex-center standard compact ${cssClass}" data-focuszone="focuszone-75" role="presentation" title="${escapeStringForHtml(title)}">
        <div class="bolt-pill-content text-ellipsis">${html}</div>
      </div>`;
    labels.insertAdjacentHTML('beforeend', label);
  }

  let globalOwnersInfo;

  function onFilesTreeChange() {
    const hasOwnersInfo = globalOwnersInfo && globalOwnersInfo.currentUserFileCount > 0;
    if (!hasOwnersInfo) {
      return;
    }

    $('.repos-changes-explorer-tree .bolt-tree-row').each(function () {
      const fileRow = $(this);
      const text = fileRow.find('span.text-ellipsis');
      const item = text.parent();

      // For non-file/folder items in the tree (e.g. comments), we won't find a text span
      if (text.length === 0) {
        return;
      }

      /* eslint no-underscore-dangle: ["error", { "allow": ["_owner"] }] */
      const pathAndChangeType = getPropertyThatStartsWith(text[0], '__reactInternalInstance$').memoizedProps.children._owner.stateNode.props.data.path;
      const pathWithLeadingSlash = pathAndChangeType.replace(/ \[[a-z]+\]( renamed from .+)?$/, '');
      const path = pathWithLeadingSlash.substring(1); // Remove leading slash.

      const isFolder = item[0].children[0].classList.contains('repos-folder-icon');

      // If we have owners info, mark folders that have files we need to review. This will allow us to highlight them if they are collapsed.
      const folderContainsFilesToReview = isFolder && globalOwnersInfo.isCurrentUserResponsibleForFileInFolderPath(`${path}/`);
      fileRow.toggleClass('folder-to-review-row', folderContainsFilesToReview);
      fileRow.toggleClass('auto-collapsible-folder', !folderContainsFilesToReview);

      // If we have owners info, highlight the files we need to review and add role info.
      const isFileToReview = !isFolder && globalOwnersInfo.isCurrentUserResponsibleForFile(path);
      item.parent().toggleClass('file-to-review-row', isFileToReview);
      if (isFileToReview) {
        if (fileRow.find('.file-owners-role').length === 0) {
          $('<div class="file-owners-role" />').text(`${globalOwnersInfo.currentUserFilesToRole[path]}:`).prependTo(item.parent());
        }
      } else {
        fileRow.find('.file-owners-role').remove();
      }
    });
  }

  function watchFilesTree() {
    addStyleOnce('pr-file-tree-annotations-css', `
        :root {
          --file-to-review-color: var(--communication-foreground);
        }
        .repos-changes-explorer-tree .file-to-review-row,
        .repos-changes-explorer-tree .file-to-review-row .text-ellipsis {
          color: var(--file-to-review-color) !important;
          transition-duration: 0.2s;
        }
        .repos-changes-explorer-tree .folder-to-review-row[aria-expanded='false'],
        .repos-changes-explorer-tree .folder-to-review-row[aria-expanded='false'] .text-ellipsis {
          color: var(--file-to-review-color);
          transition-duration: 0.2s;
        }
        .repos-changes-explorer-tree .file-to-review-row .file-owners-role {
          font-weight: bold;
          padding: 7px 10px;
          position: absolute;
          z-index: 100;
          float: right;
        }`);

    eus.onUrl(/\/pullrequest\//gi, (session, urlMatch) => {
      session.onEveryNew(document, '.repos-changes-explorer-tree', async tree => {
        // Get the current iteration of the PR.
        const prUrl = await getCurrentPullRequestUrlAsync();
        // Get owners info for this PR.
        globalOwnersInfo = await getNationalInstrumentsPullRequestOwnersInfo(prUrl);

        const hasOwnersInfo = globalOwnersInfo && globalOwnersInfo.currentUserFileCount > 0;

        if (hasOwnersInfo) {
          const onFilesTreeChangeThrottled = _.throttle(onFilesTreeChange, 50, { leading: false, trailing: true });
          session.onAnyChangeTo(tree, t => {
            onFilesTreeChangeThrottled();
          });
          onFilesTreeChangeThrottled();
        }
      });
    });
  }

  function watchForDiffHeaders() {
    addStyleOnce('pr-file-diff-annotations-css', /* css */ `
        :root {
          /* Set some constants for our CSS. */
          --file-to-review-header-color: rgba(0, 120, 212, 0.2);
        }
        .repos-summary-header > .flex-row.file-to-review-header {
          /* Highlight files I need to review. */
          abackground-color: var(--file-to-review-header-color) !important;
          transition-duration: 0.2s;
        }
        .repos-summary-header > .flex-row.file-to-review-header > .flex-row {
          background: none;
          background-color: var(--file-to-review-header-color) !important;
        }
        .file-owners-role-header {
          /* Style the role of the user in the files table. */
          font-weight: bold;
          padding: 7px 10px;
        }`);

    // Update expandedFilesCache when an expand-button is clicked
    // TODO: Make this optional.
    let expandedFilesCache = {};
    document.addEventListener('click', e => {
      const collapseButton = e.target.closest('.bolt-card-expand-button');
      if (collapseButton) {
        const wasExpanded = collapseButton.getAttribute('aria-expanded') === 'true';
        const isExpanded = !wasExpanded;
        const pathWithLeadingSlash = collapseButton.parentElement.querySelector('.secondary-text.text-ellipsis').textContent;
        expandedFilesCache[pathWithLeadingSlash] = isExpanded;
      }
    });

    eus.onUrl(/\/pullrequest\//gi, async (session, urlMatch) => {
      // Get the current iteration of the PR.
      const prUrl = await getCurrentPullRequestUrlAsync();
      const prCreatedBy = await getCurrentPullRequestCreatedBy();
      // Get owners info for this PR.
      const ownersInfo = await getNationalInstrumentsPullRequestOwnersInfo(prUrl);
      const hasOwnersInfo = ownersInfo && ownersInfo.currentUserFileCount > 0;
      const autoCollapse = hasOwnersInfo && currentUser.uniqueName !== prCreatedBy.uniqueName;
      // Reset the cache for each new PR.
      expandedFilesCache = {};

      session.onEveryNew(document, '.repos-summary-header', diff => {
        const header = diff.children[0];
        const pathWithLeadingSlash = header.querySelector('.secondary-text.text-ellipsis').textContent;
        const path = pathWithLeadingSlash.substring(1); // Remove leading slash.

        if (hasOwnersInfo && ownersInfo.isCurrentUserResponsibleForFile(path)) {
          header.classList.add('file-to-review-header');

          $('<div class="file-owners-role-header" />').text(`${ownersInfo.currentUserFilesToRole[path]}:`).prependTo(header.children[1]);
        }

        if (pathWithLeadingSlash in expandedFilesCache) {
          if (!expandedFilesCache[pathWithLeadingSlash]) {
            header.querySelector('button[aria-label="Collapse"]').click();
          }
        } else if (autoCollapse) {
          if (!ownersInfo.isCurrentUserResponsibleForFile(path)) {
            // TODO: Make this optional.
            header.querySelector('button[aria-label="Collapse"]').click();
          }
        }
      });
    });
  }

  function watchForKnownBuildErrors(pageData) {
    addStyleOnce('known-build-errors-css', /* css */ `
      .infra-errors-card h3 {
        margin-top: 0;
        display: inline-block;
      }
      .loading-indicator {
        margin-left: 3ch;
      }
      .task-list {
        margin-top: 0;
      }
      .infra-errors-card ul {
        margin-bottom: 0;
        margin-left: 4ch;
      }
      .infra-errors-card li {
        margin-bottom: 0.5em;
        list-style-type: disc;
      }
      .infra-errors-card li li {
        margin-bottom: 0;
        list-style-type: disc;
        opacity: 0.7;
      }
      .infra-errors-card li span {
        margin-bottom: 0.5em;
      }`);
    eus.onUrl(/\/_build\/results\?buildId=\d+&view=results/gi, (session, urlMatch) => {
      session.onEveryNew(document, '.run-details-tab-content', async tabContent => {
        const runDetails = pageData['ms.vss-build-web.run-details-data-provider'];
        const projectId = pageData['ms.vss-tfs-web.page-data'].project.id;
        const buildId = runDetails.id;
        const pipelineName = runDetails.pipeline.name;

        const actualBuildId = parseInt(urlMatch[0].match(/\d+/)[0], 10);
        if (buildId !== actualBuildId) {
          // eslint-disable-next-line no-restricted-globals
          location.reload();
        }

        if (!runDetails.issues) {
          return; // do not even add an empty section
        }

        let queryResponse;
        try {
          queryResponse = await fetch(`${azdoApiBaseUrl}/DevCentral/_apis/git/repositories/tools/items?path=/report/build_failure_analysis/pipeline_results/known-issues.json&api-version=6.0`);
        } catch (err) {
          debug('Could not fetch known issues file from AzDO');
          return;
        }
        const knownIssues = await queryResponse.json();
        if (!knownIssues.version.match(/^1(\.\d+)?$/)) {
          debug(`Version ${knownIssues.version} of known-issues.json is not one I know what to do with`);
          return;
        }

        if (!(new RegExp(knownIssues.pipeline_match).test(pipelineName))) {
          return; // do not even add an empty section
        }

        const flexColumn = tabContent.children[0];
        const summaryCard = flexColumn.children[1];
        const newCard = $('<div class="infra-errors-card margin-top-16 depth-8 bolt-card bolt-card-white"><div>')[0];
        const newCardContent = $('<div class="bolt-card-content bolt-default-horizontal-spacing"><div>');
        newCardContent.appendTo(newCard);
        summaryCard.insertAdjacentElement('afterend', newCard);
        $('<h3>Known Infrastructure Errors</h3><span class="loading-indicator">Loading...</span>').appendTo(newCardContent);

        // Fetch build timeline (which contains records with log urls)
        queryResponse = await fetch(`${azdoApiBaseUrl}/${projectId}/_apis/build/builds/${buildId}/timeline?api-version=6.0`);
        const timeline = await queryResponse.json();

        // Fetch build logs, which give us line counts
        queryResponse = await fetch(`${azdoApiBaseUrl}/${projectId}/_apis/build/builds/${buildId}/logs?api-version=6.0`);
        const logsJson = (await queryResponse.json()).value;

        const infraErrorsList = $('<ul class="task-list"></ul>');
        infraErrorsList.appendTo(newCardContent);

        const tasksWithInfraErrors = [];
        let numTasksAdded = 0;

        // For each task with issues
        for (let i = 0; i < runDetails.issues.length; i += 1) {
          let infraErrorCount = 0;
          const taskWithIssues = runDetails.issues[i];
          const componentListItem = $(`<li>${taskWithIssues.taskName}</li>`);
          const componentSublist = $('<ul></ul>');
          componentSublist.appendTo(componentListItem);

          // Find the timeline record for the task, then get the log url
          for (let j = 0; j < timeline.records.length; j += 1) {
            if (timeline.records[j].task != null && timeline.records[j].id === taskWithIssues.taskId) {
              const logUrl = timeline.records[j].log.url;
              const logId = timeline.records[j].log.id;
              let logLines = 0;
              for (let k = 0; k < logsJson.length; k += 1) {
                if (logsJson[k].id === logId) {
                  logLines = logsJson[k].lineCount;
                  break;
                }
              }

              if (logLines > 100000) {
                const content = '<li>⚠️<i>Warning: log file too large to parse</i></li>';
                $(content).appendTo(componentSublist);
                infraErrorCount += 1;
                break;
              }

              // Fetch the log
              // eslint-disable-next-line no-await-in-loop
              queryResponse = await fetch(logUrl);
              // eslint-disable-next-line no-await-in-loop
              const log = await queryResponse.text();

              // Test all patterns against log
              const knownBuildErrors = knownIssues.log_patterns;
              for (let k = 0; k < knownBuildErrors.length; k += 1) {
                if (knownBuildErrors[k].category === 'Infrastructure' && new RegExp(knownBuildErrors[k].pipeline_match).test(pipelineName)) {
                  const matchString = knownBuildErrors[k].match;
                  let matchFlag = 'gi';
                  if (knownBuildErrors[k].match_flag === 'multiline') {
                    matchFlag = 'gim';
                  } else if (knownBuildErrors[k].match_flag === 'dotmatchall') {
                    matchFlag = 'gis';
                  }
                  const matches = log.match(new RegExp(matchString, matchFlag)) || [];
                  if (matches.length) {
                    let content = `${knownBuildErrors[k].cause} (x${matches.length})`;
                    if (knownBuildErrors[k].public_comment) {
                      content = `${content}<br>${knownBuildErrors[k].public_comment}`;
                    }
                    $(`<li>${content}</li>`).appendTo(componentSublist);
                    infraErrorCount += 1;
                    tasksWithInfraErrors.push(taskWithIssues.taskName);
                  }
                }
              }
              break;
            }
          }

          if (infraErrorCount) {
            componentListItem.appendTo(infraErrorsList);
            numTasksAdded += 1;
          }
        }

        if (numTasksAdded === 0) {
          $('<p>None</p>').appendTo(newCardContent);
        }

        if (knownIssues.more_info_html) {
          $(knownIssues.more_info_html).appendTo(newCardContent);
        }

        session.onEveryNew(document, '.issues-card-content .secondary-text', secondaryText => {
          const taskName = secondaryText.textContent.split(' • ')[1];
          if (tasksWithInfraErrors.includes(taskName)) {
            $('<span> ⚠️POSSIBLE INFRASTRUCTURE ERROR</span>').appendTo(secondaryText);
          }
        });

        newCardContent.find('.loading-indicator').remove();
      });
    });
  }

  function watchForNewDiffs(isDarkTheme) {
    if (isDarkTheme) {
      addStyleOnce('highlight', `
        .hljs {
            display: block;
            overflow-x: auto;
            background: #1e1e1e;
            color: #dcdcdc;
        }

        .hljs-keyword,
        .hljs-literal,
        .hljs-name,
        .hljs-symbol {
            color: #569cd6;
        }

        .hljs-link {
            color: #569cd6;
            text-decoration: underline;
        }

        .hljs-built_in,
        .hljs-type {
            color: #4ec9b0;
        }

        .hljs-class,
        .hljs-number {
            color: #b8d7a3;
        }

        .hljs-meta-string,
        .hljs-string {
            color: #d69d85;
        }

        .hljs-regexp,
        .hljs-template-tag {
            color: #9a5334;
        }

        .hljs-formula,
        .hljs-function,
        .hljs-params,
        .hljs-subst,
        .hljs-title {
            color: var(--text-primary-color, rgba(0, 0, 0, .7));
        }

        .hljs-comment,
        .hljs-quote {
            color: #57a64a;
            font-style: italic;
        }

        .hljs-doctag {
            color: #608b4e;
        }

        .hljs-meta,
        .hljs-meta-keyword,
        .hljs-tag {
            color: #9b9b9b;
        }
        .hljs-meta-keyword {
          font-weight: bold;
        }

        .hljs-template-variable,
        .hljs-variable {
            color: #bd63c5;
        }

        .hljs-attr,
        .hljs-attribute,
        .hljs-builtin-name {
            color: #9cdcfe;
        }

        .hljs-section {
            color: gold;
        }

        .hljs-emphasis {
            font-style: italic;
        }

        .hljs-strong {
            font-weight: 700;
        }

        .hljs-bullet,
        .hljs-selector-attr,
        .hljs-selector-class,
        .hljs-selector-id,
        .hljs-selector-pseudo,
        .hljs-selector-tag {
            color: #d7ba7d;
        }

        .hljs-addition {
            background-color: #144212;
            display: inline-block;
            width: 100%;
        }

        .hljs-deletion {
            background-color: #600;
            display: inline-block;
            width: 100%;
        }`);
    } else {
      addStyleOnce('highlight', `
        .hljs{display:block;overflow-x:auto;padding:.5em;background:#fff;color:#000}.hljs-comment,.hljs-quote,.hljs-variable{color:green}.hljs-built_in,.hljs-keyword,.hljs-name,.hljs-selector-tag,.hljs-tag{color:#00f}.hljs-addition,.hljs-attribute,.hljs-literal,.hljs-section,.hljs-string,.hljs-template-tag,.hljs-template-variable,.hljs-title,.hljs-type{color:#a31515}.hljs-deletion,.hljs-meta,.hljs-selector-attr,.hljs-selector-pseudo{color:#2b91af}.hljs-doctag{color:grey}.hljs-attr{color:red}.hljs-bullet,.hljs-link,.hljs-symbol{color:#00b0e8}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
      `);
    }

    eus.onUrl(/\/pullrequest\//gi, (session, urlMatch) => {
      let languageDefinitions = null;
      session.onEveryNew(document, '.text-diff-container', diff => {
        if (eus.seen(diff)) return;

        if (!languageDefinitions) {
          languageDefinitions = parseLanguageDefinitions();
        }

        // TODO: Handle new PR experience.

        session.onFirst(diff.closest('.file-container'), '.file-cell .file-name-link', fileNameLink => {
          const fileName = fileNameLink.innerText.toLowerCase();
          const extension = getFileExt(fileName);

          const leftPane = diff.querySelector('.leftPane > div > .side-by-side-diff-container');
          const rightOrUnifiedPane = diff.querySelector('.rightPane > div > .side-by-side-diff-container') || diff;

          // Guess our language based on our file extension. The GitHub language definition keywords and the highlight.js language keywords are different, and may not match. This loop is a heuristic to find a language match.
          // Supports languages listed here, without plugins: https://github.com/highlightjs/highlight.js/blob/master/SUPPORTED_LANGUAGES.md
          let language = null;
          for (const mode of [extension].concat(languageDefinitions.extensionToMode[extension]).concat(languageDefinitions.fileToMode[fileName])) {
            if (hljs.getLanguage(mode)) {
              language = mode;
              break;
            }
          }

          // If we still don't have a language, try to guess it based on the code.
          if (!language) {
            let code = '';
            for (const line of rightOrUnifiedPane.querySelectorAll('.code-line:not(.deleted-content)')) {
              code += `${line.innerText}\n`;
            }
            // eslint-disable-next-line prefer-destructuring
            language = hljs.highlightAuto(code).language;
          }

          // If we have a language, highlight it :)
          if (language) {
            highlightDiff(language, fileName, 'left', leftPane, '.code-line');
            highlightDiff(language, fileName, 'right/unified', rightOrUnifiedPane, '.code-line:not(.deleted-content)');
          }
        });
      });
    });
  }

  // Gets GitHub language definitions to parse extensions and filenames to a "mode" that we can try with highlight.js.
  function parseLanguageDefinitions() {
    const languages = jsyaml.load(GM_getResourceText('linguistLanguagesYml'));
    const extensionToMode = {};
    const fileToMode = {};

    for (const language of Object.values(languages)) {
      const mode = [getFileExt(language.tm_scope), language.ace_mode];
      if (language.extensions) {
        for (const extension of language.extensions) {
          extensionToMode[extension.substring(1)] = mode;
        }
      }
      if (language.filenames) {
        for (const filename of language.filenames) {
          fileToMode[filename.toLowerCase()] = mode;
        }
      }
    }

    // For debugging: debug(`Supporting ${Object.keys(extensionToMode).length} extensions and ${Object.keys(fileToMode).length} special filenames`);
    return { extensionToMode, fileToMode };
  }

  function highlightDiff(language, fileName, part, diffContainer, selector) {
    if (!diffContainer) return;

    // For debugging: debug(`Highlighting ${part} of <${fileName}> as ${language}`);

    let stack = null;
    for (const line of diffContainer.querySelectorAll(selector)) {
      const result = hljs.highlight(language, line.innerText, true, stack);
      stack = result.top;

      // We must add the extra span at the end or sometimes, when adding a comment to a line, the highlighting will go away.
      line.innerHTML = `${result.value}<span style="user-select: none">&ZeroWidthSpace;</span>`;

      // We must wrap all text in spans for the comment highlighting to work.
      for (let i = line.childNodes.length - 1; i > -1; i -= 1) {
        const fragment = line.childNodes[i];
        if (fragment.nodeType === Node.TEXT_NODE) {
          const span = document.createElement('span');
          span.innerText = fragment.textContent;
          fragment.parentNode.replaceChild(span, fragment);
        }
      }
    }
  }

  // Fix PR image URLs to match the window URL (whether dev.azure.com/account/ or account.visualstudio.com/)
  function fixImageUrls(session) {
    let account;
    let badPrefix;
    let goodPrefix;
    if (window.location.host === 'dev.azure.com') {
      account = window.location.pathname.match(/^\/(\w+)/)[1];
      badPrefix = new RegExp(`^${window.location.protocol}//${account}.visualstudio.com/`);
      goodPrefix = `${window.location.protocol}//dev.azure.com/${account}/`;
    } else {
      const match = window.location.host.match(/^(\w+)\.visualstudio.com/);
      if (!match) return;
      account = match[1];
      badPrefix = new RegExp(`^${window.location.protocol}//dev.azure.com/${account}/`);
      goodPrefix = `${window.location.protocol}//${account}.visualstudio.com/`;
    }

    session.onEveryNew(document, 'img', img => {
      const src = img.getAttribute('src');
      if (src && src.match(badPrefix)) {
        // For debugging: debug("Fixing img src", src);
        img.setAttribute('src', src.replace(badPrefix, goodPrefix));
      }
    });
  }

  // Helper function to get the file extension out of a file path; e.g. `cs` from `blah.cs`.
  function getFileExt(path) {
    return /(?:\.([^.]+))?$/.exec(path)[1];
  }

  // Helper function to avoid adding CSS twice into a document.
  function addStyleOnce(id, style) {
    $(document.head).once(id).each(function () {
      $('<style type="text/css" />').html(style).appendTo(this);
    });
  }

  // Helper function to get the id of the PR that's on screen.
  function getCurrentPullRequestId() {
    return window.location.pathname.substring(window.location.pathname.lastIndexOf('/') + 1);
  }

  // Don't access this directly -- use getCurrentPullRequestAsync() instead.
  let currentPullRequest = null;

  async function getCurrentPullRequestAsync() {
    if (!currentPullRequest || currentPullRequest.pullRequestId !== getCurrentPullRequestId()) {
      currentPullRequest = await getPullRequestAsync();
    }
    return currentPullRequest;
  }

  // Helper function to get the url of the PR that's currently on screen.
  async function getCurrentPullRequestUrlAsync() {
    return (await getCurrentPullRequestAsync()).url;
  }

  // Helper function to get the creator of the PR that's currently on screen.
  async function getCurrentPullRequestCreatedBy() {
    return (await getCurrentPullRequestAsync()).createdBy;
  }

  // Async helper function get info on a single PR. Defaults to the PR that's currently on screen.
  function getPullRequestAsync(id = 0) {
    const actualId = id || getCurrentPullRequestId();
    return $.get(`${azdoApiBaseUrl}/_apis/git/pullrequests/${actualId}?api-version=5.0`);
  }

  // Async helper function to get a specific PR property, otherwise return the default value.
  async function getPullRequestProperty(prUrl, key, defaultValue = null) {
    const properties = await $.get(`${prUrl}/properties?api-version=5.1-preview.1`);
    const property = properties.value[key];
    return property ? JSON.parse(property.$value) : defaultValue;
  }

  async function pullRequestHasRequiredOwnersPolicyAsync() {
    const pr = await getCurrentPullRequestAsync();
    const url = `${azdoApiBaseUrl}${pr.repository.project.name}/_apis/git/policy/configurations?repositoryId=${pr.repository.id}&refName=${pr.targetRefName}`;
    return (await $.get(url)).value.some(x => x.isBlocking && x.settings.statusName === 'owners-approved');
  }

  // Helper function to access an object member, where the exact, full name of the member is not known.
  function getPropertyThatStartsWith(instance, startOfName) {
    return instance[Object.getOwnPropertyNames(instance).find(x => x.startsWith(startOfName))];
  }

  // Helper function to encode any string into an string that can be placed directly into HTML.
  function escapeStringForHtml(string) {
    return string.replace(/[\u00A0-\u9999<>&]/gim, ch => `&#${ch.charCodeAt(0)};`);
  }

  // Async helper function to return reviewer info specific to National Instruments workflows (where this script is used the most).
  async function getNationalInstrumentsPullRequestOwnersInfo(prUrl) {
    const reviewProperties = await getPullRequestProperty(prUrl, 'NI.ReviewProperties');

    // Not all repos have NI owner info.
    if (!reviewProperties) {
      return null;
    }

    // Only support the more recent PR owner info version, where full user info is stored in an identities table separate from files.
    if (reviewProperties.version < 4) {
      return null;
    }

    // Some PRs don't have complete owner info if it would be too large to fit in PR property storage.
    if (!reviewProperties.fileProperties) {
      return null;
    }

    const ownersInfo = {
      currentUserFilesToRole: {},
      currentUserFileCount: 0,
      isCurrentUserResponsibleForFile(path) {
        return Object.prototype.hasOwnProperty.call(this.currentUserFilesToRole, path);
      },
      isCurrentUserResponsibleForFileInFolderPath(folderPath) {
        return Object.keys(this.currentUserFilesToRole).some(path => path.startsWith(folderPath));
      },
      reviewProperties,
    };

    // See if the current user is listed in this PR.
    const currentUserListedInThisOwnerReview = _(reviewProperties.reviewerIdentities).some(r => r.email === currentUser.uniqueName);

    // Go through all the files listed in the PR.
    if (currentUserListedInThisOwnerReview) {
      for (const file of reviewProperties.fileProperties) {
        // Get the identities associated with each of the known roles.
        // Note that the values for file.owner/alternate/experts may contain the value 0 (which is not a valid 1-based index) to indicate nobody for that role.
        const owner = reviewProperties.reviewerIdentities[file.owner - 1] || {};
        const alternate = reviewProperties.reviewerIdentities[file.alternate - 1] || {}; // handle nulls everywhere

        // As of 2020-11-16, Reviewer is now a synonym for Expert. We'll look at both arrays and annotate them the same way.
        const reviewers = file.reviewers ? (file.reviewers.map(r => reviewProperties.reviewerIdentities[r - 1] || {}) || []) : [];
        const experts = file.experts ? (file.experts.map(r => reviewProperties.reviewerIdentities[r - 1] || {}) || []) : [];

        const watchers = file.watchers ? (file.watchers.map(r => reviewProperties.reviewerIdentities[r - 1] || {}) || []) : [];

        // Pick the highest role for the current user on this file, and track it.
        if (owner.email === currentUser.uniqueName) {
          ownersInfo.currentUserFilesToRole[file.path] = 'O';
          ownersInfo.currentUserFileCount += 1;
        } else if (alternate.email === currentUser.uniqueName) {
          ownersInfo.currentUserFilesToRole[file.path] = 'A';
          ownersInfo.currentUserFileCount += 1;
          // eslint-disable-next-line no-loop-func
        } else if (_(experts).some(r => r.email === currentUser.uniqueName) || _(reviewers).some(r => r.email === currentUser.uniqueName)) {
          ownersInfo.currentUserFilesToRole[file.path] = 'E';
          ownersInfo.currentUserFileCount += 1;
          // eslint-disable-next-line no-loop-func
        } else if (_(watchers).some(r => r.email === currentUser.uniqueName)) {
          ownersInfo.currentUserFilesToRole[file.path] = 'W';
          ownersInfo.currentUserFileCount += 1;
        }
      }
    }

    return ownersInfo;
  }

  main();
}());
