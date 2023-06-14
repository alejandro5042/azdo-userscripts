// ==UserScript==

// @name         More Awesome Azure DevOps (userscript)
// @version      3.6.0
// @author       Alejandro Barreto (NI)
// @description  Makes general improvements to the Azure DevOps experience, particularly around pull requests. Also contains workflow improvements for NI engineers.
// @license      MIT

// @namespace    https://github.com/alejandro5042
// @homepageURL  https://alejandro5042.github.io/azdo-userscripts/
// @supportURL   https://alejandro5042.github.io/azdo-userscripts/SUPPORT.html
// @updateURL    https://rebrand.ly/update-azdo-pr-dashboard-user-js
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

// @require      https://highlightjs.org/static/highlight.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-yaml/3.14.0/js-yaml.min.js#sha512-ia9gcZkLHA+lkNST5XlseHz/No5++YBneMsDp1IZRJSbi1YqQvBeskJuG1kR+PH1w7E0bFgEZegcj0EwpXQnww==
// @resource     linguistLanguagesYml https://raw.githubusercontent.com/github/linguist/master/lib/linguist/languages.yml?v=1
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand

// ==/UserScript==

(function () {
  'use strict';

  // All REST API calls should fail after a timeout, instead of going on forever.
  $.ajaxSetup({ timeout: 5000 });

  let currentUser;
  let azdoApiBaseUrl;

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

      eus.showTipOnce('release-2021-11-14', 'New in the AzDO userscript', `
        <p>Highlights from the 2021-11-14 update!</p>
        <p>PR reviewers are now annotated with:</p>
        <ul>
          <li><b>Out-of-office status</b>: From Outlook auto-reply messages. Hover over to see the full message</li>
          <li><b>Owner info</b>: How many files the reviewer is listed as an owner, alternate, and expert. Hover over to see which files</li>
          <li><b>Country flags</b>: Shown if they are they are in a different country than you (these reviewers could have a longer response time due to timezones)</li>
          <li><b>Employment status</b>: Ex-employee, leave of absence, etc.</li>
        </ul>
        <hr>
        <p>Comments, bugs, suggestions? File an issue on <a href="https://github.com/alejandro5042/azdo-userscripts" target="_blank">GitHub</a> 🧡</p>
      `);
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

    // Throttle page update events to avoid using up CPU when AzDO is adding a lot of elements during a short time (like on page load).
    const onPageUpdatedThrottled = _.throttle(onPageUpdated, 400, { leading: false, trailing: true });

    // Handle any existing elements, flushing it to execute immediately.
    onPageUpdatedThrottled();
    onPageUpdatedThrottled.flush();

    // Call our event handler if we notice new elements being inserted into the DOM. This happens as the page is loading or updating dynamically based on user activity.
    $('body > div.full-size')[0].addEventListener('DOMNodeInserted', onPageUpdatedThrottled);
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

  function watchForPipelinesPage(session, pageData) {
    addStyleOnce('agent-css', /* css */ `
      .pipeline-status-icon {
        margin: 5px !important;
        padding: 10px;
        border-radius: 25px;
        background: var(--search-selected-match-background);
        color: var(--palette-error);
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
        const href = pipelineTitleElement.href;
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
    userIcon.classList.add({ disabled: 'ms-Icon--Blocked', paused: 'ms-Icon--CirclePause' }[pipelineQueueStatus] || 'ms-Icon--Unknown');

    const spanElement = $(pipelineTitleElement).find(classToAppendTo)[0];
    spanElement.append(userIcon);
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
            userCapabilities: agentInfo.userCapabilities,
            participatesInRelease: agentInfo.systemCapabilities.PARTICIPATES_IN_RELEASE,
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
        const disableReason = (poolAgentsInfo[agentName].userCapabilities || {}).DISABLE_REASON || null;

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

    const participatesInRelease = agentInfo.participatesInRelease || null;
    if (participatesInRelease === '1') {
      const participatesInReleaseElement = document.createElement('span');
      participatesInReleaseElement.className = 'capability-icon release-machine fabric-icon ms-Icon--Rocket';
      participatesInReleaseElement.title = 'PARTICIPATES_IN_RELEASE';
      capabilitiesHolder.append(participatesInReleaseElement);
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

    let oooInfo;
    let oooByEmail;
    try {
      oooInfo = await fetchJsonAndCache('outOfOfficeLatest', 12 * 60 * 60, `${azdoApiBaseUrl}/_apis/git/repositories/3378df6b-8fc9-41dd-a9d9-16640f2392cb/items?api-version=6.0&path=/data/outOfOfficeLatest.json&version=main`);
      if (oooInfo.version === 1) {
        const dataDate = dateFns.parse(oooInfo.date);
        if (dateFns.differenceInDays(new Date(), dataDate) >= dataMaxAgeInDays) {
          // This data is too old. It hasn't been updated properly by the pipeline producing it. Avoid annotating.
          throw new Error(`Data is too old (must be ${dataMaxAgeInDays} days old or less). Data date is: ${dataDate.toISOString()}`);
        }

        oooByEmail = _.keyBy(oooInfo.value, 'Email');
      } else {
        throw new Error(`Invalid version: ${oooInfo.version}`);
      }
    } catch (e) {
      oooInfo = null;
      error(`Cannot annotate out-of-office info on PRs: ${e}`);
    }

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
            annotateReviewer(nameElement, 'ooo', escapeStringForHtml(employee.status));
          }
        }
      }

      if (oooInfo) {
        const ooo = oooByEmail[email];
        if (ooo && dateFns.isFuture(ooo.End)) {
          let label;

          if (dateFns.isFuture(ooo.Start)) {
            if (dateFns.differenceInHours(ooo.Start, new Date()) <= 24) {
              label = 'Unavailable in <24h';
            } else {
              // Don't show a label. This person is leaving too far into the future.
              label = null;
            }
          } else {
            label = `Returns in ${dateFns.distanceInWordsToNow(ooo.End)}`;
          }

          if (label) {
            const tooltipHtml = `
              <p style='font-weight: bold; text-align: center'>Outlook Auto Response</p>
              <h1>Leaving ${dateFns.format(ooo.Start, 'ha ddd, MMM D, YYYY')}<br>Returning ${dateFns.format(ooo.End, 'ha ddd, MMM D, YYYY')}</h1>
              <p class="user-message">${ooo.Text.replace(/\r?\n/ig, '<br><br>')}</p>`;

            annotateReviewer(nameElement, 'ooo', escapeStringForHtml(label), tooltipHtml);
          }
        }
      }
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
    eus.globalSession.onEveryNew(document, '.menu-item.follow-item-menu-item-gray', followButton => {
      followButton.addEventListener('click', async _ => {
        await eus.sleep(100); // We need to allow the other handlers to send the request to follow/unfollow. After the request is sent, we can annotate our follows list correctly.
        await annotateWorkItemWithFollowerList(document.querySelector('.discussion-messages-right'));
      });
    });
    // Annotate work items (under the comment box) with who is following it.
    eus.globalSession.onEveryNew(document, '.discussion-messages-right', async commentEditor => {
      await annotateWorkItemWithFollowerList(commentEditor);
    });
  }

  async function annotateWorkItemWithFollowerList(commentEditor) {
    document.querySelectorAll('.work-item-followers-list').forEach(e => e.remove());

    const workItemId = commentEditor.closest('.witform-layout').querySelector('.work-item-form-id > span').innerText;
    const queryResponse = await fetch(`${azdoApiBaseUrl}/_apis/notification/subscriptionquery?api-version=6.0`, {
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
      .map(s => `<a href="mailto:${s.subscriber.uniqueName}">${s.subscriber.displayName}</a>`)
      .join(', ')
      || 'Nobody';

    const annotation = `<div class="work-item-followers-list" style="margin: 1em 0em; opacity: 0.8"><span class="menu-item-icon bowtie-icon bowtie-watch-eye-fill" aria-hidden="true"></span> ${followerList}</div>`;
    commentEditor.insertAdjacentHTML('BeforeEnd', annotation);
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

      // Milestone trophy: Awarded if pull request ID is greater than 1000 and is a non-zero digit followed by only zeroes (e.g. 1000, 5000, 10000).
      if (prId >= 1000 && prId.toString().match('^[1-9]0+$')) {
        const milestoneTrophyMessage = $('<div>').addClass('bolt-table-cell-content').text(`🏆 ${prAuthor} got pull request #${prId}`);
        trophiesAwarded.push(milestoneTrophyMessage);
      }

      // Fish trophy: Give a man a fish, he'll waste hours trying to figure out why. (Awarded if the ID is a palindrome.)
      // Requires an id with at least three numbers.
      if (prId > 100 && prId.toString() === prId.toString().split('').reverse().join('')) {
        const fishTrophyMessage = $('<div>').addClass('bolt-table-cell-content').text(`🐠 ${prAuthor} got a fish trophy`);
        trophiesAwarded.push(fishTrophyMessage);
      }

      // 1337 leetspeak.
      if (prId === 1337) {
        const leetMessage = $('<div>').addClass('bolt-table-cell-content').text(`👨‍💻 ${prAuthor} speaks leet`);
        trophiesAwarded.push(leetMessage);
      } else if (prId === 1) { // First PR.
        const firstPrTrophyMessage = $('<div>').addClass('bolt-table-cell-content').text(`🥇 ${prAuthor} is first`);
        trophiesAwarded.push(firstPrTrophyMessage);
      }

      if (trophiesAwarded.length > 0) {
        const header = $('<div/>').addClass('bolt-header-title body-xl m').text('Trophies');
        const sectionContent = $('<div/>').append(trophiesAwarded);
        const section = $('<div/>').attr('id', 'trophies-section').append(header).append(sectionContent);
        $(elm).append(section);
      }
    });
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

      if (votes.userVote === 0 && votes.missingVotes === 1) {
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
    };

    for (const reviewer of pr.reviewers) {
      if (reviewer.uniqueName === currentUser.uniqueName) {
        votes.userVote = reviewer.vote;
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
    if (!builds) return;

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
      pullRequestRow.querySelector('.body-l').insertAdjacentElement('afterend', labelContainer);
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

    eus.onUrl(/\/pullrequest\//gi, async (session, urlMatch) => {
      // Get the current iteration of the PR.
      const prUrl = await getCurrentPullRequestUrlAsync();
      // Get owners info for this PR.
      const ownersInfo = await getNationalInstrumentsPullRequestOwnersInfo(prUrl);
      const hasOwnersInfo = ownersInfo && ownersInfo.currentUserFileCount > 0;
      if (!hasOwnersInfo) return;

      session.onEveryNew(document, '.repos-summary-header', diff => {
        const header = diff.children[0];
        const pathWithLeadingSlash = $(header).find('.secondary-text.text-ellipsis')[0].textContent;
        const path = pathWithLeadingSlash.substring(1); // Remove leading slash.

        if (ownersInfo.isCurrentUserResponsibleForFile(path)) {
          $(header).addClass('file-to-review-header');

          $('<div class="file-owners-role-header" />').text(`${ownersInfo.currentUserFilesToRole[path]}:`).prependTo(header.children[1]);
        } else {
          // TODO: Make this optional.
          $(header).find('button[aria-label="Collapse"]').click();
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
          queryResponse = await fetch(`${azdoApiBaseUrl}/DevCentral/_apis/git/repositories/tools/items?path=/report/build_failure_analysis/pipeline-results/known-issues.json&api-version=6.0`);
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
        }
      }
    }

    return ownersInfo;
  }

  main();
}());
