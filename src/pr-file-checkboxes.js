/* eslint-disable import/prefer-default-export */
import * as utils from './utils';

// The func we'll call to continuously add checkboxes to the PR file listing, once initialization is over.
let addCheckboxesToNewFilesFunc = () => {};

// If we're on specific PR, add checkboxes to the file listing.
export function addCheckboxesToFiles() {
  $('.vc-sparse-files-tree').once('add-checkbox-support').each(async function () {
    addCheckboxesToNewFilesFunc = () => {};

    const filesTree = $(this);

    utils.addStyleOnce('pr-file-checbox-support-css', /* css */ `
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
    }`);

    // Get the current iteration of the PR.
    const pr = await utils.getPullRequest();
    const currentPullRequestIteration = (await $.get(`${pr.url}/iterations?api-version=5.0`)).count;

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
    const ownersInfo = await utils.getNationalInstrumentsPullRequestOwnersInfo(pr.url);

    // If we have owners info, add a button to filter out diffs that we don't need to review.
    if (ownersInfo && ownersInfo.currentUserFileCount > 0) {
      $('.changed-files-summary-toolbar').once('add-other-files-button').each(function () {
        $(this)
          .find('ul')
          .prepend('<li class="menu-item" role="button"><a href="#">Toggle other files</a></li>')
          .click((event) => {
            $('.files-container').toggleClass('hide-files-not-to-review');
          });
      });
    }

    addCheckboxesToNewFilesFunc = function () {
      // If we have owners info, tag the diffs that we don't need to review.
      if (ownersInfo && ownersInfo.currentUserFileCount > 0) {
        $('.file-container .file-path').once('filter-files-to-review').each(function () {
          const filePathElement = $(this);
          const path = filePathElement.text().replace(/\//, '');
          filePathElement.closest('.file-container').toggleClass('file-to-review-diff', ownersInfo.isCurrentUserResponsibleForFile(path));
        });
      }
      $('.vc-sparse-files-tree .vc-tree-cell').once('add-complete-checkbox').each(function () {
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

        // If we have owners info, highlight the files we need to review and add role info.
        if (ownersInfo && ownersInfo.currentUserFileCount > 0) {
          const path = name.replace(/\s\[.*?\]$/i, '').replace(/^\//, '');
          if (ownersInfo.isCurrentUserResponsibleForFile(path)) {
            fileRow.addClass('file-to-review-row');
            $('<div class="file-owners-role" />').text(`${ownersInfo.currentUserFilesToRole[path]}:`).prependTo(fileRow);
          }
        }
      });
    };
  });

  addCheckboxesToNewFilesFunc();
}
