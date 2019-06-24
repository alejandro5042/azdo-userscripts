// ==UserScript==

// @name         AzDO PR dashboard improvements
// @version      2.10.0
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
        return;
    }
}

function sortPullRequestDashboard() {
    // Find the reviews section for this user. Note the two selectors: 1) a repo dashboard; 2) the overall dashboard (e.g. https://dev.azure.com/*/_pulls).
    $("[aria-label='Assigned to me'][role='region'], .ms-GroupedList-group:has([aria-label='Assigned to me'])").once('reviews-sorted').each(function() {
        let personalReviewSection = $(this);

        // Sort the reviews in reverse; aka. show oldest reviews first then newer reviews.
        personalReviewSection.append(personalReviewSection.find("[role='listitem']").get().reverse());

        // Define what it means to be a notable PR after you have approved it.
        var peopleToNotApproveToCountAsNotableThread = 2;
        var commentsToCountAsNotableThread = 4;
        var wordsToCountAsNotableThread = 300;
        var notableUpdateDescription = `These are pull requests you've already approved, but since then, any of following events have happened:&#013    1) At least ${peopleToNotApproveToCountAsNotableThread} people voted Rejected or Waiting on Author&#013    2) A thread was posted with at least ${commentsToCountAsNotableThread} comments&#013    3) A thread was posted with at least ${wordsToCountAsNotableThread} words&#013Optional: To remove PRs from this list, simply vote again on the PR (even if it's the same vote).`;

        // Create review sections with counters.
        personalReviewSection.append("<details class='reviews-incomplete-blocked' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Incomplete but blocked (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append("<details class='reviews-drafts' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Drafts (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append("<details class='reviews-waiting' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Completed as Waiting on Author (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append("<details class='reviews-rejected' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Completed as Rejected (<span class='review-subsection-counter'>0</span>)</summary></details>");
        personalReviewSection.append(`<details class='reviews-approved-notable' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Completed as Approved / Approved with Suggestions (<abbr title="${notableUpdateDescription}">with notable activity</abbr>) (<span class='review-subsection-counter'>0</span>)</summary></details>`);
        personalReviewSection.append("<details class='reviews-approved' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Completed as Approved / Approved with Suggestions (<span class='review-subsection-counter'>0</span>)</summary></details>");

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
        var pageDataProviders = JSON.parse(document.getElementById('dataProviders').innerHTML);
        var user = pageDataProviders.data["ms.vss-web.page-data"].user;
        var me = user.displayName;
        var userEmail = user.uniqueName;

        // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
        let apiUrlPrefix = `${location.origin}${pageDataProviders.data["ms.vss-tfs-web.header-action-data"].suiteHomeUrl}`;

        // Loop through the PRs that we've voted on.
        $(personalReviewSection).find(`[role="listitem"]`).each(async function () {
            var row = $(this);

            // Get the PR id.
            var pullRequestUrl = row.find("a[href*='/pullrequest/']").attr('href');
            if (pullRequestUrl == undefined) {
                return;
            }
            var pullRequestId = pullRequestUrl.substring(pullRequestUrl.lastIndexOf('/') + 1);

            // Hide the row while we are updating it.
            row.hide(150);

            try {
                // Get complete information about the PR.
                // See: https://docs.microsoft.com/en-us/rest/api/azure/devops/git/pull%20requests/get%20pull%20request%20by%20id?view=azure-devops-rest-5.0
                let pullRequestInfo = await $.get(`${apiUrlPrefix}/_apis/git/pullrequests/${pullRequestId}?api-version=5.0`);

                var missingVotes = 0;
                var waitingOrRejectedVotes = 0;
                var neededVotes = 0;
                var myVote = 0;

                // Count the number of votes.
                $.each(pullRequestInfo.reviewers, function(i, reviewer) {
                    neededVotes++;
                    if (reviewer.displayName == me) {
                        myVote = reviewer.vote;
                    }
                    if (reviewer.vote == 0) {
                        missingVotes++;
                    }
                    if (reviewer.vote < 0) {
                        waitingOrRejectedVotes++;
                    }
                });

                // Any tasks that need to complete in order to calculate the right subsection.
                var subsectionAsyncTask = null;

                // See what section this PR should be filed under and style the row, if necessary.
                var subsection = "";
                var computeSize = false;
                if (pullRequestInfo.isDraft) {
                    subsection = '.reviews-drafts';
                    computeSize = true;
                } else if (myVote == -5) {
                    subsection = '.reviews-waiting';
                } else if (myVote < 0) {
                    subsection = '.reviews-rejected';
                } else if (myVote > 0) {
                    subsection = '.reviews-approved';

                    // If the user approved the PR, see if we need to resurface it as a notable PR.
                    // See: https://docs.microsoft.com/en-us/rest/api/azure/devops/git/pull%20request%20threads/list?view=azure-devops-rest-5.0
                    let pullRequestThreads = await $.get(`${pullRequestInfo.url}/threads?api-version=5.0`);

                    let threadsWithLotsOfComments = 0;
                    let threadsWithWordyComments = 0;
                    let newNonApprovedVotes = 0;

                    // Loop through the threads in reverse time order (newest first).
                    $.each(pullRequestThreads.value.reverse(), function(i, thread) {
                        // If the thread is deleted, let's ignore it and move on to the next thread.
                        if (thread.isDeleted) {
                            return true;
                        }

                        // See if this thread represents a non-approved vote.
                        if (thread.properties.hasOwnProperty("CodeReviewThreadType")) {
                            if (thread.properties.CodeReviewThreadType["$value"] == "VoteUpdate") {
                                // Stop looking at threads once we find the thread that represents our vote.
                                var votingUser = thread.identities[thread.properties.CodeReviewVotedByIdentity["$value"]].displayName;
                                if (votingUser == me) {
                                    return false;
                                }

                                if (thread.properties.CodeReviewVoteResult["$value"] < 0) {
                                    newNonApprovedVotes++;
                                }
                            }
                        }

                        // Count the number of comments and words in the thread.

                        var wordCount = 0;
                        var commentCount = 0;

                        $.each(thread.comments, (j, comment) => {
                            if (comment.commentType != 'system' && !comment.isDeleted && comment.content) {
                                commentCount++;
                                wordCount += comment.content.trim().split(/\s+/).length;
                            }
                        });

                        if (commentCount >= commentsToCountAsNotableThread) {
                            threadsWithLotsOfComments++;
                        }
                        if (wordCount >= wordsToCountAsNotableThread) {
                            threadsWithWordyComments++;
                        }
                    });

                    // See if we've tripped any of attributes that would make this PR notable.
                    if (threadsWithLotsOfComments > 0 || threadsWithWordyComments > 0 || newNonApprovedVotes >= peopleToNotApproveToCountAsNotableThread) {
                        subsection = '.reviews-approved-notable';
                    }
                } else {
                    computeSize = true;
                    if (waitingOrRejectedVotes > 0) {
                        subsection = '.reviews-incomplete-blocked';
                    } else if (missingVotes == 1) {
                        row.css('background', 'rgba(256, 0, 0, 0.3)');
                    }
                }

                // Compute the size of certain PRs; e.g. those we haven't reviewed yet.
                if (computeSize) {
                    // Make sure we've created a merge commit that we can compute its size.
                    if (pullRequestInfo.lastMergeCommit) {
                        // Helper function to add the size to the PR row.
                        function addPullRequestFileSize(files) {
                            var content = `<span class="contributed-icon flex-noshrink fabric-icon ms-Icon--FileCode"></span>&nbsp;${files}`;

                            // For the overall PR dashboard.
                            row.find('div.vss-DetailsList--titleCellTwoLine').parent().append(`<div style='margin: 0px 15px; width: 3em; text-align: left;'>${content}</div>`);

                            // For a repo's PR dashboard.
                            row.find('div.vc-pullrequest-entry-col-secondary').after(`<div style='margin: 15px; width: 3.5em; display: flex; align-items: center; text-align: right;'>${content}</div>`);
                        }

                        // First, try to find NI.ReviewProperties, which contains reviewer info specific to National Instrument workflows (where this script is used the most).
                        let prProperties = await $.get(`${pullRequestInfo.url}/properties?api-version=5.1-preview.1`);
                        let reviewProperties = prProperties.value["NI.ReviewProperties"];
                        if (reviewProperties) {
                            reviewProperties = JSON.parse(reviewProperties.$value);

                            // Count the number of files we are in the reviewers list.
                            let filesToReview = 0;
                            if (reviewProperties.version <= 3 && reviewProperties.fileProperties) {
                                for (let file of reviewProperties.fileProperties) {
                                    for (let reviewer of file.Reviewers) {
                                        if (reviewer.includes(userEmail)) {
                                            filesToReview++;
                                        }
                                    }
                                }
                            }

                            // If there aren't any files to review, then we don't have an explicit role and we should fall through to counting all the files.
                            if (filesToReview > 0) {
                                addPullRequestFileSize(filesToReview);
                                return;
                            }
                        }

                        // If there is no NI.ReviewProperties or if it returns zero files to review, then count the number of files in the merge commit.
                        let mergeCommitInfo = await $.get(`${pullRequestInfo.lastMergeCommit.url}/changes?api-version=5.0`);
                        let fileCount = _(mergeCommitInfo.changes).filter(item => !item.item.isFolder).size();

                        addPullRequestFileSize(fileCount);
                    }
                }

                // If we identified a section, move the row.
                if (subsection) {
                    var completedSection = personalReviewSection.children(subsection);
                    completedSection.find('.review-subsection-counter').text(function(i, value) { return +value + 1 });
                    completedSection.find('.review-subsection-counter').removeClass('empty');
                    completedSection.css('display', 'block');
                    completedSection.append(row);
                }
            } catch (e) {
                console.error(`Error at PR ${pullRequestId}: ${e}`);
            } finally {
                row.show(150);
            }
        });
    });
}
