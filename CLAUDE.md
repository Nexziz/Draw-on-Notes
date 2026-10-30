Do not add "Claude-Session:" lines to commit messages or PR descriptions.

## Buy me a coffee

The support link is https://buymeacoffee.com/nexsiz (spelled "nexsiz", unlike the GitHub name "Nexziz"). Keep it in three places:

- `manifest.json`: `"fundingUrl": "https://buymeacoffee.com/nexsiz"`, which shows Obsidian's own "Donate" button on the plugin's page.
- The top of the plugin's settings tab: a thank-you card ("Enjoying Draw on Notes?" plus one line) with a yellow `#ffdd00` pill button that has Obsidian's `coffee` icon and the text "Buy me a coffee", and opens the link in the browser. Pocket Watch (`nexziz/pocket-watch`, `.pocket-watch-support` and `.pocket-watch-coffee` in `styles.css`) is the model.
- The "Support" section of `README.md`, with the shields.io badge.

## The plugin

Plain JavaScript with no build step, like Pocket Watch: `main.js`, `styles.css` and `manifest.json` are what Obsidian loads. To release, bump the version in `manifest.json`, add it to `versions.json`, commit, and push a tag with the bare version (`0.2.0`, never `v0.2.0`). `.github/workflows/release.yml` then publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`, which is what Obsidian installs from. A release made by hand on GitHub works too: its tag starts the workflow, which attaches the files to it. To attach them again to an existing release, run the Release workflow from the Actions tab with its version. The workflow fails if the tag and `manifest.json` disagree.

## Tests and images

`dev/` has an Obsidian lookalike page that loads the real `main.js` and `styles.css` in Chromium. From `dev/`, after `npm install`:

- `npm test` runs the checks in `test.js` (drawing, saving, undo, eraser, scrolling, settings). Run it after every change to the plugin.
- `npm run images` records `images/hero.png`, `images/markup-demo.gif` and `images/pen-settings.gif` with `capture.js`. Rerun it when the toolbar or the look of the marks changes, and look at the results before committing.
