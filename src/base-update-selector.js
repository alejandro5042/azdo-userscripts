/* eslint-disable import/prefer-default-export */
import * as utils from './utils';

// If we're on specific PR, add a base update selector.
export function addBaseUpdateSelector() {
  $('.vc-iteration-selector').once('add-base-selector').each(async function () {
    const toolbar = $(this);

    utils.addStyleOnce('base-selector-css', /* css */ `
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
    const pr = await utils.getPullRequest();
    const iterations = (await $.get(`${pr.url}/iterations?api-version=5.0`)).value;

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
    selector.children('option').each(function () {
      $(this).text((i, text) => text.replace(/ /g, '\xa0'));
    });

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
