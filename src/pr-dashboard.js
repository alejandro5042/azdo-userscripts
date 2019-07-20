/* eslint-disable import/prefer-default-export */
import * as utils from './utils';

// The func we'll call to continuously sort new PRs into categories, once initialization is over.
let sortEachPullRequestFunc = () => {};

// If we're on a pull request page, attempt to sort it.
export function sortPullRequestDashboard() {
  // Find the reviews section for this user. Note the two selectors: 1) a repo dashboard; 2) the overall dashboard (e.g. https://dev.azure.com/*/_pulls).
  $("[aria-label='Assigned to me'][role='region'], .ms-GroupedList-group:has([aria-label='Assigned to me'])").once('reviews-sorted').each(function () {
    sortEachPullRequestFunc = () => {};

    const personalReviewSection = $(this);

    utils.addStyleOnce('reviews-list-css', /* css */ `
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

    // Disable the expanding button if we are on the overall PR dashboard. If enabled and the user hides/shows this section, it causes the AzDO page to re-add all the PRs, leading to duplicates in the sorted list.
    personalReviewSection.find('button.ms-GroupHeader-expand').prop('disabled', true).attr('title', 'AzDO Pull Request Improvements userscript disabled this button.');

    // Define what it means to be a notable PR after you have approved it.
    const peopleToNotApproveToCountAsNotableThread = 2;
    const commentsToCountAsNotableThread = 4;
    const wordsToCountAsNotableThread = 300;
    const notableUpdateDescription = `These are pull requests you've already approved, but since then, any of following events have happened:&#013    1) At least ${peopleToNotApproveToCountAsNotableThread} people voted Rejected or Waiting on Author&#013    2) A thread was posted with at least ${commentsToCountAsNotableThread} comments&#013    3) A thread was posted with at least ${wordsToCountAsNotableThread} words&#013Optional: To remove PRs from this list, simply vote again on the PR (even if it's the same vote).`;

    // Create review sections with counters.
    const sections = {
      blocking: $("<details class='reviews-list reviews-pending'><summary style='color: var(--status-error-foreground); font-weight: bold'>Blocking</summary></details>"),

      pending: $("<details class='reviews-list reviews-pending'><summary>Incomplete</summary></details>"),

      blocked: $("<details class='reviews-list reviews-incomplete-blocked'><summary>Incomplete but blocked</summary></details>"),

      approvedButNotable: $(`<details class='reviews-list reviews-approved-notable'><summary>Completed as Approved / Approved with Suggestions (<abbr title="${notableUpdateDescription}">with notable activity</abbr>)</summary></details>`),

      drafts: $("<details class='reviews-list reviews-drafts'><summary>Drafts</summary></details>"),

      waiting: $("<details class='reviews-list reviews-waiting'><summary>Completed as Waiting on Author</summary></details>"),

      rejected: $("<details class='reviews-list reviews-rejected'><summary>Completed as Rejected</summary></details>"),

      approved: $("<details class='reviews-list reviews-approved'><summary>Completed as Approved / Approved with Suggestions</summary></details>"),
    };

    // Load the subsection open/closed setting if it exists and setup a change handler to save the setting. We also add common elements to each sections.
    for (const section of Object.values(sections)) {
      const id = `pr-section-open/${section.attr('class')}`;
      section.children('summary').append(" (<span class='review-subsection-counter'>0</span>)");
      section.append("<div class='flex-container' />");
      section.prop('open', lscache.get(id));
      section.on('toggle', function () {
        lscache.set(id, $(this).prop('open'));
      });
      section.appendTo(personalReviewSection);
    }

    // Loop through the PRs that we've voted on.
    sortEachPullRequestFunc = () => $(personalReviewSection).find('[role="list"] [role="listitem"]').once('pr-sorted').each(async function () {
      const row = $(this);

      // Loop until AzDO has added the link to the PR into the row.
      let pullRequestHref;
      while (!pullRequestHref) {
        // Important! Do not remove this sleep, even on the first iteration. We need to give AzDO some time to finish making the row before moving it. If we don't sleep for some time, and we begin moving rows, AzDO may get confused and not create all the PR rows. That would cause some PRs to not be rendered in the list. The best solution is to wait until the list finishes to render via an event handler; except that I don't know how to hook into that without understanding AzDO JS infrastructure. The sleep time was chosen to balance first load time (don't wait too long before sorting) and what appears to be long enough to avoid the missing PR problem when sorting a 50+ PR dashboard, as determined by experimentation (refreshing the page a dozen or so times).
        // eslint-disable-next-line no-await-in-loop
        await utils.sleep(300);
        pullRequestHref = row.find("a[href*='/pullrequest/']").attr('href');
      }

      try {
        // Hide the row while we are updating it.
        row.hide(150);

        // Sort the reviews in reverse; aka. show oldest reviews first then newer reviews. We do this by ordering the rows inside a reversed-order flex container.
        row.css('order', row.attr('data-list-index'));

        // Get the PR id.
        const pullRequestUrl = new URL(pullRequestHref, window.location.origin);
        const pullRequestId = parseInt(pullRequestUrl.pathname.substring(pullRequestUrl.pathname.lastIndexOf('/') + 1), 10);

        // Get complete information about the PR.
        const pr = await utils.getPullRequest(pullRequestId);

        let missingVotes = 0;
        let waitingOrRejectedVotes = 0;
        let userVote = 0;

        // Count the number of votes.
        for (const reviewer of pr.reviewers) {
          if (reviewer.uniqueName === utils.currentUser.uniqueName) {
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

        if (pr.isDraft) {
          section = sections.drafts;
          computeSize = true;
        } else if (userVote === -5) {
          section = sections.waiting;
        } else if (userVote < 0) {
          section = sections.rejected;
        } else if (userVote > 0) {
          section = sections.approved;

          // If the user approved the PR, see if we need to resurface it as a notable PR.
          const pullRequestThreads = await $.get(`${pr.url}/threads?api-version=5.0`);

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
                if (votingUser.uniqueName === utils.currentUser.uniqueName) {
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
            section = sections.blocking;
          } else {
            section = sections.pending;
          }
        }

        // Compute the size of certain PRs; e.g. those we haven't reviewed yet. But first, sure we've created a merge commit that we can compute its size.
        if (computeSize && pr.lastMergeCommit) {
          let fileCount = 0;

          // See if this PR has owners info and count the files listed for the current user.
          const ownersInfo = await utils.getNationalInstrumentsPullRequestOwnersInfo(pr.url);
          if (ownersInfo) {
            fileCount = ownersInfo.currentUserFileCount;
          }

          // If there is no owner info or if it returns zero files to review (since we may not be on the review explicitly), then count the number of files in the merge commit.
          if (fileCount === 0) {
            const mergeCommitInfo = await $.get(`${pr.lastMergeCommit.url}/changes?api-version=5.0`);
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

        // If we identified a section, move the row.
        if (section) {
          section.find('.review-subsection-counter').text((i, value) => +value + 1);
          section.children('div.flex-container').append(row);
          section.show();
        }
      } finally {
        // No matter what--e.g. even on error--show the row again.
        row.show(150);
      }
    });
  });

  sortEachPullRequestFunc();
}
