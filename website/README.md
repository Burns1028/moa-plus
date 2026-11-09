# MoA+ website

Standalone static one-page introduction to MoA+. No dependencies or build step.

From the repository root, preview over HTTP:

```sh
python3 -m http.server 4173 --directory website
```

Open `http://localhost:4173`. Copy the contents of `website/` into any static host's public directory to serve at `/`. Asset links are relative. The canonical public URL and Open Graph URL should match the actual deployment.

The English/简中 switch translates the page and demo, and remembers the language locally. The four demo buttons work independently; replay advances through one sequence. The diagram is illustrative and does not connect to a model. It honors reduced-motion preferences. Installation commands match the main README, with clipboard and manual-selection fallbacks.

The workflow link points to the historical **v0.1.23** recording on GitHub. The current main runtime remains an unreleased developer preview and requires its matching DSH rc.3 compatibility runtime.
