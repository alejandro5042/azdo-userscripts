# How to contribute

Thank you for reading!

## Submitting changes

Pull requests are welcomed :)

For significant effort or feature work, it is preferred to start by filing an issue to discuss your approach before you start coding.

## Hacking / debugging

- Simply open the userscript in Tampermonkey's dashboard and hack away
- Hit `Ctrl+S` to save
- Refresh the target page to test your changes

Once you're done, copy your script from the dashboard into the actual source file of a clone of this repo. Then propose a pull request.

## Testing

For each PR, make sure the userscript:

- Version is rev'ed
- Runs in latest stable Chrome and Firefox without Javascript errors
- Works in both `dev.azure.com/account` and `account.visualstudio.com`
- Customizations work in both light and dark theme
- Does not report any issues in `eslint` (run `npm run build`)

## Coding conventions

- Blocks of code are commented
- Follow the conventions as specified in eslint config (roughly, Airbnb JS style)
