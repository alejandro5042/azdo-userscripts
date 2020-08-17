// ==UserScript==

// @name         AzDO Pull Request Improvements
// @version      2.47.0
// @author       Alejandro Barreto (National Instruments)
// @description  Adds sorting and categorization to the PR dashboard. Also adds minor improvements to the PR diff experience, such as a base update selector and per-file checkboxes.
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
// @require      https://cdnjs.cloudflare.com/ajax/libs/lscache/1.3.0/lscache.js#sha256-QVvX22TtfzD4pclw/4yxR0G1/db2GZMYG9+gxRM9v30=
// @require      https://cdnjs.cloudflare.com/ajax/libs/date-fns/1.30.1/date_fns.min.js#sha256-wCBClaCr6pJ7sGU5kfb3gQMOOcIZNzaWpWcj/lD9Vfk=
// @require      https://cdn.jsdelivr.net/npm/lodash@4.17.11/lodash.min.js#sha256-7/yoZS3548fXSRXqc/xYzjsmuW3sFKzuvOCHd06Pmps=

// @require      https://cdn.jsdelivr.net/npm/sweetalert2@9.13.1/dist/sweetalert2.all.min.js#sha384-8oDwN6wixJL8kVeuALUvK2VlyyQlpEEN5lg6bG26x2lvYQ1HWAV0k8e2OwiWIX8X
// @require      https://gist.githubusercontent.com/alejandro5042/af2ee5b0ad92b271cd2c71615a05da2c/raw/67b7203dfbc48f08ebddfc8327c92b2df28a3c4c/easy-userscripts.js?v=72#sha384-OgOM7UvZHxtPUmZoGbYhsgkLPuRj9SFTpO+LqbnaBzLDQaXmYlosSywfsljzjhCI

// @require      https://highlightjs.org/static/highlight.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-yaml/3.14.0/js-yaml.min.js#sha512-ia9gcZkLHA+lkNST5XlseHz/No5++YBneMsDp1IZRJSbi1YqQvBeskJuG1kR+PH1w7E0bFgEZegcj0EwpXQnww==
// @resource     linguistLanguagesYml https://raw.githubusercontent.com/github/linguist/master/lib/linguist/languages.yml?v=1
// @grant        GM_getResourceText

// ==/UserScript==

(function () {
  'use strict';

  // All REST API calls should fail after a timeout, instead of going on forever.
  $.ajaxSetup({ timeout: 5000 });

  lscache.setBucket('acb-azdo/');

  let currentUser;
  let azdoApiBaseUrl;

  // Throttle page update events to avoid using up CPU when AzDO is adding a lot of elements during a short time (like on page load).
  const onPageUpdatedThrottled = _.throttle(onPageUpdated, 400, { leading: false, trailing: true });

  // Some features only apply at National Instruments.
  const atNI = /^ni\./i.test(window.location.hostname) || /^\/ni\//i.test(window.location.pathname);

  function onReady() {
    // Find out who is our current user. In general, we should avoid using pageData because it doesn't always get updated when moving between page-to-page in AzDO's single-page application flow. Instead, rely on the AzDO REST APIs to get information from stuff you find on the page or the URL. Some things are OK to get from pageData; e.g. stuff like the user which is available on all pages.
    const pageData = JSON.parse(document.getElementById('dataProviders').innerHTML).data;
    currentUser = pageData['ms.vss-web.page-data'].user;

    // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
    azdoApiBaseUrl = `${window.location.origin}${pageData['ms.vss-tfs-web.header-action-data'].suiteHomeUrl}`;

    // Invoke our new eus-style features.
    watchPullRequestDashboard();
    watchForNewLabels();
    watchForNewDiffs();

    // Handle any existing elements, flushing it to execute immediately.
    onPageUpdatedThrottled();
    onPageUpdatedThrottled.flush();

    // Call our event handler if we notice new elements being inserted into the DOM. This happens as the page is loading or updating dynamically based on user activity.
    $('body > div.full-size')[0].addEventListener('DOMNodeInserted', onPageUpdatedThrottled);
  }

  // This is "main()" for this script. Runs periodically when the page updates.
  function onPageUpdated() {
    try {
      // The page may not have refreshed when moving between URLs--sometimes AzDO acts as a single-page application. So we must always check where we are and act accordingly.
      if (/\/(pullrequest)\//i.test(window.location.pathname)) {
        addBaseUpdateSelector();
        makePullRequestDiffEasierToScroll();
        applyStickyPullRequestComments();
        highlightAwaitComments();
        addAccessKeysToPullRequestTabs();
        if (atNI) {
          addOwnersInfoToFiles();
          conditionallyAddBypassReminderAsync();
        }
        addTrophiesToPullRequest();
        if (atNI && /\/DevCentral\/_git\/ASW\//i.test(window.location.pathname)) {
          addNICodeOfDayToggle();
        }
      }

      if (atNI) {
        styleLabels();
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
      .label--owners {
      }
      .label--draft {
        background: #8808 !important;
      }
      .label--tiny {
        background: #0a08 !important;
      }
      .label--bypassowners {
      }`);
  }

  addStyleOnce('bypassOwnersPrompt', /* css */ `
    .bypass-reminder {
      display: inline;
      position: absolute;
      top: 38px;
      left: -240px;
      z-index: 1000;
      background-color: #E6B307;
      padding: 6px 12px;
      border-radius: 6px;
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
      border-radius: 4px;
      transition: 0.3s;
    }
    .vote-button-wrapper:hover {
      border-color: #E6B307;
    }
    .vote-button-wrapper:hover ~ .bypass-reminder {
      opacity: 1;
    }`);

  function styleLabels() {
    // Give all tags a CSS class based on their name.
    $('.tag-box').once('labels').each(function () {
      const tagBox = $(this);
      const subClass = stringToCssIdentifier(tagBox.text());
      tagBox.addClass(`label--${subClass}`);
    });
  }

  function watchForNewLabels() {
    // Give all tags a CSS class based on their name.
    eus.globalSession.onEveryNew(document, '.bolt-pill', label => {
      if (!label.ariaLabel) return;
      const subClass = stringToCssIdentifier(label.ariaLabel);
      label.classList.add(`label--${subClass}`);
    });
  }

  function stringToCssIdentifier(text) {
    return encodeURIComponent(text.toLowerCase()).replace(/%[0-9A-F]{2}/gi, '');
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
      await sleep(100);
      const button = this.querySelector(`button.ms-Button.expand-button[aria-label*="${lowerCasePrefixCssSelector}" i]`);
      if (button) {
        button.click();
      }
    });
  }

  function addAccessKeysToPullRequestTabs() {
    // Give all the tabs an access key equal to their numeric position on screen.
    $('ul.vc-pullrequest-tabs a').once('add-accesskeys').each(function () {
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
    banner.appendChild(document.createTextNode('If you vouch for the whole PR, please bypass owners.'));

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
  function addTrophiesToPullRequest() {
    // Pull request author is sometimes undefined on first call. Only add trophies if we can get the author name.
    const pullRequestAuthor = $('div.ms-TooltipHost.host_e6f6b93f.created-by-label').children('span').text();

    // Only create the trophies section once.
    if ($('#trophies-section').length === 0 && pullRequestAuthor.length !== 0) {
      const pullRequestId = getCurrentPullRequestId();
      let trophyAwarded = false;

      const trophiesLeftPaneSection = $('<div>').addClass('vc-pullrequest-leftpane-section').attr('id', 'trophies-section');

      const sectionTitle = $('<div>').addClass('vc-pullrequest-leftpane-section-title').append('<span>Trophies</span>');
      const divider = $('<div>').addClass('divider');
      const sectionContent = $('<div>').addClass('policies-section');

      trophiesLeftPaneSection
        .append(sectionTitle)
        .append(divider)
        .append(sectionContent);

      // Milestone trophy: Awarded if pull request ID is greater than 1000 and is a non-zero digit followed by only zeroes (e.g. 1000, 5000, 10000).
      if (pullRequestId >= 1000 && pullRequestId.match('^[1-9]0+$')) {
        const milestoneTrophyMessage = $('<div>)').text(`${pullRequestAuthor} got pull request #${pullRequestId}!`);
        sectionContent.append(milestoneTrophyMessage.prepend('&ensp;🏆&emsp;'));
        trophyAwarded = true;
      }

      // Fish trophy: Give a man a fish, he'll waste hours trying to figure out why. (Awarded if the ID is a palindrome.)
      if (pullRequestId === pullRequestId.split('').reverse().join('')) {
        const fishTrophyMessage = $('<div>)').text(`${pullRequestAuthor} got a fish trophy!`);
        sectionContent.append(fishTrophyMessage.prepend('&ensp;🐠&emsp;'));
        trophyAwarded = true;
      }

      // Add the trophy section to the Overview tab pane only if a trophy has been awarded.
      if (trophyAwarded) {
        $('div.overview-tab-pane').append(trophiesLeftPaneSection);
      }
    }
  }

  function makePullRequestDiffEasierToScroll() {
    addStyleOnce('pr-diff-improvements', /* css */ `
      .vc-change-summary-files .file-container {
        /* Make the divs float but clear them so they get stacked on top of each other. We float so that the divs expand to take up the width of the text in it. Finally, we remove the overflow property so that they don't have scrollbars and also such that we can have sticky elements (apparently, sticky elements don't work if the div has overflow). */
        float: left;
        clear: both;
        min-width: 95%;
        overflow: initial;
      }
      .vc-change-summary-files .file-row {
        /* Let the file name section of each diff stick to the top of the page if we're scrolling. */
        position: sticky;
        top: 0;
        z-index: 100000;
        padding-bottom: 10px;
        background: var(--background-color,rgba(255, 255, 255, 1));
      }
      .vc-change-summary-files .vc-diff-viewer {
        /* We borrowed padding from the diff to give to the bottom of the file row. So adjust accordingly (this value was originally 20px). */
        padding-top: 10px;
      }`);
  }

  // The func we'll call to continuously add checkboxes to the PR file listing, once initialization is over.
  let annotateFilesTreeFunc = () => { };

  // If we're on specific PR, add checkboxes to the file listing.
  function addOwnersInfoToFiles() {
    $('.vc-pullrequest-leftpane-section.files-tab').once('annotate-with-owners-info').each(async () => {
      annotateFilesTreeFunc = () => { };

      addStyleOnce('pr-file-tree-annotations-css', /* css */ `
        :root {
          /* Set some constants for our CSS. */
          --file-to-review-color: var(--communication-foreground);
        }
        .vc-sparse-files-tree .tree-row.file-to-review-row,
        .vc-sparse-files-tree .tree-row.file-to-review-row .file-name {
          /* Highlight files I need to review. */
          color: var(--file-to-review-color);
          transition-duration: 0.2s;
        }
        .vc-sparse-files-tree .tree-row.folder-to-review-row[aria-expanded='false'],
        .vc-sparse-files-tree .tree-row.folder-to-review-row[aria-expanded='false'] .file-name {
          /* Highlight folders that have files I need to review, but only when files are hidden cause the folder is collapsed. */
          color: var(--file-to-review-color);
          transition-duration: 0.2s;
        }
        .vc-sparse-files-tree .tree-row.file-to-review-row .file-owners-role {
          /* Style the role of the user in the files table. */
          font-weight: bold;
          padding: 7px 10px;
          position: absolute;
          z-index: 100;
          float: right;
        }
        .file-to-review-diff {
          /* Highlight files I need to review. */
          border-left: 3px solid var(--file-to-review-color) !important;
          padding-left: 7px;
        }
        .files-container.hide-files-not-to-review .file-container:not(.file-to-review-diff) {
          /* Fade the header for files I don't have to review. */
          opacity: 0.2;
        }
        .files-container.hide-files-not-to-review .file-container:not(.file-to-review-diff) .item-details-body {
          /* Hide the diff for files I don't have to review. */
          display: none;
        }
        .toolbar-button {
          background: transparent;
          color: var(--text-primary-color);
          border: 1px solid transparent;
          border-radius: 3px;
          margin: 0px 2px;
        }
        .toolbar-button:hover {
          border: 1px solid var(--palette-black-alpha-20);
        }
        .toolbar-button.active {
          color: var(--communication-foreground);
        }`);

      // Get the current iteration of the PR.
      const prUrl = await getCurrentPullRequestUrlAsync();

      // Get owners info for this PR.
      const ownersInfo = await getNationalInstrumentsPullRequestOwnersInfo(prUrl);
      const hasOwnersInfo = ownersInfo && ownersInfo.currentUserFileCount > 0;

      // If we have owners info, add a button to filter out diffs that we don't need to review.
      if (hasOwnersInfo) {
        $('.changed-files-summary-toolbar').once('add-other-files-button').each(function () {
          $(this)
            .find('ul')
            .prepend('<li class="menu-item" role="button"><a href="#">Toggle other files</a></li>')
            .click(event => {
              $('.files-container').toggleClass('hide-files-not-to-review');
            });
        });
      }

      // If the user presses this button, it will auto-collapse folders in the files tree. Useful for large reviews.
      let collapseFolderButtonClicks = 0;
      const collapseFoldersButton = $('<button class="toolbar-button" />')
        .text('⇐')
        .attr('title', 'Toggle auto-collapsing folders.')
        .insertAfter($('.vc-iteration-selector'))
        .on('click', (event) => {
          collapseFoldersButton.toggleClass('active');
          collapseFolderButtonClicks += 1;
          annotateFilesTreeFunc(); // Kick off the first collapsing, cause this function only runs if something changes in the DOM.
          event.stopPropagation();
        });

      annotateFilesTreeFunc = function () {
        // If we have owners info, tag the diffs that we don't need to review.
        if (hasOwnersInfo) {
          $('.file-container .file-path').once('filter-files-to-review').each(function () {
            const filePathElement = $(this);
            const path = filePathElement.text().replace(/\//, '');
            filePathElement.closest('.file-container').toggleClass('file-to-review-diff', ownersInfo.isCurrentUserResponsibleForFile(path));
          });
        }

        if (collapseFoldersButton.hasClass('active')) {
          // The toggle folder collapsible button is active. Let's collapse folders that we've marked as collapsible.
          $('.auto-collapsible-folder').once(`collapse-${collapseFolderButtonClicks}`).each(async function () {
            const row = $(this);
            let attemptsLeft = 3; // This is gross, but sometimes the folder doesn't actually collapse. So let's wait a bit and check again.
            while (attemptsLeft > 0 && row.attr('aria-expanded') === 'true') {
              row.find('.expand-icon').click();
              // eslint-disable-next-line no-await-in-loop
              await sleep(300);
              attemptsLeft -= 1;
            }
          });
        }

        $('.vc-sparse-files-tree .vc-tree-cell').once('annotate-with-owners-info').each(function () {
          const fileCell = $(this);
          const fileRow = fileCell.closest('.tree-row');
          const listItem = fileRow.parent()[0];
          const typeIcon = fileRow.find('.type-icon');

          const { fullName: pathWithLeadingSlash, isFolder, depth } = getPropertyThatStartsWith(listItem, '__reactEventHandlers$').children.props.item;
          const path = pathWithLeadingSlash.substring(1); // Remove leading slash.

          // Don't do anything at the root.
          if (depth === 0) {
            return;
          }

          // If we have owners info, mark folders that have files we need to review. This will allow us to highlight them if they are collapsed.
          const folderContainsFilesToReview = hasOwnersInfo && isFolder && ownersInfo.isCurrentUserResponsibleForFileInFolderPath(`${path}/`);
          fileRow.toggleClass('folder-to-review-row', folderContainsFilesToReview);
          fileRow.toggleClass('auto-collapsible-folder', !folderContainsFilesToReview);

          // Don't put checkboxes on rows that don't represent files.
          if (!/bowtie-file\b/i.test(typeIcon.attr('class'))) {
            return;
          }

          // If we have owners info, highlight the files we need to review and add role info.
          if (hasOwnersInfo && ownersInfo.isCurrentUserResponsibleForFile(path)) {
            fileRow.addClass('file-to-review-row');
            $('<div class="file-owners-role" />').text(`${ownersInfo.currentUserFilesToRole[path]}:`).prependTo(fileRow);
          }
        });
      };
    });

    annotateFilesTreeFunc();
  }

  // If we're on specific PR, add a base update selector.
  function addBaseUpdateSelector() {
    $('.vc-iteration-selector').once('add-base-selector').each(async function () {
      const toolbar = $(this);

      addStyleOnce('base-selector-css', /* css */ `
        .base-selector {
          color: var(--text-secondary-color);
          margin: 0px 5px 0px 0px;
        }
        .base-selector select {
          border: 1px solid transparent;
          padding: 2px 4px;
          width: 3em;
          height: 100%;
          text-align: center;
        }
        .base-selector select:hover {
          border-color: var(--palette-black-alpha-20);
        }
        .base-selector select option {
          background: var(--callout-background-color);
          color: var(--text-primary-color);
          font-family: Consolas, monospace;
        }
        .base-selector select option:disabled {
          display: none;
        }`);

      // Get the PR iterations.
      const prUrl = await getCurrentPullRequestUrlAsync();
      const iterations = (await $.get(`${prUrl}/iterations?api-version=5.0`)).value;

      // Create a dropdown with the first option being the icon we show to users. We use an HTML dropdown since its much easier to code than writing our own with divs/etc or trying to figure out how to use an AzDO dropdown.
      const selector = $('<select><option value="" disabled selected>↦</option></select>');

      // Add an option for each iteration in the dropdown, looking roughly the same as the AzDO update selector.
      for (const iteration of iterations.reverse()) {
        const date = Date.parse(iteration.createdDate);
        const truncatedDescription = truncate(iteration.description);
        const optionText = `Update ${iteration.id.toString().padEnd(4)} ${truncatedDescription.padEnd(61)} ${dateFns.distanceInWordsToNow(date).padStart(15)} ago`;
        $('<option>').val(iteration.id).text(optionText).appendTo(selector);
      }

      // Add the last option to select the merge base as the diff base (essentially update zero).
      $('<option value="0">            === Merge Base ===</option>').appendTo(selector);

      // Replace spaces with non-breaking spaces (char 0xa0) to force the browser to not collapse it so that we can align the dates to the right of the dropdown. Apprently even `white-space: pre !important;` doesn't work on `option` element css.
      selector.children('option').each(function () { $(this).text((i, text) => text.replace(/ /g, '\xa0')); });

      // Finally add the dropdown to the toolbar.
      $('<div class="base-selector" />').append(selector).prependTo(toolbar);

      // When an option is selected, update the URL to include the selected base update.
      selector.on('change', function (event) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('base', $(this).first().val());
        currentUrl.searchParams.set('iteration', currentUrl.searchParams.get('iteration') || iterations.length); // If we select a base without having an explicit iteration, compare the base to the latest.
        window.location.href = currentUrl.toString();
      });
    });
  }

  // Add a button to toggle flagging a PR discussion thread for ASW "Code of the Day" blog posts.
  function addNICodeOfDayToggle() {
    function getThreadDataFromDOMElement(threadElement) {
      return getPropertyThatStartsWith(threadElement, '__reactEventHandlers$').children[0].props.thread;
    }

    function updateButtonForCurrentState(jqElements, isFlagged) {
      const flaggedIconClass = 'bowtie-live-update-feed-off';
      const notFlaggedIconClass = 'bowtie-live-update-feed';
      const classToAdd = isFlagged ? flaggedIconClass : notFlaggedIconClass;
      const classToRemove = isFlagged ? notFlaggedIconClass : flaggedIconClass;
      jqElements.find('.cod-toggle-icon').addClass(classToAdd).removeClass(classToRemove);
      jqElements.attr('title', isFlagged ? 'Un-suggest for "Code of the Day" blog post' : 'Suggest for "Code of the Day" blog post');
    }

    $('.vc-discussion-comment-toolbar').once('add-cod-flag-support').each(async function () {
      const thread = getThreadDataFromDOMElement($(this).closest('.vc-discussion-comments')[0]);
      const isFlagged = findFlaggedThreadArrayIndex(await getNICodeOfTheDayThreadsAsync(), thread.id, currentUser.uniqueName) !== -1;
      const button = $('<button type="button" class="ms-Button vc-discussion-comment-toolbarbutton ms-Button--icon cod-toggle"><i class="ms-Button-icon cod-toggle-icon bowtie-icon" role="presentation"></i></button>');
      updateButtonForCurrentState(button, isFlagged);
      button.prependTo(this);
      button.click(async function (event) {
        const isNowFlagged = await toggleThreadFlaggedForNICodeOfTheDay(await getCurrentPullRequestUrlAsync(), {
          flaggedDate: new Date().toISOString(),
          flaggedBy: currentUser.uniqueName,
          pullRequestId: getCurrentPullRequestId(),
          threadId: thread.id,
          file: thread.itemPath,
          threadAuthor: thread.comments[0].author.displayName,
          threadContentShort: truncate(thread.comments[0].content || thread.comments[0].newContent, 100),
        });

        // Update the button visuals in this thread
        updateButtonForCurrentState($(this).parents('.vc-discussion-comments').find('.cod-toggle'), isNowFlagged);
      });
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
    await sleep(333);

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

  function watchForNewDiffs() {
    eus.onUrl(/\/pullrequest\//gi, (session, urlMatch) => {
      let languageDefinitions = null;
      session.onEveryNew(document, '.text-diff-container', diff => {
        if (eus.seen(diff)) return;

        // Only parse languages if we have something to diff.
        if (!languageDefinitions) {
          languageDefinitions = parseLanguageDefinitions();
        }

        // TODO: Handle new PR experience.

        session.onFirst(diff.closest('.file-container'), '.file-cell .file-name-link', fileNameLink => {
          const fileName = fileNameLink.innerText.toLowerCase();
          const extension = getFileExt(fileName);

          const leftPane = diff.querySelector('.leftPane > div > .side-by-side-diff-container');
          const rightOrUnifiedPane = diff.querySelector('.rightPane > div > .side-by-side-diff-container') || diff;

          // Guess our language based on our file extension.
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

    // For debugging: console.debug(`Supporting ${Object.keys(extensionToMode).length} extensions and ${Object.keys(fileToMode).length} special filenames`);
    return { extensionToMode, fileToMode };
  }

  function highlightDiff(language, fileName, part, diffContainer, selector) {
    if (!diffContainer) return;

    // For debugging: console.debug(`Highlighting ${part} of <${fileName}> as ${language}`);

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

  // Async helper function to sleep.
  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
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

  // Cached "Code of the Day" thread data.
  let niCodeOfTheDayThreadsArray = null;

  // Async helper function to flag or unflag a PR discussion thread for National Instruments "Code of the Day" blog.
  async function toggleThreadFlaggedForNICodeOfTheDay(prUrl, value) {
    const flaggedComments = await getNICodeOfTheDayThreadsAsync();
    const index = findFlaggedThreadArrayIndex(flaggedComments, value.threadId, value.flaggedBy);
    if (index >= 0) {
      // found, so unflag it
      flaggedComments.splice(index, 1);
    } else {
      // not found, so flag it
      flaggedComments.push(value);
    }

    const patch = [{
      op: flaggedComments.length ? 'add' : 'remove',
      path: '/NI.CodeOfTheDay',
      value: flaggedComments.length ? JSON.stringify(flaggedComments) : null,
    }];
    try {
      await $.ajax({
        type: 'PATCH',
        url: `${prUrl}/properties?api-version=5.1-preview.1`,
        data: JSON.stringify(patch),
        contentType: 'application/json-patch+json',
      });
    } catch (e) {
      // invalidate cached value so we re-fetch
      niCodeOfTheDayThreadsArray = null;
    }

    // re-query to get the current state of the flagged threads
    return findFlaggedThreadArrayIndex((await getNICodeOfTheDayThreadsAsync()), value.threadId, value.flaggedBy) !== -1;
  }

  // Helper function to find the index of a flagged thread record within the provided array.
  function findFlaggedThreadArrayIndex(flaggedCommentArray, threadId, flaggedBy) {
    return _.findIndex(flaggedCommentArray, x => x.threadId === threadId && x.flaggedBy === flaggedBy);
  }

  // Async helper function to get the discussion threads (in the current PR) that have been flagged for "Code of the Day."
  async function getNICodeOfTheDayThreadsAsync() {
    if (!niCodeOfTheDayThreadsArray) {
      niCodeOfTheDayThreadsArray = await getPullRequestProperty(await getCurrentPullRequestUrlAsync(), 'NI.CodeOfTheDay', []);
    }
    return niCodeOfTheDayThreadsArray;
  }

  // Helper function to access an object member, where the exact, full name of the member is not known.
  function getPropertyThatStartsWith(instance, startOfName) {
    return instance[Object.getOwnPropertyNames(instance).find(x => x.startsWith(startOfName))];
  }

  // Helper function to limit a string to a certain length, adding an ellipsis if necessary.
  function truncate(text, maxLength) {
    return text.length > maxLength ? `${text.substring(0, maxLength - 3)}...` : text;
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
    };

    // See if the current user is listed in this PR.
    const currentUserListedInThisOwnerReview = _(reviewProperties.reviewerIdentities).some(r => r.email === currentUser.uniqueName);

    // Go through all the files listed in the PR.
    if (currentUserListedInThisOwnerReview) {
      for (const file of reviewProperties.fileProperties) {
        // Get the identities associated with each of the known roles.
        // Note that the values for file.owner/alternate/reviewers may contain the value 0 (which is not a valid 1-based index) to indicate nobody for that role.
        const owner = reviewProperties.reviewerIdentities[file.owner - 1] || {};
        const alternate = reviewProperties.reviewerIdentities[file.alternate - 1] || {}; // handle nulls everywhere
        const reviewers = file.reviewers.map(r => reviewProperties.reviewerIdentities[r - 1] || {}) || [];

        // Pick the highest role for the current user on this file, and track it.
        if (owner.email === currentUser.uniqueName) {
          ownersInfo.currentUserFilesToRole[file.path] = 'O';
          ownersInfo.currentUserFileCount += 1;
        } else if (alternate.email === currentUser.uniqueName) {
          ownersInfo.currentUserFilesToRole[file.path] = 'A';
          ownersInfo.currentUserFileCount += 1;
          // eslint-disable-next-line no-loop-func
        } else if (_(reviewers).some(r => r.email === currentUser.uniqueName)) {
          ownersInfo.currentUserFilesToRole[file.path] = 'R';
          ownersInfo.currentUserFileCount += 1;
        }
      }
    }

    return ownersInfo;
  }

  // Start modifying the page once the DOM is ready.
  if (document.readyState !== 'loading') {
    onReady();
  } else {
    document.addEventListener('DOMContentLoaded', onReady);
  }
}());
