# How to contribute

## Submitting changes

Pull requests are welcomed :)

For significant effort or feature work, it is preferred to start by filing an issue to discuss your approach before you start coding.

## Hacking / debugging

- Simply open the userscript in Tampermonkey's dashboard and hack away
- Hit `Ctrl+S` to save
- Refresh the target page to test your changes

Once you're done, copy your script from the dashboard into the actual source file, either from an on-disk clone of this repo or directly on the [GitHub interface](https://help.github.com/en/github/managing-files-in-a-repository/editing-files-in-your-repository). Then propose a pull request.

## Using a local editor

- Clone this repo on-disk
- Run `npm install`
- Allow Tampermonkey to access files on disk:
  - Go to [Chrome Extension Settings](chrome://extensions/)
  - Click the "Details" button on Tampermonkey
  - Enable "Allow access to file URLs"
- From Tampermonkey, create a new userscript that uses the version on-disk:
  - Copy the real userscript into this new userscript
  - Delete all the code (everything under `// ==/UserScript==`)
  - Before the `// ==/UserScript==` line, add `// @require file:///C:/Path/To/Repo/azdo-userscripts/src/azdo-pr-dashboard.user.js`
  - Remove the `@updateURL` line
  - Reduce confusion:
    - Change the `@name` to help identify that this script is not the official version (aka. add ` (LOCAL)` to the end)
    - Change the `@version` to something like "0.1"
- Open your favorite IDE and hack away! (e.g. VS Code)

Make sure you keep the proxy userscript in-sync with changes to the real userscript metadata block (since it doesn't use metadata from any `@require` files).

## Testing before a PR

For each PR, make sure:

- Version is incremented following semantic versioning
- Runs in latest stable Chrome and Firefox without Javascript errors
- Works in both `dev.azure.com/account` and `account.visualstudio.com`
- Customizations work in both light and dark theme
- Does not report any issues in `eslint` (run `npm run build`)

## Testing pull request changes

To test the changes in a pull request:

- Disable any versions of the userscript you have enabled (via Tampermonkey)
- Install the userscript from the GitHub PR
  - Go to the `Files Changed` tab
  - Hit the `...` button on the top-right of the file
  - Hit `View file`
  - Hit `Raw` button in the page that comes up
- Test
- Delete the userscript from the PR
- Re-enable any original userscript

## Coding conventions

- Blocks of code are commented
- Follow the conventions as specified in eslint config (roughly, Airbnb JS style)
- All `@require` and `@resource` URLs must have subresource-intregity hashes ([use this hashing tool](https://www.srihash.org/))
- Vanilla JS is OK if you don't want to use JQuery
