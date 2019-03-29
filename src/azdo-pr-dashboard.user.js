// ==UserScript==

// @name         AzDO custom improvements
// @version      2.1.0
// @author       National Instruments
// @description  Adds filtering capabilities to the dashboard.

// @namespace    https://ni.com
// @homepageURL  https://github.com/alejandro5042/azdo-userscripts

// @include      https://dev.azure.com/*
// @include      https://*.visualstudio.com/*

// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.3.1/jquery.min.js#sha256-FgpCb/KJQlLNfOu91ta32o/NMZxltwRo8QtmkMRdAu8=
// @require      https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.9.1/underscore-min.js#sha256-G7A4JrJjJlFqP0yamznwPjAApIKPkadeHfyIwiaa9e0=

// ==/UserScript==

// Update if we notice new elements being inserted into the DOM. This happens when AzDO loads the PR dashboard. Debounce new elements by a short time, in case they are being added in a batch.
$(document).bind('DOMNodeInserted', _.debounce(() => {
    // If we're on a pull request page, attempt to sort it.
    if(/\/(_pulls|pullrequests)/i.test(window.location.pathname)) {
        sortPullRequestDashboard();
    }
}, 1000));

function sortPullRequestDashboard() {
    // Find the reviews section for this user.
    var myReviews = $("[aria-label='Assigned to me'][role='region']");
    if (myReviews.length == 0) {
         // We're on the overall dashboard (e.g. https://dev.azure.com/*/_pulls) which has a different HTML layout...
         myReviews = $("[aria-label='Assigned to me']").parent();
    }
    if (myReviews.length == 0) {
        // We are not on a page that has a PR dashboard.
        console.log("No PR dashboard found at: " + window.location);
        return;
    }

    // Don't update if we see evidence of us having run.
    if (myReviews.attr('data-reviews-sorted') == 'true') {
        return;
    }
    myReviews.attr('data-reviews-sorted', 'true');

    // Sort the reviews in reverse; aka. show oldest reviews first then newer reviews.
    myReviews.append(myReviews.find("[role='listitem']").get().reverse());

    // Create review sections with counters.
    myReviews.append("<details class='reviews-incomplete-blocked' style='display: none; margin: 10px 30px' open><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Incomplete but blocked (<span class='review-subsection-counter'>0</span>)</summary></details>");
    myReviews.append("<details class='reviews-waiting' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Completed as Waiting on Author (<span class='review-subsection-counter'>0</span>)</summary></details>");
    myReviews.append("<details class='reviews-rejected' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Completed as Rejected (<span class='review-subsection-counter'>0</span>)</summary></details>");
    myReviews.append("<details class='reviews-approved' style='display: none; margin: 10px 30px'><summary style='padding: 10px; cursor: pointer; color: var(--text-secondary-color)'>Completed as Approved / Approved with Suggestions (<span class='review-subsection-counter'>0</span>)</summary></details>");

    // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
    var apiUrlPrefix;
    if (window.location.hostname == 'dev.azure.com') {
        apiUrlPrefix = `https://${window.location.hostname}${window.location.pathname.match(/^\/.*?\//ig)[0]}`;
    } else {
        apiUrlPrefix = `https://${window.location.hostname}`;
    }

    // Find the user's name.
    var me = $(".vss-Persona").attr("aria-label");

    // Loop through the PRs that we've voted on.
    $(myReviews).find(`.vote-overlay[aria-label^="${me}"], .reviewer-image-with-vote-wrapper[aria-label^="${me}"]`).each((index, avatar) => {
        var row = $(avatar).closest("[role='listitem']");
        if (row.length == 0) {
            return;
        }

        // Move your avatar to the end of the row.
        $(avatar).closest('.ms-TooltipHost').each((index, item) => {
            var avatarContainer = $(item);
            avatarContainer.css('padding', '0px 15px 0px 25px');
            avatarContainer.appendTo(avatarContainer.parent());
        });

        // Get the PR id.
        var pullRequestUrl = row.find("a[href*='/pullrequest/']").attr('href');
        if (pullRequestUrl == undefined) {
            return;
        }
        var pullRequestId = pullRequestUrl.substring(pullRequestUrl.lastIndexOf('/') + 1);

        // Get complete information about the PR.
        // See: https://docs.microsoft.com/en-us/rest/api/azure/devops/git/pull%20requests/get%20pull%20request%20by%20id?view=azure-devops-rest-5.0
        $.ajax({
            url: `${apiUrlPrefix}/_apis/git/pullrequests/${pullRequestId}?api-version=5.0`,
            type: 'GET',
            cache: false,
            success: (pullRequestInfo) => {
                // AzDO has returned with info on this PR.

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

                // See what section this PR should be filed under and style the row, if necessary.
                var subsection = "";
                if (myVote == -5) {
                    subsection = '.reviews-waiting';
                } else if (myVote < 0) {
                    subsection = '.reviews-rejected';
                } else if (myVote > 0) {
                    subsection = '.reviews-approved';
                } else {
                    if (waitingOrRejectedVotes > 0) {
                        subsection = '.reviews-incomplete-blocked';
                    } else if (missingVotes == 1) {
                        row.css('background', 'rgba(256, 0, 0, 0.3)');
                    }
                }

                // If we identified a section, move the row.
                if (subsection) {
                    var completedSection = myReviews.children(subsection);
                    completedSection.find('.review-subsection-counter').text(function(i, value) { return +value + 1 });
                    completedSection.find('.review-subsection-counter').removeClass('empty');
                    completedSection.css('display', 'block');
                    completedSection.append(row);
                }
            },
            error: (jqXHR, exception) => {
                console.log(`Error at PR ${pullRequestId}: ${jqXHR.responseText}`);
            }
        });
    });

    // Super poor man's analytics. We will load the National Instruments favicon via a URL redirector and we can track how many "clicks" it had per day. The opacity is set to 0.05 in case a browser decides not to load the image if its not visible.
    // Note: I wanted to use Google Analytics or Azure Application Insights, but because of CORS, I cannot simply add analytics to this userscript or to anything I may inject into the page.
    $('<img>').attr('src', 'https://rebrand.ly/48e3d').css('opacity', 0.05).appendTo('body');
}
