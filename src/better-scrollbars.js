/* eslint-disable import/prefer-default-export */
import * as utils from './utils';

export function makePullRequestDiffEasierToScroll() {
  utils.addStyleOnce('pr-diff-improvements', /* css */ `
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
