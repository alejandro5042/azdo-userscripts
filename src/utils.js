// Helper function to avoid adding CSS twice into a document.
export function addStyleOnce(id, style) {
  $(document.head).once(id).each(function () {
    $('<style type="text/css" />').html(style).appendTo(this);
  });
}

// Find out who is our current user. In general, we should avoid using pageData because it doesn't always get updated when moving between page-to-page in AzDO's single-page application flow. Instead, rely on the AzDO REST APIs to get information from stuff you find on the page or the URL. Some things are OK to get from pageData; e.g. stuff like the user which is available on all pages.
const pageData = JSON.parse(document.getElementById('dataProviders').innerHTML).data;
const currentUser = pageData['ms.vss-web.page-data'].user;

// Because of CORS, we need to make sure we're querying the same hostname for our AzDO APIs.
const azdoApiBaseUrl = `${window.location.origin}${pageData['ms.vss-tfs-web.header-action-data'].suiteHomeUrl}`;

// Async helper function get info on a single PR. Defaults to the PR that's currently on screen.
export function getPullRequest(id = 0) {
  const actualId = id || window.location.pathname.substring(window.location.pathname.lastIndexOf('/') + 1);
  return $.get(`${azdoApiBaseUrl}/_apis/git/pullrequests/${actualId}?api-version=5.0`);
}

// Async helper function to sleep.
export function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Async helper function to get a specific PR property, otherwise return the default value.
export async function getPullRequestProperty(prUrl, key, defaultValue = null) {
  const properties = await $.get(`${prUrl}/properties?api-version=5.1-preview.1`);
  const property = properties.value[key];
  return property ? JSON.parse(property.$value) : defaultValue;
}

// Async helper function to return reviewer info specific to National Instruments workflows (where this script is used the most).
export async function getNationalInstrumentsPullRequestOwnersInfo(prUrl) {
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
