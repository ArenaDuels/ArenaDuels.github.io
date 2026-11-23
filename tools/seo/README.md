# Search engine setup (SEO)

What is in place, and how to keep it right.

**On the page (`index.html`)**
- A title and description, a canonical address, and Open Graph / Twitter tags with a 1200×630 picture
  (`og-image.png`), so shared links and search results show it.
- Structured data (`WebSite` and `VideoGame`, as JSON-LD) telling search engines this is a free browser game.
- One `<h1>`, a `<main>`, and a plain-text "About Arena Duels" section (a closed `<details>` on the front page)
  that says what the game is, how to play, the modes, every arena, and the controls. A game is mostly
  JavaScript, so without this there is hardly any text for a search engine to read.
- `404.html` (not indexed) for pages that do not exist.

**Files at the top level:** `robots.txt` (allows everything except `/server/` and `/tools/`, and points
to the sitemap), `sitemap.xml`, and the Google verification file.

**Keeping it right**
- After adding, renaming or removing an arena, run `node tools/seo/build-about.mjs` to refresh the arena list
  in the About section. `server/seo.test.js` fails if the list is out of date.
- To remake the picture (for example, to show new arenas), edit `tools/seo/og-image.py` and run
  `python3 tools/seo/og-image.py` from the top of the project.
- Update `<lastmod>` in `sitemap.xml` when you make a big change.

**Things only you can do (they need your accounts)**
1. **Google Search Console.** The site is already verified (the `google…html` file). Open *Sitemaps*, add
   `sitemap.xml`, then use *URL inspection* on `https://arenaduels.github.io/` and click *Request indexing*.
2. **Bing Webmaster Tools** (this also covers DuckDuckGo and others that use Bing). Sign in at
   bing.com/webmasters and choose *Import from Google Search Console*, or add the site and submit the same
   sitemap. Then use *URL submission* for the front page.
3. Get links to the game from other places (a Reddit post, itch.io, a Discord, friends' sites). Links from
   other sites are the biggest thing that decides ranking, and nothing on the page can replace them.
