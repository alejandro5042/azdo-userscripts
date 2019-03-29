# Browser Userscripts For Azure DevOps

A collection of userscripts to improve the Azure DevOps UI.

These userscripts were tested in Chrome and Firefox with the Tampermonkey extension. 

## 1) PR dashboard improvements

[Install PR dashboard improvements](#) (see pre-requisites below)

Sorts the PRs in your dashboard into categories. 

![](static/azdo-pr-dashboard-example.png)

- Reviews are sorted from oldest to newest (reverse of the default)
- Reviews are highlighted red if you are the last reviewer and everyone else approved
- Incomplete but blocked: Reviews you have not completed but are blocked anyways because another reviewer voted Waiting on Author or Rejected. This section is open by default

# Pre-requisites
A userscripts extension is required to actually use these scripts; e.g. Tampermonkey, Greasemoneky, etc.

[Install the Tampermonkey extension](https://tampermonkey.net/)

- If you just installed this extension, **refresh this page** or the download links may not work
- When installing extensions, remember to refresh the affected pages after installing (e.g. the PR dashboard)
- By default, Tampermonkey will automatically update scripts from the original install location once a day. You can force an update from the extensions menu

# Credits
This is the second version of a PR filtering script originally written by Tian Yu, which faded out approved PRs. Further improved by Alejandro Barreto.
