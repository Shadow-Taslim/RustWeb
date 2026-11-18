# Nimbus Weather

A fast, accessible weather web application built with **Rust**, **Axum**, and **Tokio**. Nimbus combines a self-contained Rust server with a responsive browser interface and live forecasts from [Open-Meteo](https://open-meteo.com/). No API key, database, frontend build step, or account is required.

## Features

- Current conditions, eight weather metrics, sunrise, and sunset.
- Twenty-four-hour and seven-day forecasts.
- City search with keyboard-accessible autocomplete.
- Browser geolocation with clear permission and failure states.
- Celsius/kilometres and Fahrenheit/miles unit systems.
- Up to five saved places, last location, and unit preferences stored only in the current browser.
- Responsive layout, visible focus states, reduced-motion support, and a 44-pixel minimum button target.
- Installable web-app manifest and a service worker for static assets. Weather and navigation requests always use the network.
- Validated API inputs, upstream timeouts, sanitized errors, and security headers.
- HTML, CSS, JavaScript, and icons embedded in the Rust executable at compile time.

## Quick start

### Prerequisites

Install a Rust toolchain that supports edition 2024. The project is tested with Rust 1.100.0.

```sh
git clone https://github.com/Shadow-Taslim/RustWeb.git
cd RustWeb
cargo run --release
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The server binds to `127.0.0.1` by default, so it is not exposed to other devices unless you explicitly change `HOST`.

### Windows PowerShell

```powershell
git clone https://github.com/Shadow-Taslim/RustWeb.git
Set-Location RustWeb
cargo run --release
```

To listen on all interfaces or use another port:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "8080"
cargo run --release
```

On Linux or macOS, the equivalent is:

```sh
HOST=0.0.0.0 PORT=8080 cargo run --release
```

## Docker

```sh
docker build -t nimbus-weather .
docker run --rm -p 3000:3000 nimbus-weather
```

The container listens on `0.0.0.0:3000` and runs as an unprivileged user.

## HTTP API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Server health and status. |
| `GET` | `/api/geocode?q=Tokyo` | Returns up to six matching places. Queries require 2–80 characters. |
| `GET` | `/api/weather?latitude=35.6762&longitude=139.6503&units=metric` | Returns current, hourly, and daily forecast data. |

`units` accepts `metric` or `imperial` and defaults to `metric`. Latitude must be between −90 and 90; longitude must be between −180 and 180. Invalid requests return JSON errors with an appropriate 4xx status. Upstream failures return a sanitized 502 response.

The application proxies Open-Meteo rather than exposing unrestricted upstream URLs. It does not collect weather requests in a database or require user accounts.

## Verification

```sh
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --release --locked
node --check static/app.js
```

The Rust tests cover input validation, units, static serving, health responses, and invalid-request handling. A ready-to-use GitHub Actions configuration is included as `ci.yml.example`. To enable it, copy it to `.github/workflows/ci.yml`; it then runs the same formatting, lint, test, release-build, and JavaScript syntax checks on every push and pull request.

## Project structure

```text
RustWeb/
├── Cargo.toml                 # Package metadata and dependencies
├── Cargo.lock                 # Reproducible dependency graph
├── Dockerfile                 # Multi-stage production image
├── ci.yml.example             # Optional GitHub Actions checks
├── src/
│   └── main.rs                # Axum server, provider integration, and tests
├── static/
│   ├── index.html             # Semantic interface and inline SVG symbols
│   ├── styles.css             # Responsive design system
│   ├── app.js                 # Search, forecast, storage, and UI behavior
│   ├── manifest.webmanifest   # Installable app metadata
│   ├── sw.js                  # Static-asset service worker
│   └── icons/icon.svg         # Nimbus app icon
```

## Data and privacy

Weather and geocoding data come from Open-Meteo under its service terms. A city search sends the entered query to the Nimbus server and then to Open-Meteo; a forecast sends the selected coordinates. “Use my location” requests browser permission before reading device coordinates. Saved places, preferences, and last location use browser `localStorage`; they are not synced between browsers or devices.

## License

MIT © 2026 Shadow-Taslim. See [LICENSE](LICENSE).
