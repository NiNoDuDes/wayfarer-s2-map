# Wayfarer S2 Map

A mobile-friendly browser map for Pokémon GO Wayfarer nominations.

## Features

- GPS location tracking
- S2 L14 and L17 cell overlays
- Gym count logic per L14 cell
- OSM POI layer (proxy for Pokéstops)
- Cell token display
- Dark map theme

## Deploy to GitHub Pages

1. Create a new GitHub repo named `wayfarer-s2-map`
2. Push all files in this folder to the `main` branch
3. Go to **Settings → Pages → Source** → select `main` branch, `/ (root)`
4. Your map will be at `https://YOUR-USERNAME.github.io/wayfarer-s2-map/`
5. Update the bookmarklet URL in `bookmarklet.html` with your actual GitHub username

## Local use

Just open `index.html` in any modern browser — no server needed.
The OSM POI fetch requires an internet connection (CORS-safe via Overpass API).

## Gym logic

| Stops in L14 cell | Gyms |
|---|---|
| 0–1 | 0 |
| 2–5 | 1 |
| 6–19 | 2 |
| 20+ | 3 |
