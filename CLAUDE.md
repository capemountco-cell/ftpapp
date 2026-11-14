Read AGENTS.md before changing anything.

## Merging

Merge your own pull requests without asking. Once every CI check on the
PR's current head is green and it has no merge conflict, mark it ready
for review and merge it with a merge commit (never squash or rebase:
Lovable syncs this repository and rewritten history loses its project
history). If CI is red, fix it first; never merge a failing PR. Then tell
the user it was merged.

## Website

Every Mac app gets its own download website, made the same way each time:

- **Its own Lovable project and GitHub repo**, never inside the app's repo.
  Create it in the Lovable workspace "006", named `<app>-site` (this app:
  `captainapp-site`). The user connects it to GitHub from the Lovable editor.
- **Same shape as the Camu website** (Lovable project
  `2795037d-c483-4c5c-954c-ab2fbbe5d56f`, camu.cc): fixed nav that blurs on
  scroll, hero with Download and "How to install", a features grid, two
  showcase rows, numbered install steps, a final call to action, footer.
- **The app's own brand:** its logo and app icon (favicon, share image), its
  palette and copy. Real screenshots when the app looks final, otherwise an
  HTML/CSS recreation of its window.
- **A `/download` route** that streams the first `.dmg` of the app repo's
  latest GitHub release, and falls back to its Releases page. No
  analytics or tracking unless the user asks.
- **One `SITE_URL` constant** for the domain (canonical, share tags,
  robots.txt, sitemap.xml). Ask the user for the domain; never guess one.

This app's site: Lovable project `0613a70d-5416-4bec-a31a-2cf7661198be`.
