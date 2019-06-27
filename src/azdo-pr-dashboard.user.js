// ==UserScript==

// @name         AzDO Pull Request Improvements
// @version      2.16.0
// @author       National Instruments
// @description  Adds sorting and categorization to the PR dashboard. Also adds minor improvements to the PR diff experience, such as a base update selector and per-file checkboxes.
// @license      MIT

// @namespace    https://ni.com
// @homepageURL  https://github.com/alejandro5042/azdo-userscripts
// @supportURL   https://github.com/alejandro5042/azdo-userscripts
// @updateURL    https://rebrand.ly/update-azdo-pr-dashboard-user-js

// @contributionURL  https://github.com/alejandro5042/azdo-userscripts

// @include      https://dev.azure.com/*
// @include      https://*.visualstudio.com/*

// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.3.1/jquery.min.js#sha256-FgpCb/KJQlLNfOu91ta32o/NMZxltwRo8QtmkMRdAu8=
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery-once/2.2.3/jquery.once.min.js#sha256-HaeXVMzafCQfVtWoLtN3wzhLWNs8cY2cH9OIQ8R9jfM=
// @require      https://cdnjs.cloudflare.com/ajax/libs/lscache/1.3.0/lscache.js#sha256-QVvX22TtfzD4pclw/4yxR0G1/db2GZMYG9+gxRM9v30=
// @require      https://cdnjs.cloudflare.com/ajax/libs/date-fns/1.30.1/date_fns.min.js#sha256-wCBClaCr6pJ7sGU5kfb3gQMOOcIZNzaWpWcj/lD9Vfk=
// @require      https://cdn.jsdelivr.net/npm/lodash@4.17.11/lodash.min.js#sha256-7/yoZS3548fXSRXqc/xYzjsmuW3sFKzuvOCHd06Pmps=

// ==/UserScript==

(function () {
  'use strict';

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
    } else if (/\/(_pulls|pullrequests)/i.test(window.location.pathname)) {
      sortPullRequestDashboard();
    }
  }

  // The func we'll call to continuously add checkboxes to the PR file listing, once initialization is over.
  let addCheckboxesToNewFilesFunc = () => { };

  // If we're on specific PR, add checkboxes to the file listing.
  function addCheckboxesToFiles() {
    $('.vc-sparse-files-tree').once('add-checkbox-support').each(async function () {
      addCheckboxesToNewFilesFunc = () => { };

      const filesTree = $(this);

      addStyleOnce('pr-file-checbox-support-css', `
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
        }`);

      // Get the current iteration of the PR.
      const iterations = await getPullRequestIterations();
      const currentPullRequestIteration = iterations.length;

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

      addCheckboxesToNewFilesFunc = () => $('.vc-sparse-files-tree .vc-tree-cell').once('add-complete-checkbox').each(function () {
        const fileCell = $(this);
        const fileRow = fileCell.closest('.tree-row');
        const typeIcon = fileRow.find('.type-icon');

        // Don't put checkboxes on rows that don't represent files.
        if (!/bowtie-file\b/i.test(typeIcon.attr('class'))) {
          return;
        }

        const name = fileCell.attr('content'); // The 'content' attribute contains the file operation; e.g. "/src/file.cs [edit]".
        const iteration = filesToIterationReviewed[name] || 0;

        // Create the checkbox before the type icon.
        $('<button class="file-complete-checkbox" />')
          .attr('name', name)
          .toggleClass('checked', iteration > 0)
          .insertBefore(typeIcon);
      });
    });

    addCheckboxesToNewFilesFunc();
  }

  // If we're on specific PR, add a base update selector.
  function addBaseUpdateSelector() {
    $('.vc-iteration-selector').once('add-base-selector').each(async function () {
      const toolbar = $(this);

      addStyleOnce('base-selector-css', `
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

      const iterations = await getPullRequestIterations();

      // Create a dropdown with the first option being the icon we show to users. We use an HTML dropdown since its much easier to code than writing our own with divs/etc or trying to figure out how to use an AzDO dropdown.
      const selector = $('<select><option value="" disabled selected>↦</option></select>');

      // Add an option for each iteration in the dropdown, looking roughly the same as the AzDO update selector.
      for (const iteration of iterations.reverse()) {
        const date = Date.parse(iteration.createdDate);
        const truncatedDescription = iteration.description.length > 60 ? `${iteration.description.substring(0, 58)}...` : iteration.description;
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
        currentUrl.searchParams.set('base', $(this).val());
        currentUrl.searchParams.set('iteration', currentUrl.searchParams.get('iteration') || iterations.length); // If we select a base without having an explicit iteration, compare the base to the latest.
        window.location.href = currentUrl.toString();
      });
    });
  }

  // The func we'll call to continuously sort new PRs into categories, once initialization is over.
  let sortEachPullRequestFunc = () => { };

  // If we're on a pull request page, attempt to sort it.
  function sortPullRequestDashboard() {
    // Find the reviews section for this user. Note the two selectors: 1) a repo dashboard; 2) the overall dashboard (e.g. https://dev.azure.com/*/_pulls).
    $("[aria-label='Assigned to me'][role='region'], .ms-GroupedList-group:has([aria-label='Assigned to me'])").once('reviews-sorted').each(async function () {
      sortEachPullRequestFunc = () => { };

      const personalReviewSection = $(this);

      addStyleOnce('reviews-list-css', `
        details.reviews-list {
          margin: 10px 30px;
          display: none;
        }
        details.reviews-list summary {
          padding: 10px;
          cursor: pointer;
          color: var(--text-secondary-color);
        }
        .blocking-review {
          background: rgba(256, 0, 0, 0.25);
        }
        .blocking-review:hover {
          background: rgba(256, 0, 0, 0.35) !important;
        }`);

      // Sort the reviews in reverse; aka. show oldest reviews first then newer reviews.
      personalReviewSection.append(personalReviewSection.find("[role='listitem']").get().reverse());

      // Define what it means to be a notable PR after you have approved it.
      const peopleToNotApproveToCountAsNotableThread = 2;
      const commentsToCountAsNotableThread = 4;
      const wordsToCountAsNotableThread = 300;
      const notableUpdateDescription = `These are pull requests you've already approved, but since then, any of following events have happened:&#013    1) At least ${peopleToNotApproveToCountAsNotableThread} people voted Rejected or Waiting on Author&#013    2) A thread was posted with at least ${commentsToCountAsNotableThread} comments&#013    3) A thread was posted with at least ${wordsToCountAsNotableThread} words&#013Optional: To remove PRs from this list, simply vote again on the PR (even if it's the same vote).`;

      // Create review sections with counters.
      const sections = {
        blocked:
          $("<details class='reviews-list reviews-incomplete-blocked'><summary>Incomplete but blocked (<span class='review-subsection-counter'>0</span>)</summary></details>"),

        approvedButNotable:
          $(`<details class='reviews-list reviews-approved-notable'><summary>Completed as Approved / Approved with Suggestions (<abbr title="${notableUpdateDescription}">with notable activity</abbr>) (<span class='review-subsection-counter'>0</span>)</summary></details>`),

        drafts:
          $("<details class='reviews-list reviews-drafts'><summary>Drafts (<span class='review-subsection-counter'>0</span>)</summary></details>"),

        waiting:
          $("<details class='reviews-list reviews-waiting'><summary>Completed as Waiting on Author (<span class='review-subsection-counter'>0</span>)</summary></details>"),

        rejected:
          $("<details class='reviews-list reviews-rejected'><summary>Completed as Rejected (<span class='review-subsection-counter'>0</span>)</summary></details>"),

        approved:
          $("<details class='reviews-list reviews-approved'><summary>Completed as Approved / Approved with Suggestions (<span class='review-subsection-counter'>0</span>)</summary></details>"),
      };

      // Load the subsection open/closed setting if it exists and setup a change handler to save the setting.
      for (const section of Object.values(sections)) {
        const id = `pr-section-open/${section.attr('class')}`;
        section.prop('open', lscache.get(id));
        section.on('toggle', function () { lscache.set(id, $(this).prop('open')); });
        section.appendTo(personalReviewSection);
      }

      // Find the user's name.
      const pageData = await getPageData(p => p['ms.vss-web.page-data'].user);
      const currentUser = pageData['ms.vss-web.page-data'].user;

      // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
      const apiUrlPrefix = `${window.location.origin}${pageData['ms.vss-tfs-web.header-action-data'].suiteHomeUrl}`;

      // Loop through the PRs that we've voted on.
      sortEachPullRequestFunc = () => $(personalReviewSection).find('[role="listitem"]').once('pr-sorted').each(async function () {
        const row = $(this);

        // Get the PR id.
        const pullRequestUrl = new URL(row.find("a[href*='/pullrequest/']").attr('href'), window.location.origin);
        const pullRequestId = pullRequestUrl.pathname.substring(pullRequestUrl.pathname.lastIndexOf('/') + 1);

        try {
          // Hide the row while we are updating it.
          row.hide(150);

          // Get complete information about the PR.
          // See: https://docs.microsoft.com/en-us/rest/api/azure/devops/git/pull%20requests/get%20pull%20request%20by%20id?view=azure-devops-rest-5.0
          const pullRequestInfo = await $.get(`${apiUrlPrefix}/_apis/git/pullrequests/${pullRequestId}?api-version=5.0`);

          let missingVotes = 0;
          let waitingOrRejectedVotes = 0;
          let userVote = 0;

          // Count the number of votes.
          for (const reviewer of pullRequestInfo.reviewers) {
            if (reviewer.uniqueName === currentUser.uniqueName) {
              userVote = reviewer.vote;
            }
            if (reviewer.vote === 0) {
              missingVotes += 1;
            } else if (reviewer.vote < 0) {
              waitingOrRejectedVotes += 1;
            }
          }

          // See what section this PR should be filed under and style the row, if necessary.
          let section;
          let computeSize = false;

          if (pullRequestInfo.isDraft) {
            section = sections.drafts;
            computeSize = true;
          } else if (userVote === -5) {
            section = sections.waiting;
          } else if (userVote < 0) {
            section = sections.rejected;
          } else if (userVote > 0) {
            section = sections.approved;

            // If the user approved the PR, see if we need to resurface it as a notable PR.
            // See: https://docs.microsoft.com/en-us/rest/api/azure/devops/git/pull%20request%20threads/list?view=azure-devops-rest-5.0
            const pullRequestThreads = await $.get(`${pullRequestInfo.url}/threads?api-version=5.0`);

            let threadsWithLotsOfComments = 0;
            let threadsWithWordyComments = 0;
            let newNonApprovedVotes = 0;

            // Loop through the threads in reverse time order (newest first).
            for (const thread of pullRequestThreads.value.reverse()) {
              // If the thread is deleted, let's ignore it and move on to the next thread.
              if (thread.isDeleted) {
                break;
              }

              // See if this thread represents a non-approved vote.
              if (Object.prototype.hasOwnProperty.call(thread, 'CodeReviewThreadType')) {
                if (thread.properties.CodeReviewThreadType.$value === 'VoteUpdate') {
                  // Stop looking at threads once we find the thread that represents our vote.
                  const votingUser = thread.identities[thread.properties.CodeReviewVotedByIdentity.$value];
                  if (votingUser.uniqueName === currentUser.uniqueName) {
                    break;
                  }

                  if (thread.properties.CodeReviewVoteResult.$value < 0) {
                    newNonApprovedVotes += 1;
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

              if (commentCount >= commentsToCountAsNotableThread) {
                threadsWithLotsOfComments += 1;
              }
              if (wordCount >= wordsToCountAsNotableThread) {
                threadsWithWordyComments += 1;
              }
            }

            // See if we've tripped any of attributes that would make this PR notable.
            if (threadsWithLotsOfComments > 0 || threadsWithWordyComments > 0 || newNonApprovedVotes >= peopleToNotApproveToCountAsNotableThread) {
              section = sections.approvedButNotable;
            }
          } else {
            computeSize = true;
            if (waitingOrRejectedVotes > 0) {
              section = sections.blocked;
            } else if (missingVotes === 1) {
              row.addClass('blocking-review');
            }
          }

          // If we identified a section, move the row.
          if (section) {
            section.find('.review-subsection-counter').text((i, value) => +value + 1);
            section.append(row);
            section.show();
          }

          // Compute the size of certain PRs; e.g. those we haven't reviewed yet. But first, sure we've created a merge commit that we can compute its size.
          if (computeSize && pullRequestInfo.lastMergeCommit) {
            let fileCount = 0;

            // First, try to find NI.ReviewProperties, which contains reviewer info specific to National Instrument workflows (where this script is used the most).
            const prProperties = await $.get(`${pullRequestInfo.url}/properties?api-version=5.1-preview.1`);
            let reviewProperties = prProperties.value['NI.ReviewProperties'];
            if (reviewProperties) {
              reviewProperties = JSON.parse(reviewProperties.$value);

              // Count the number of files we are in the reviewers list.
              if (reviewProperties.version <= 3 && reviewProperties.fileProperties) {
                for (const file of reviewProperties.fileProperties) {
                  const allReviewers = [file.Owner, file.Alternate, file.Reviewers].flat();
                  fileCount += _(allReviewers).some(reviewer => reviewer.includes(currentUser.uniqueName)) ? 1 : 0;
                }
              }
            }

            // If there is no NI.ReviewProperties or if it returns zero files to review (since we may not be on the review explicitly), then count the number of files in the merge commit.
            if (fileCount === 0) {
              const mergeCommitInfo = await $.get(`${pullRequestInfo.lastMergeCommit.url}/changes?api-version=5.0`);
              fileCount = _(mergeCommitInfo.changes).filter(item => !item.item.isFolder).size();
            }

            const fileCountContent = `<span class="contributed-icon flex-noshrink fabric-icon ms-Icon--FileCode"></span>&nbsp;${fileCount}`;

            // Add the file count on the overall PR dashboard.
            row.find('div.vss-DetailsList--titleCellTwoLine').parent()
              .append(`<div style='margin: 0px 15px; width: 3em; text-align: left;'>${fileCountContent}</div>`);

            // Add the file count on a repo's PR dashboard.
            row.find('div.vc-pullrequest-entry-col-secondary')
              .after(`<div style='margin: 15px; width: 3.5em; display: flex; align-items: center; text-align: right;'>${fileCountContent}</div>`);
          }
        } finally {
          // No matter what--e.g. even on error--show the row again.
          row.show(150);
        }
      });
    });

    sortEachPullRequestFunc();
  }

  // Helper function to avoid adding CSS twice into a document.
  function addStyleOnce(id, style) {
    if ($(`head #${id}`).length === 0) {
      $(document.head).append(`<style id="${id}" type="text/css">${style}</style>`);
    }
  }

  // Helper function to parse the page state data provided by AzDO.
  async function getPageData(validityChecker) {
    const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

    // RE: Looping and validatyChecker stuff: TODO: This is temporary to hotfix an issue. Will refactor.
    for (let i = 0; i < 10; i += 1) {
      try {
        const pageData = JSON.parse(document.getElementById('dataProviders').innerHTML).data;
        if (validityChecker(pageData)) {
          return pageData;
        }
      } catch (e) {
        // Do nothing. Loop.
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(500);
    }

    return undefined;
  }

  // Helper function to get the PR iterations at the current page. TODO: This is temporary to hotfix an issue. Will refactor.
  async function getPullRequestIterations() {
    const pullRequestUrl = window.location;
    const pullRequestId = pullRequestUrl.pathname.substring(pullRequestUrl.pathname.lastIndexOf('/') + 1);
    const pageData = await getPageData(p => p['ms.vss-tfs-web.header-action-data']);
    const apiUrlPrefix = `${window.location.origin}${pageData['ms.vss-tfs-web.header-action-data'].suiteHomeUrl}`;
    const pullRequestInfo = await $.get(`${apiUrlPrefix}/_apis/git/pullrequests/${pullRequestId}?api-version=5.0`);
    const iterations = await $.get(`${pullRequestInfo.url}/iterations?api-version=5.0`);
    return iterations.value;
  }
}());
