# Missile Sky ✦

A fast, mobile-first **open-air missile-survival arcade game**. Fly in any direction, bait homing missiles into overshooting, collide them into each other, and turn chain reactions into your escape route.

Built as a small static TypeScript + HTML Canvas game. It runs entirely in the browser—no server, account, analytics, external gameplay API, or paid service required.

> **Original project:** Missile Sky is inspired by the broad arcade-survival gameplay structure of missile-dodging games. Its code, vector aircraft, missiles, visuals, UI, and procedural sounds are original; no assets are taken from the reference game.

## Play features

- Open, wrapping world coordinates with a smoothly following camera.
- Free 360° movement with aircraft acceleration, momentum, turning, and analog throttle.
- Homing missiles use lead pursuit and limited turning. They can overshoot, keep going, turn back, and reacquire the aircraft.
- Missile-on-missile collisions, blast damage, chain reactions, splitter fragments, smoke, flash, sparks, debris, screen shake, and synthesized audio.
- Eight missile behaviors: standard, fast, curving, zigzag, heavy, splitter, boomerang, and swarm.
- Time-based difficulty ramp, collectible stars, shield/boost pickups, and three modes.
- Five unlockable aircraft, seven persistent upgrades, pilot XP/levels, run missions, and one-time career achievements.
- Local save data through versioned `localStorage`; malformed or partial saves are repaired with defaults.
- Original Canvas-drawn aircraft/missiles, procedural clouds and effects, procedural WebAudio, and no required remote assets.
- Mobile virtual joystick and touch buttons; keyboard support on desktop.
- Responsive portrait/landscape layout, safe-area padding, reduced-motion and graphics-quality settings.
- GitHub Pages deployment workflow included.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Fly | **WASD** or **Arrow keys** | Analog virtual joystick |
| Boost | **Space** | **BOOST** button |
| Shield | **Q** | **SHIELD** button |
| Pause / resume | **P** or **Esc** | Pause button at top-right |

Movement has momentum: easing the joystick/keys releases acceleration and the aircraft gradually slows. Aim to bait missiles into overshooting and crossing one another instead of simply outrunning every missile.

## Requirements

- Node.js 20+ (Node 20 is used in the included deploy workflow)
- npm
- A modern browser with Canvas 2D and WebAudio support (audio is optional)

## Local development

```bash
npm install
npm run dev
```

Vite prints a local development URL. Open it in a modern browser. On a phone connected to the same local network, use Vite's network URL to test touch controls.

## Build, preview and checks

```bash
npm run build    # strict TypeScript check + production bundle in dist/
npm run preview  # serve the built static site locally
npm run lint     # TypeScript validation
npm test         # deterministic core-system unit tests
```

The built site is static. The browser needs JavaScript enabled. It does not require a Node server after the build.

## Deploy to GitHub Pages (beginner steps)

> **Important:** This is a Vite/TypeScript source project. In Pages settings choose **GitHub Actions**, not **Deploy from a branch**. Branch deployment does not run the Vite build, so the raw `src/main.ts` is not a playable site. The workflow at `.github/workflows/deploy.yml` builds `dist/` and publishes that output. Some file-upload dialogs hide dot-folders such as `.github`; use git or create that workflow file explicitly if it is missing.

1. **Create a repository.** Sign in to GitHub, choose **New repository**, give it a name such as `missile-sky`, and create it. A public repository is simplest for GitHub Pages on a free plan.
2. **Put this project in the repository.** Either upload the project files in GitHub's web interface, or clone the empty repository and copy the project into it. Keep `.github/workflows/deploy.yml` in its exact path.
3. **Push to `main`.** If using git from a terminal:

   ```bash
   git add .
   git commit -m "Add Missile Sky game"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

   If the repository already has commits, use its existing remote and just push the `main` branch.
4. **Allow the workflow to deploy.** In the repository, open **Settings → Pages**. Set the build/deployment source to **GitHub Actions** if prompted. Under **Settings → Actions → General**, ensure Actions are allowed and the workflow can run. The included workflow builds the project and deploys the `dist/` artifact whenever a commit is pushed to `main` (or when manually started from the Actions tab).
5. **Wait for deployment.** Open the **Actions** tab, select **Deploy to GitHub Pages**, and wait for both build and deploy jobs to finish successfully.
6. **Open the game.** GitHub displays the published URL in the Pages settings and deployment environment. A repository site normally looks like:

   ```text
   https://YOUR-NAME.github.io/YOUR-REPOSITORY/
   ```

7. **Publish an update.** Commit and push changes to `main`; the workflow redeploys automatically:

   ```bash
   git add .
   git commit -m "Update game"
   git push
   ```

Vite is configured with a relative `base: './'`, so bundled JavaScript, styles, and the favicon also work under a repository sub-path (not only at `/`). No manual copy into a `gh-pages` branch is needed.

## Save data

Progress is stored only in this browser's `localStorage` under the key `missile-sky-save`. It includes a format version, coins, XP, mode records, selected/unlocked aircraft, upgrade levels, mission completions, earned one-time achievements, settings, and lifetime run statistics. There is no cloud sync: another browser/device has a separate save. Clearing site data or using **Settings → Reset all progress** removes it. Invalid or partial data is sanitized rather than being allowed to crash the game.

## Project structure

```text
.
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── public/
│   ├── favicon.svg
│   └── .nojekyll
├── .github/workflows/deploy.yml
├── src/
│   ├── main.ts
│   ├── data/             # aircraft, modes, missile types, upgrades, missions, achievements
│   ├── game/             # world, camera, player, missiles, collisions, render loop
│   ├── systems/          # save, progression, audio, input, performance
│   ├── ui/               # HUD, screens, joystick, DOM helpers
│   └── styles/main.css
└── tests/core.test.ts
```

## Performance notes

- Canvas uses `devicePixelRatio` capped at 1.25–2 depending on quality.
- Gameplay advances with `requestAnimationFrame`, clamped delta time, and substeps; it is not tied to display FPS.
- Missiles, stars, text, and particles use fixed-size pools. Missile-vs-missile collision uses a spatial grid; particles are budgeted and automatically reduced if sustained FPS drops.
- Cloud layers are procedurally created and tied to camera motion at multiple parallax depths. They are regenerated on resize or quality changes.
- Audio is generated with WebAudio oscillators and noise buffers. It starts only after a user gesture to respect browser autoplay rules, and can be switched off.
- Core gameplay and saves are local. Google Fonts are a cosmetic CSS enhancement only; system font fallbacks are provided, so the game remains playable when offline or when external fonts are unavailable.

## Testing and current scope

`npm test` covers world wrapping, camera transforms, limited missile steering, spatial-grid collision/chain reactions, difficulty, upgrade calculations, XP levels, and save sanitization. The built game still benefits from hands-on testing on the target phone/browser, especially for device-specific pointer feel and frame rate. Optional visual effects and sound can vary with browser/device capabilities; missing WebAudio or vibration support does not prevent play.
