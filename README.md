# Blackout Protocol — rebuilt package

## Important: upload structure
Upload the **contents** of this folder to the root of your GitHub repository. Do not upload only the ZIP, and do not move files out of `public`.

```text
repository-root/
├── server.js
├── package.json
├── README.md
├── ANDROID_BUILD.md
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    ├── manifest.webmanifest
    └── assets/
        └── classified-card-set.webp
```

The Express server explicitly serves `path.join(__dirname, 'public')`. The page uses absolute asset paths (`/style.css`, `/app.js`, `/assets/classified-card-set.webp`) so the artwork and styling are not dependent on the current URL path.

## Deploy on Render
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path (optional): `/health`

Node 18 or newer is required. Render supplies the `PORT` environment variable automatically.

## Current implementation notes
- Room creation/joining, 5–10 player lobby, private role assignment, phase advancement, role actions, voting, and result reveal are implemented.
- The supplied card sheet is included and displayed in the briefing and reference sections. It is a single reference-sheet image, not individually sliced card assets.
- Narration uses the browser's speech synthesis only if added/enabled by the user's device; this build currently provides on-screen phase guidance rather than automatic spoken narration.
- This is a rebuilt functional baseline, not a certified production game. Test a complete round with 5–10 separate browser sessions before inviting players. The original printed rules should be treated as authoritative where any rule detail differs.
