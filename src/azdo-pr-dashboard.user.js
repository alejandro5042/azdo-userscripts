// ==UserScript==

// @name         AzDO PR dashboard improvements
// @version      2.11.0
// @author       National Instruments
// @description  Adds sorting and categorization to the PR dashboard.
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
// @require      https://cdn.jsdelivr.net/npm/lodash@4.17.11/lodash.min.js#sha256-7/yoZS3548fXSRXqc/xYzjsmuW3sFKzuvOCHd06Pmps=

// ==/UserScript==

// Set a namespace for our local storage items.
lscache.setBucket("acb-azdo-pr-dashboard/");

// Update if we notice new elements being inserted into the DOM. This happens when AzDO loads the PR dashboard. Debounce new elements by a short time, in case they are being added in a batch.
document.addEventListener('DOMNodeInserted', _.throttle(onPageDOMNodeInserted, 400));

function onPageDOMNodeInserted(event) {
    // If we're on a pull request page, attempt to sort it.
    if (/\/(_pulls|pullrequests)/i.test(window.location.pathname)) {
        sortPullRequestDashboard();
    }
}

// The func we'll call to continuously sort new PRs into categories.
let sortEachPullRequestFunc = () => {};

function sortPullRequestDashboard() {
    // Find the reviews section for this user. Note the two selectors: 1) a repo dashboard; 2) the overall dashboard (e.g. https://dev.azure.com/*/_pulls).
    $("[aria-label='Assigned to me'][role='region'], .ms-GroupedList-group:has([aria-label='Assigned to me'])").once('reviews-sorted').each(function() {
        const personalReviewSection = $(this);

        addStyleOnce("reviews-list-css", `
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
        personalReviewSection.append("<details class='reviews-list reviews-incomplete-blocked'><summary>Incomplete but blocked (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append("<details class='reviews-list reviews-drafts'><summary>Drafts (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append("<details class='reviews-list reviews-waiting'><summary>Completed as Waiting on Author (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append("<details class='reviews-list reviews-rejected'><summary>Completed as Rejected (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append(`<details class='reviews-list reviews-approved-notable'><summary>Completed as Approved / Approved with Suggestions (<abbr title="${notableUpdateDescription}">with notable activity</abbr>) (<span class='review-subsection-counter'>0</span>)</summary></details>`);
        personalReviewSection.append("<details class='reviews-list reviews-approved'><summary>Completed as Approved / Approved with Suggestions (<span class='review-subsection-counter'>0</span>)</summary></details>");

        // Load the subsection open/closed setting if it exists and setup a change handler to save the setting.
        personalReviewSection.children("details")
            .each(function() {
                if (lscache.get(`pr-section-open/${$(this).attr('class')}`)) {
                    $(this).attr('open', 'open');
                }
            })
            .on("toggle", function(event) {
                lscache.set(`pr-section-open/${$(this).attr('class')}`, $(this).attr('open') == 'open');
            });

        // Find the user's name.
        const pageDataProviders = JSON.parse(document.getElementById('dataProviders').innerHTML);
        const user = pageDataProviders.data["ms.vss-web.page-data"].user;

        // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
        const apiUrlPrefix = `${location.origin}${pageDataProviders.data["ms.vss-tfs-web.header-action-data"].suiteHomeUrl}`;

        // Loop through the PRs that we've voted on.
        sortEachPullRequestFunc = () => $(personalReviewSection).find(`[role="listitem"]`).once("pr-sorted").each(async function () {
            const row = $(this);

            // Get the PR id.
            const pullRequestUrl = new URL(row.find("a[href*='/pullrequest/']").attr('href'), location.origin);
            const pullRequestId = pullRequestUrl.pathname.substring(pullRequestUrl.pathname.lastIndexOf('/') + 1);
            console.debug(`Sorting PR: ${pullRequestId}`);

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
                for (let reviewer of pullRequestInfo.reviewers) {
                    if (reviewer.uniqueName == user.uniqueName) {
                        userVote = reviewer.vote;
                    }
                    if (reviewer.vote == 0) {
                        missingVotes++;
                    } else if (reviewer.vote < 0) {
                        waitingOrRejectedVotes++;
                    }
                }

                // See what section this PR should be filed under and style the row, if necessary.
                let subsection;
                let computeSize = false;

                if (pullRequestInfo.isDraft) {
                    subsection = '.reviews-drafts';
                    computeSize = true;
                } else if (userVote == -5) {
                    subsection = '.reviews-waiting';
                } else if (userVote < 0) {
                    subsection = '.reviews-rejected';
                } else if (userVote > 0) {
                    subsection = '.reviews-approved';

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
                        if (thread.properties.hasOwnProperty("CodeReviewThreadType")) {
                            if (thread.properties.CodeReviewThreadType["$value"] == "VoteUpdate") {
                                // Stop looking at threads once we find the thread that represents our vote.
                                const votingUser = thread.identities[thread.properties.CodeReviewVotedByIdentity["$value"]];
                                if (votingUser.uniqueName == user.uniqueName) {
                                    break;
                                }

                                if (thread.properties.CodeReviewVoteResult["$value"] < 0) {
                                    newNonApprovedVotes++;
                                }
                            }
                        }

                        // Count the number of comments and words in the thread.
                        let wordCount = 0;
                        let commentCount = 0;
                        for (const comment of thread.comments) {
                            if (comment.commentType != 'system' && !comment.isDeleted && comment.content) {
                                commentCount++;
                                wordCount += comment.content.trim().split(/\s+/).length;
                            }
                        }

                        if (commentCount >= commentsToCountAsNotableThread) {
                            threadsWithLotsOfComments++;
                        }
                        if (wordCount >= wordsToCountAsNotableThread) {
                            threadsWithWordyComments++;
                        }
                    }

                    // See if we've tripped any of attributes that would make this PR notable.
                    if (threadsWithLotsOfComments > 0 || threadsWithWordyComments > 0 || newNonApprovedVotes >= peopleToNotApproveToCountAsNotableThread) {
                        subsection = '.reviews-approved-notable';
                    }
                } else {
                    computeSize = true;
                    if (waitingOrRejectedVotes > 0) {
                        subsection = '.reviews-incomplete-blocked';
                    } else if (missingVotes == 1) {
                        row.addClass("blocking-review")
                    }
                }

                // If we identified a section, move the row.
                if (subsection) {
                    const completedSection = personalReviewSection.children(subsection);
                    completedSection.find('.review-subsection-counter').text((i, value) => +value + 1);
                    completedSection.css('display', 'block');
                    completedSection.append(row);
                }

                // Compute the size of certain PRs; e.g. those we haven't reviewed yet. But first, sure we've created a merge commit that we can compute its size.
                if (computeSize && pullRequestInfo.lastMergeCommit) {
                    let fileCount = 0;

                    // First, try to find NI.ReviewProperties, which contains reviewer info specific to National Instrument workflows (where this script is used the most).
                    const prProperties = await $.get(`${pullRequestInfo.url}/properties?api-version=5.1-preview.1`);
                    let reviewProperties = prProperties.value["NI.ReviewProperties"];
                    if (reviewProperties) {
                        reviewProperties = JSON.parse(reviewProperties.$value);

                        // Count the number of files we are in the reviewers list.
                        if (reviewProperties.version <= 3 && reviewProperties.fileProperties) {
                            for (const file of reviewProperties.fileProperties) {
                                fileCount += _([file.Owner, file.Alternate, file.Reviewers].flat()).some(reviewer => reviewer.includes(user.uniqueName)) ? 1 : 0;
                            }
                        }
                    }

                    // If there is no NI.ReviewProperties or if it returns zero files to review (since we may not be on the review explicitly), then count the number of files in the merge commit.
                    if (fileCount == 0) {
                        const mergeCommitInfo = await $.get(`${pullRequestInfo.lastMergeCommit.url}/changes?api-version=5.0`);
                        fileCount = _(mergeCommitInfo.changes).filter(item => !item.item.isFolder).size();
                    }

                    const fileCountContent = `<span class="contributed-icon flex-noshrink fabric-icon ms-Icon--FileCode"></span>&nbsp;${fileCount}`;

                    // For the overall PR dashboard.
                    row.find('div.vss-DetailsList--titleCellTwoLine').parent().append(`<div style='margin: 0px 15px; width: 3em; text-align: left;'>${fileCountContent}</div>`);

                    // For a repo's PR dashboard.
                    row.find('div.vc-pullrequest-entry-col-secondary').after(`<div style='margin: 15px; width: 3.5em; display: flex; align-items: center; text-align: right;'>${fileCountContent}</div>`);
                }
            } finally {
                row.show(150);
            }
        });
    });

    sortEachPullRequestFunc();
}

// Helper function to avoid adding CSS twice into a document.
function addStyleOnce(id, style) {
    if ($(`head #${id}`).length == 0) {
        $(document.head).append(`<style id="${id}" type="text/css">${style}</style>`);
    }
}
