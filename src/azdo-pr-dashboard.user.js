// ==UserScript==

// @name         AzDO Pull Request Improvements
// @version      2.35.0
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

// @run-at       document-end
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.3.1/jquery.min.js#sha256-FgpCb/KJQlLNfOu91ta32o/NMZxltwRo8QtmkMRdAu8=
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery-once/2.2.3/jquery.once.min.js#sha256-HaeXVMzafCQfVtWoLtN3wzhLWNs8cY2cH9OIQ8R9jfM=
// @require      https://cdnjs.cloudflare.com/ajax/libs/lscache/1.3.0/lscache.js#sha256-QVvX22TtfzD4pclw/4yxR0G1/db2GZMYG9+gxRM9v30=
// @require      https://cdnjs.cloudflare.com/ajax/libs/date-fns/1.30.1/date_fns.min.js#sha256-wCBClaCr6pJ7sGU5kfb3gQMOOcIZNzaWpWcj/lD9Vfk=
// @require      https://cdn.jsdelivr.net/npm/lodash@4.17.11/lodash.min.js#sha256-7/yoZS3548fXSRXqc/xYzjsmuW3sFKzuvOCHd06Pmps=

// ==/UserScript==

(function () {
  'use strict';

  // All REST API calls should fail after a timeout, instead of going on forever.
  $.ajaxSetup({ timeout: 5000 });

  // Find out who is our current user. In general, we should avoid using pageData because it doesn't always get updated when moving between page-to-page in AzDO's single-page application flow. Instead, rely on the AzDO REST APIs to get information from stuff you find on the page or the URL. Some things are OK to get from pageData; e.g. stuff like the user which is available on all pages.
  const pageData = JSON.parse(document.getElementById('dataProviders').innerHTML).data;
  const currentUser = pageData['ms.vss-web.page-data'].user;

  // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
  const azdoApiBaseUrl = `${window.location.origin}${pageData['ms.vss-tfs-web.header-action-data'].suiteHomeUrl}`;

  // Set a namespace for our local storage items.
  lscache.setBucket('acb-azdo/');

  // Call our event handler if we notice new elements being inserted into the DOM. This happens as the page is loading or updating dynamically based on user activity. We throttle new element events to avoid using up CPU when AzDO is adding a lot of elements during a short time (like on page load).
  document.addEventListener('DOMNodeInserted', _.throttle(onPageDOMNodeInserted, 400));

  // This is "main()" for this script. Runs periodically when the page updates.
  function onPageDOMNodeInserted(event) {
    // The page may not have refreshed when moving between URLs--sometimes AzDO acts as a single-page application. So we must always check where we are and act accordingly.
    if (/\/(pullrequest)\//i.test(window.location.pathname)) {
      addCheckboxesToFiles();
      addBaseUpdateSelector();
      makePullRequestDiffEasierToScroll();
      applyStickyPullRequestComments();
      highlightAwaitComments();
      addAccessKeysToPullRequestTabs();
      if (/\/DevCentral\/_git\/ASW\//i.test(window.location.pathname)) {
        addNICodeOfDayToggle();
      }
    } else if (/\/(_pulls|pullrequests)/i.test(window.location.pathname)) {
      enhancePullRequestDashboard();
    }

    if (/\/(pullrequests)/i.test(window.location.pathname)) {
      addOrgPRLink();
    }

    enhanceOverallUX();
  }

  function getRepoNameFromUrl(url) {
    const repoName = url.match(/_git\/(.+)\/pullrequests/)[1];
    return repoName || '';
  }

  function addOrgPRLink() {
    $('.page-title').once('decorate-with-org-pr-link').each(function () {
      const titleElement = this;
      $(titleElement).text((i, oldText) => `${getRepoNameFromUrl(window.location.pathname)} ${oldText}`);
      const orgPRLink = document.createElement('a');
      orgPRLink.href = `${azdoApiBaseUrl}_pulls`;
      orgPRLink.text = 'View global PR dashboard';
      orgPRLink.style = 'margin: 15px; font-size: 80%';
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
  let addCheckboxesToNewFilesFunc = () => { };

  // If we're on specific PR, add checkboxes to the file listing.
  function addCheckboxesToFiles() {
    const hasBuiltInCheckboxes = $('.viewed-icon').length > 0 || window.location.href.match(/\/ni[/.]/);

    $('.vc-pullrequest-leftpane-section.files-tab').once('add-checkbox-support').each(async function () {
      addCheckboxesToNewFilesFunc = () => { };

      const filesTree = $(this).find('.vc-sparse-files-tree');

      addStyleOnce('pr-file-checkbox-support-css', /* css */ `
        :root {
          /* Set some constants for our CSS. */
          --file-to-review-color: var(--communication-foreground);
        }
        button.file-complete-checkbox {
          /* Make a checkbox out of a button. */
          cursor: pointer;
          width: 15px;
          height: 15px;
          line-height: 15px;
          margin: -3px 8px 0px 0px;
          padding: 0px;
          background: var(--palette-black-alpha-6);
          border-radius: 3px;
          border: 1px solid var(--palette-black-alpha-10);
          vertical-align: middle;
          display: inline-block;
          font-size: 0.75em;
          text-align: center;
          color: var(--text-primary-color);
        }
        button.file-complete-checkbox:hover {
          /* Make a checkbox out of a button. */
          background: var(--palette-black-alpha-10);
        }
        button.file-complete-checkbox.checked:after {
          /* Make a checkbox out of a button. */
          content: "✔";
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
      const currentPullRequestIteration = (await $.get(`${prUrl}/iterations?api-version=5.0`)).count;

      // Get the current checkbox state for the PR at this URL.
      const checkboxStateId = `pr-file-iteration6/${window.location.pathname}`;

      // Stores the checkbox state for the current page. A map of files => iteration it was checked.
      const filesToIterationReviewed = lscache.get(checkboxStateId) || {};

      // Handle clicking on file checkboxes.
      filesTree.on('click', 'button.file-complete-checkbox', function (event) {
        const checkbox = $(this);

        // Toggle the look of the checkbox.
        checkbox.toggleClass('checked');

        // Save the iteration number the file was checked in our map. To save space, if it is unchecked, simply remove the entry.
        if (checkbox.hasClass('checked')) {
          filesToIterationReviewed[checkbox.attr('name')] = currentPullRequestIteration;
        } else {
          delete filesToIterationReviewed[checkbox.attr('name')];
        }

        // Save the current checkbox state to local storage.
        lscache.set(checkboxStateId, filesToIterationReviewed, 60 * 24 * 21);

        // Stop the click event here to avoid the checkbox click from selecting the PR row underneath, which changes the active diff in the right panel.
        event.stopPropagation();
      });

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
          addCheckboxesToNewFilesFunc(); // Kick off the first collapsing, cause this function only runs if something changes in the DOM.
          event.stopPropagation();
        });

      addCheckboxesToNewFilesFunc = function () {
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
        $('.vc-sparse-files-tree .vc-tree-cell').once('add-complete-checkbox').each(function () {
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

          if (!hasBuiltInCheckboxes) {
            const name = fileCell.attr('content'); // The 'content' attribute contains the file operation; e.g. "/src/file.cs [edit]".
            const iteration = filesToIterationReviewed[name] || 0;

            // Create the checkbox before the type icon.
            $('<button class="file-complete-checkbox" />')
              .attr('name', name)
              .toggleClass('checked', iteration > 0)
              .insertBefore(typeIcon);
          }

          // If we have owners info, highlight the files we need to review and add role info.
          if (hasOwnersInfo && ownersInfo.isCurrentUserResponsibleForFile(path)) {
            fileRow.addClass('file-to-review-row');
            $('<div class="file-owners-role" />').text(`${ownersInfo.currentUserFilesToRole[path]}:`).prependTo(fileRow);
          }
        });
      };
    });

    addCheckboxesToNewFilesFunc();
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

  // Define what it means to be a notable PR after you have approved it.
  const peopleToNotApproveToCountAsNotableThread = 2;
  const commentsToCountAsNotableThread = 4;
  const wordsToCountAsNotableThread = 300;
  const notableUpdateDescription = `These are pull requests you've already approved, but since then, any of following events have happened:&#013    1) At least ${peopleToNotApproveToCountAsNotableThread} people voted Rejected or Waiting on Author&#013    2) A thread was posted with at least ${commentsToCountAsNotableThread} comments&#013    3) A thread was posted with at least ${wordsToCountAsNotableThread} words&#013Optional: To remove PRs from this list, simply vote again on the PR (even if it's the same vote).`;

  // The func we'll call to continuously sort new PRs into categories, once initialization is over.
  let sortEachPullRequestFunc = () => { };

  // If we're on a pull request page, attempt to sort it.
  function enhancePullRequestDashboard() {
    // Find the reviews section for this user. Note the two selectors: 1) a repo dashboard; 2) the overall dashboard (e.g. https://dev.azure.com/*/_pulls).
    $("[aria-label='Assigned to me'][role='region'], .ms-GroupedList-group:has([aria-label*='Assigned to me'])").once('prs-enhanced').each(function () {
      sortEachPullRequestFunc = () => { };

      const personalReviewSection = $(this);
      const createdByMeSection = $("[aria-label='Created by me'][role='region'], .ms-GroupedList-group:has([aria-label*='Created by me'])");

      // Disable the expanding button if we are on the overall PR dashboard. If enabled and the user hides/shows this section, it causes the AzDO page to re-add all the PRs, leading to duplicates in the sorted list.
      personalReviewSection.find('.collapsible-group-header button').hide();
      createdByMeSection.find('.collapsible-group-header button').hide();

      addStyleOnce('reviews-list-css', /* css */ `
        details.reviews-list {
          margin: 10px 30px;
          display: none;
        }
        details.reviews-list summary {
          padding: 10px;
          cursor: pointer;
          color: var(--text-secondary-color);
        }
        details.reviews-list > div.flex-container {
          display: flex;
          flex-direction: column-reverse;
        }`);

      // Create review sections with counters.
      const sections = {
        blocking:
          $("<details class='reviews-list reviews-pending'><summary style='color: var(--status-error-foreground); font-weight: bold'>Blocking</summary></details>").appendTo(personalReviewSection),

        pending:
          $("<details class='reviews-list reviews-pending'><summary>Incomplete</summary></details>").appendTo(personalReviewSection),

        blocked:
          $("<details class='reviews-list reviews-incomplete-blocked'><summary>Incomplete but blocked</summary></details>").appendTo(personalReviewSection),

        approvedButNotable:
          $(`<details class='reviews-list reviews-approved-notable'><summary>Completed as Approved / Approved with Suggestions (<abbr title="${notableUpdateDescription}">with notable activity</abbr>)</summary></details>`).appendTo(personalReviewSection),

        drafts:
          $("<details class='reviews-list reviews-drafts'><summary>Drafts</summary></details>").appendTo(personalReviewSection),

        waiting:
          $("<details class='reviews-list reviews-waiting'><summary>Completed as Waiting on Author</summary></details>").appendTo(personalReviewSection),

        rejected:
          $("<details class='reviews-list reviews-rejected'><summary>Completed as Rejected</summary></details>").appendTo(personalReviewSection),

        approved:
          $("<details class='reviews-list reviews-approved'><summary>Completed as Approved / Approved with Suggestions</summary></details>").appendTo(personalReviewSection),

        createdByMe:
          $("<details class='reviews-list reviews-created-by-me'><summary>Active</summary></details>").appendTo(createdByMeSection),

        draftsCreatedByMe:
          $("<details class='reviews-list reviews-drafts-created-by-me'><summary>Drafts</summary></details>").appendTo(createdByMeSection),
      };

      // Load the subsection open/closed setting if it exists and setup a change handler to save the setting. We also add common elements to each sections.
      for (const section of Object.values(sections)) {
        const id = `pr-section-open/${section.attr('class')}`;
        section.children('summary').append(" (<span class='review-subsection-counter'>0</span>)");
        section.append("<div class='flex-container' />");
        section.prop('open', lscache.get(id));
        section.on('toggle', function () { lscache.set(id, $(this).prop('open')); });
      }

      // Loop through the PRs that we've voted on.
      sortEachPullRequestFunc = () => $("[role='region'], .ms-GroupedList-group").find('[role="list"] [role="listitem"]').once('pr-enhanced').each(async function () {
        const row = $(this);
        const isAssignedToMe = $(personalReviewSection).has(row).length !== 0;
        const isCreatedByMe = $(createdByMeSection).has(row).length !== 0;

        // Loop until AzDO has added the link to the PR into the row.
        let pullRequestHref;
        while (!pullRequestHref) {
          // Important! Do not remove this sleep, even on the first iteration. We need to give AzDO some time to finish making the row before moving it. If we don't sleep for some time, and we begin moving rows, AzDO may get confused and not create all the PR rows. That would cause some PRs to not be rendered in the list. The best solution is to wait until the list finishes to render via an event handler; except that I don't know how to hook into that without understanding AzDO JS infrastructure. The sleep time was chosen to balance first load time (don't wait too long before sorting) and what appears to be long enough to avoid the missing PR problem when sorting a 50+ PR dashboard, as determined by experimentation (refreshing the page a dozen or so times).
          // eslint-disable-next-line no-await-in-loop
          await sleep(300);
          pullRequestHref = row.find("a[href*='/pullrequest/']").attr('href');
        }

        try {
          // Hide the row while we are updating it.
          row.hide(150);

          // Get the PR id.
          const pullRequestUrl = new URL(pullRequestHref, window.location.origin);
          const pullRequestId = parseInt(pullRequestUrl.pathname.substring(pullRequestUrl.pathname.lastIndexOf('/') + 1), 10);

          // Get complete information about the PR.
          const pr = await getPullRequestAsync(pullRequestId);

          if (isAssignedToMe) {
            // Get non-deleted pr threads, ordered from newest to oldest.
            const prThreads = (await $.get(`${pr.url}/threads?api-version=5.0`)).value.filter(x => !x.isDeleted).reverse();
            assignSortOrderToPullRequest(row, getReviewerAddedOrResetTimestamp(prThreads, currentUser.uniqueName) || pr.createdDate);

            // Count the number of votes.
            let missingVotes = 0;
            let waitingOrRejectedVotes = 0;
            let userVote = 0;
            for (const reviewer of pr.reviewers) {
              if (reviewer.uniqueName === currentUser.uniqueName) {
                userVote = reviewer.vote;
              }
              if (reviewer.vote === 0) {
                missingVotes += 1;
              } else if (reviewer.vote < 0) {
                waitingOrRejectedVotes += 1;
              }
            }

            if (pr.isDraft) {
              movePullRequestIntoSection(row, sections.drafts);
            } else if (userVote === -5) {
              movePullRequestIntoSection(row, sections.waiting);
            } else if (userVote < 0) {
              movePullRequestIntoSection(row, sections.rejected);
            } else if (userVote > 0) {
              const hasNotableActivity = prHadNotableActivitySinceCurrentUserVoted(prThreads, peopleToNotApproveToCountAsNotableThread, commentsToCountAsNotableThread, wordsToCountAsNotableThread);
              movePullRequestIntoSection(row, hasNotableActivity ? sections.approvedButNotable : sections.approved);
            } else if (waitingOrRejectedVotes > 0) {
              movePullRequestIntoSection(row, sections.blocked);
            } else if (missingVotes === 1) {
              movePullRequestIntoSection(row, sections.blocking);
            } else {
              movePullRequestIntoSection(row, sections.pending);
            }
          } else if (isCreatedByMe) {
            if (pr.lastMergeCommit) {
              assignSortOrderToPullRequest(row, pr.lastMergeCommit.committer.date);
            } else {
              assignSortOrderToPullRequest(row, pr.createdDate);
            }

            if (pr.isDraft) {
              movePullRequestIntoSection(row, sections.draftsCreatedByMe);
            } else {
              movePullRequestIntoSection(row, sections.createdByMe);
            }
          }

          // Compute the size of certain PRs; e.g. those we haven't reviewed yet. But first, sure we've created a merge commit that we can compute its size.
          if (pr.lastMergeCommit) {
            await annotateFileCountOnPullRequestRow(row, pr, isAssignedToMe);
            await annotateBuildStatusOnPullRequestRow(row, pr);
          }
        } finally {
          // No matter what--e.g. even on error--show the row again.
          row.show(150);
        }
      });
    });

    sortEachPullRequestFunc();
  }

  async function annotateFileCountOnPullRequestRow(row, pr, isAssignedToMe) {
    let fileCount = 0;

    // See if this PR has owners info and count the files listed for the current user.
    if (isAssignedToMe) {
      const ownersInfo = await getNationalInstrumentsPullRequestOwnersInfo(pr.url);
      if (ownersInfo) {
        fileCount = ownersInfo.currentUserFileCount;
      }
    }

    // If there is no owner info or if it returns zero files to review (since we may not be on the review explicitly), then count the number of files in the merge commit.
    if (fileCount === 0) {
      const mergeCommitInfo = await $.get(`${pr.lastMergeCommit.url}/changes?api-version=5.0`);
      fileCount = _(mergeCommitInfo.changes).filter(item => !item.item.isFolder).size();
    }

    annotatePullRequestRow(row, $(`<span><span class="contributed-icon flex-noshrink fabric-icon ms-Icon--FileCode"></span>&nbsp;${fileCount}</span>`));
  }

  async function annotateBuildStatusOnPullRequestRow(row, pr) {
    const builds = (await $.get(`${pr.lastMergeCommit.url}/statuses?api-version=5.1&latestOnly=true`)).value;

    let buildStatus;
    let opacity;
    if (builds.length === 0) {
      buildStatus = '';
      opacity = 0.3;
    } else if (builds.every(b => b.state === 'succeeded' || b.description.includes('partially succeeded'))) {
      buildStatus = '✔️';
      opacity = 1.0;
    } else if (builds.some(b => b.state === 'pending')) {
      buildStatus = '▶️';
      opacity = 1.0;
    } else {
      buildStatus = '❌';
      opacity = 1.0;
    }

    const buildDescriptions = _.map(builds, 'description').join('\n');
    const buildStatusIcon = $('<span style="cursor: help; margin: 2px">').append(buildStatus).attr('title', buildDescriptions);
    annotatePullRequestRow(row, $('<span><span aria-hidden="true" class="contributed-icon flex-noshrink fabric-icon ms-Icon--Build"></span>&nbsp;</span>').append(buildStatusIcon).css('opacity', opacity));
  }

  function assignSortOrderToPullRequest(pullRequestRow, sortingTimestampAscending) {
    // Order the reviews by when the current user was added (reviews that the user was added to most recently are listed last). We do this by ordering the rows inside a reversed-order flex container.
    // The order property is a 32-bit integer. If treat it as number of seconds, that allows a range of 68 years (2147483647 / (60 * 60 * 24 * 365)) in the positive values alone.
    // Dates values are number of milliseconds since 1970, so we wouldn't overflow until 2038. Still, we might as well subtract a more recent reference date, i.e. 2019.
    const secondsSince2019 = Math.trunc((Date.parse(sortingTimestampAscending) - Date.parse('2019-01-01')) / 1000);
    pullRequestRow.css('order', secondsSince2019);
  }

  function movePullRequestIntoSection(pullRequestRow, section) {
    section.find('.review-subsection-counter').text((i, value) => +value + 1);
    section.children('div.flex-container').append(pullRequestRow);
    section.show();
  }

  function annotatePullRequestRow(pullRequestRow, element) {
    if ($('.prlist').length > 0) {
      // Add the file count on the overall PR dashboard.
      pullRequestRow.find('div.vss-DetailsList--titleCellTwoLine').parent()
        .append($('<div style="margin: 0px 10px; width: 3.5em; text-align: left;" />').append(element));
    } else {
      // Add the file count on a repo's PR dashboard.
      pullRequestRow.find('div.vc-pullrequest-entry-col-secondary')
        .after($('<div style="margin: 10px; width: 3.5em; display: flex; align-items: center; text-align: right;" />').append(element));
    }
  }

  function getReviewerAddedOrResetTimestamp(prThreadsNewestFirst, reviewerUniqueName) {
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

  function prHadNotableActivitySinceCurrentUserVoted(prThreadsNewestFirst, newNonApprovingVoteLimit, newThreadCommentCountLimit, newThreadWordCountLimit) {
    let newNonApprovedVotes = 0;
    for (const thread of prThreadsNewestFirst) {
      // See if this thread represents a non-approved vote.
      if (thread.properties && Object.prototype.hasOwnProperty.call(thread.properties, 'CodeReviewThreadType')) {
        if (thread.properties.CodeReviewThreadType.$value === 'VoteUpdate') {
          // Stop looking at threads once we find the thread that represents our vote.
          const votingUser = thread.identities[thread.properties.CodeReviewVotedByIdentity.$value];
          if (votingUser.uniqueName === currentUser.uniqueName) {
            break;
          }

          if (thread.properties.CodeReviewVoteResult.$value < 0) {
            newNonApprovedVotes += 1;
            if (newNonApprovedVotes >= newNonApprovingVoteLimit) {
              return true;
            }
          }
        }
      }

      // Count the number of comments and words in the thread.
      let wordCount = 0;
      let commentCount = 0;
      for (const comment of thread.comments) {
        if (comment.commentType !== 'system' && !comment.isDeleted && comment.content) {
          commentCount += 1;
          wordCount += comment.content.trim().split(/\s+/).length;
        }
      }

      if (commentCount >= newThreadCommentCountLimit || wordCount >= newThreadWordCountLimit) {
        return true;
      }
    }

    return false;
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

  let currentPullRequest = null;

  // Helper function to get the url of the PR that's currently on screen.
  async function getCurrentPullRequestUrlAsync() {
    if (!currentPullRequest || currentPullRequest.pullRequestId !== getCurrentPullRequestId()) {
      currentPullRequest = await getPullRequestAsync();
    }
    return currentPullRequest.url;
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
        const owner = reviewProperties.reviewerIdentities[file.Owner - 1] || {};
        const alternate = reviewProperties.reviewerIdentities[file.Alternate - 1] || {}; // handle nulls everywhere
        const reviewers = file.Reviewers.map(r => reviewProperties.reviewerIdentities[r - 1]) || [];

        // Pick the highest role for the current user on this file, and track it.
        if (owner.email === currentUser.uniqueName) {
          ownersInfo.currentUserFilesToRole[file.Path] = 'O';
          ownersInfo.currentUserFileCount += 1;
        } else if (alternate.email === currentUser.uniqueName) {
          ownersInfo.currentUserFilesToRole[file.Path] = 'A';
          ownersInfo.currentUserFileCount += 1;
        } else if (_(reviewers).some(r => r.email === currentUser.uniqueName)) {
          ownersInfo.currentUserFilesToRole[file.Path] = 'R';
          ownersInfo.currentUserFileCount += 1;
        }
      }
    }

    return ownersInfo;
  }
}());
