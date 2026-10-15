# CATFIGHT.EXCHANGE

**Live:** https://shojaee76-cmyk.github.io/catfight/

Two cats fight over the live Bitcoin price. A 3D arena duel built with three.js,
no engine, no build step, all assets procedural.

- **BULL CAT** (orange tabby, you) vs **BEAR CAT** (charcoal, AI), circling a floating gold BTC coin.
- The **live BTC price** streams from Bybit (WebSocket, Gate fallback, honest labeled offline replay last).
  Buy prints charge your super energy; sell pressure makes the bear mean. Every round ends with a KO
  banner stamped with the real price at the moment of victory — and whether the market agreed.
- **Controls:** tap/click = swipe · hold = pounce (super when the meter is full) · A/D nudge orbit · drag = camera.

## Verify

```bash
node tools/probe.mjs                                      # local server + full acceptance (24 checks)
node tools/probe.mjs --base https://shojaee76-cmyk.github.io/catfight/   # against the deployed page
node tools/shots.mjs                                      # re-capture renders into qa/shots/
python tools/eyes.py qa/shots/02-fight-desktop.png --ask "..."           # paid vision review
```

The probe asserts the whole game honestly: feed price vs an independent REST ticker (<0.5%),
replay labeling when the exchange is unreachable, AI aggression, player damage, KO → banner →
next-round reset, super pounce consumption, fps floor, non-blank varied pixels, and that the
bundled fonts actually render (render-hash, not `document.fonts.check`).

## Stack

- three.js r186 vendored in `vendor/` (no CDN — the line this ships to blocks most).
- `js/feed.js` Bybit → Gate → replay provider chain, one normalized tick shape.
- `js/cats.js` squash-and-stretch procedural cats (spring impulses, segment tails, gaze tracking).
- `js/arena.js` scene, LED price band (canvas texture), gold coin, pooled particles, camera rig, WebAudio.
- `js/game.js` combat state machine, AI, rounds, HUD wiring, self-report (`window.__game`).
- Fonts bundled: Archivo (variable) + JetBrains Mono (variable).

## License

MIT for this repo's code. three.js is its own license. Fonts are OFL.
