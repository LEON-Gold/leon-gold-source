# دفتر لئون گلد (Leon Gold ledger)

A gold and jewelry accounting ledger. It is one self-contained HTML page, published as a Claude Artifact.

- **Live app:** https://claude.ai/artifact/TECQa8DPWDUn1HFpLwD3FH
- **Data:** the ledger data is not in this repository. It lives in the artifact's own database (`window.claude.use('db')`), so publishing a new `index.html` to the same artifact URL keeps all the data.

## Files

- `index.html`: the whole app (HTML, CSS and JS in one file).
- `tests/*.test.js`: Playwright smoke tests. Each one mocks `window.claude` (db, user, downloads) and drives the page.

## Running the tests

```
node tests/menu.test.js
node tests/profile.test.js
node tests/login.test.js index.html
```

`tests/export.test.js` serves html2canvas and jsPDF from local copies, because the CDN may be blocked. Before running it, edit the library paths at the top of the file.

## Offline copy

`offline/build.ps1` turns `index.html` into `offline/leon-gold-offline.html`, one file that runs without internet or the artifact:

```
powershell -ExecutionPolicy Bypass -File offline/build.ps1
```

- `offline/runtime.js` stands in for `window.claude` (db, user, downloads, assets) and keeps the data in the browser's IndexedDB.
- `offline/vendor/` holds local copies of html2canvas, jsPDF, SheetJS and the fonts.
- The «آفلاین» button exports or imports the whole offline store. Import also accepts the app's «پشتیبان کامل» file.
- AI fill (`sample`) is not available offline.
- Rebuild after every change to `index.html`. The output file is git-ignored. `index.html` itself is never changed by the build, so the same file is what gets published.

### Phone copy (iPhone home-screen app)

The offline copy is also installed on the owner's iPhone from https://leon-gold.github.io/leon-gold-app/. It is a separate public repo (`LEON-Gold/leon-gold-app`) that holds only the built files and no data. `offline/pwa/` adds the service worker, manifest and icons, so the app opens without internet once installed.

```
powershell -ExecutionPolicy Bypass -File offline/build.ps1 -Site ..\leon-gold-app
cd ..\leon-gold-app; git add -A; git commit -m "update"; git push
```

The phone picks up the new version the next time the app opens online.

## Publishing

From a Claude Code session, publish `index.html` with the Artifact tool to the URL above. That updates the live app in place.

The current runtime capabilities are:
- `db`, with rule `{path:"", read:"interact", write:"interact"}`
- `downloads`
- `sample`
- `assets`
- `user`, with scopes `["profile"]`

Omit `capabilities` on a republish so they carry forward.
