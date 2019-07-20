import * as betterScrollbars from './better-scrollbars';
import * as prDashboard from './pr-dashboard';
import * as prFileCheckboxes from './pr-file-checkboxes';
import * as baseUpdateSelector from './base-update-selector';

(function () {
  'use strict';

  // All REST API calls should fail after a timeout, instead of going on forever.
  $.ajaxSetup({ timeout: 5000 });

  // Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
  // const azdoApiBaseUrl = `${window.location.origin}${pageData['ms.vss-tfs-web.header-action-data'].suiteHomeUrl}`;

  // Set a namespace for our local storage items.
  lscache.setBucket('acb-azdo/');

  // Call our event handler if we notice new elements being inserted into the DOM. This happens as the page is loading or updating dynamically based on user activity. We throttle new element events to avoid using up CPU when AzDO is adding a lot of elements during a short time (like on page load).
  document.addEventListener('DOMNodeInserted', _.throttle(onPageDOMNodeInserted, 400));

  // This is "main()" for this script. Runs periodically when the page updates.
  function onPageDOMNodeInserted(event) {
    // The page may not have refreshed when moving between URLs--sometimes AzDO acts as a single-page application. So we must always check where we are and act accordingly.
    if (/\/(pullrequest)\//i.test(window.location.pathname)) {
      prFileCheckboxes.addCheckboxesToFiles();
      baseUpdateSelector.addBaseUpdateSelector();
      betterScrollbars.makePullRequestDiffEasierToScroll();
    } else if (/\/(_pulls|pullrequests)/i.test(window.location.pathname)) {
      prDashboard.sortPullRequestDashboard();
    }
  }
}());
