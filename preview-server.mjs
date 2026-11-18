import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const STARTED_AT = Date.now();
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const CURRENT_FIELDS = "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m";
const HOURLY_FIELDS = "temperature_2m,precipitation_probability,weather_code,is_day";
const DAILY_FIELDS = "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max";
const UPSTREAM_ERROR = "The weather service is unavailable right now. Please try again shortly.";
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};
const STATIC_ROUTES = new Map([
  ["/", { file: "static/index.html", type: "text/html; charset=utf-8" }],
  ["/static/styles.css", { file: "static/styles.css", type: "text/css; charset=utf-8" }],
  ["/static/app.js", { file: "static/app.js", type: "text/javascript; charset=utf-8" }],
  ["/static/manifest.webmanifest", { file: "static/manifest.webmanifest", type: "application/manifest+json; charset=utf-8" }],
  ["/sw.js", { file: "static/sw.js", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/static/sw.js", { file: "static/sw.js", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/static/icons/icon.svg", { file: "static/icons/icon.svg", type: "image/svg+xml" }]
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function findCargo() {
  const executable = process.platform === "win32" ? "cargo.exe" : "cargo";
  const candidates = process.env.CARGO
    ? [process.env.CARGO]
    : [join(homedir(), ".cargo", "bin", executable), "cargo"];

  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (!existsSync(candidate)) continue;
    }
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore", timeout: 5000 });
    if (result.status === 0) return candidate;
  }
  return null;
}

function parsePort(args) {
  let value = process.env.PORT || "3000";
  const portFlag = args.findIndex((arg) => arg === "--port" || arg === "-p");
  if (portFlag >= 0 && args[portFlag + 1]) value = args[portFlag + 1];
  const inlinePort = args.find((arg) => arg.startsWith("--port="));
  if (inlinePort) value = inlinePort.slice("--port=".length);

  if (!/^\d+$/.test(value)) throw new Error(`Invalid preview port: ${value}`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid preview port: ${value}`);
  }
  return port;
}

function runCargo(cargo, action, port = 3000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, HOST: "0.0.0.0", PORT: String(port) };
    if (!env.CARGO_TARGET_DIR && process.platform !== "win32") {
      env.CARGO_TARGET_DIR = "/tmp/rustweb-target";
    }
    const child = spawn(
      cargo,
      action === "build" ? ["build", "--release", "--locked"] : ["run", "--release", "--locked"],
      { env, stdio: "inherit" }
    );

    const forwardSignal = (signal) => child.kill(signal);
    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    child.on("error", (error) => reject(new Error(`Could not start Rust: ${error.message}`)));
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Rust ${action} stopped (${signal || `exit code ${code}`}).`));
      }
    });
  });
}

async function validatePreview() {
  const requiredFiles = [
    "index.html",
    "static/index.html",
    "static/styles.css",
    "static/app.js",
    "static/manifest.webmanifest",
    "static/sw.js",
    "static/icons/icon.svg"
  ];
  const contents = new Map();
  for (const file of requiredFiles) {
    const content = await readFile(join(ROOT, file));
    if (content.length === 0) throw new Error(`Preview asset is empty: ${file}`);
    contents.set(file, content);
  }

  if (!contents.get("index.html").equals(contents.get("static/index.html"))) {
    throw new Error("The root preview entry must match static/index.html.");
  }
  JSON.parse(contents.get("static/manifest.webmanifest").toString("utf8"));

  for (const file of ["preview-server.mjs", "static/app.js", "static/sw.js"]) {
    const result = spawnSync(process.execPath, ["--check", join(ROOT, file)], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`JavaScript syntax validation failed: ${file}`);
  }
  console.log("Preview assets validated successfully.");
}

function send(request, response, status, body, headers = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Length": String(buffer.length),
    ...headers
  });
  response.end(request.method === "HEAD" ? undefined : buffer);
}

function sendJson(request, response, status, payload, cacheControl) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  if (status >= 400) headers["Cache-Control"] = "no-store";
  send(request, response, status, JSON.stringify(payload), headers);
}

function validateSearch(value) {
  const search = (value || "").trim();
  const length = Array.from(search).length;
  if (length < 2 || length > 80) {
    throw new HttpError(400, "Enter between 2 and 80 characters to search for a place.");
  }
  if (/\p{Cc}/u.test(search)) {
    throw new HttpError(400, "The search contains unsupported characters.");
  }
  return search;
}

function validateCoordinate(value, minimum, maximum) {
  if (value === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    throw new HttpError(400, "A valid latitude and longitude are required.");
  }
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw new HttpError(400, "A valid latitude and longitude are required.");
  }
  return coordinate;
}

async function providerJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NimbusWeather/1.0 (+https://github.com/Shadow-Taslim/RustWeb)" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ""}`
      : "unknown error";
    console.error(`Weather provider request failed: ${detail}`);
    throw new HttpError(502, UPSTREAM_ERROR);
  }
}

async function handleGeocode(url) {
  const search = validateSearch(url.searchParams.get("q"));
  const upstream = new URL(GEOCODING_URL);
  upstream.search = new URLSearchParams({
    name: search,
    count: "6",
    language: "en",
    format: "json"
  }).toString();
  return { payload: await providerJson(upstream), cache: "public, max-age=86400" };
}

async function handleWeather(url) {
  const latitude = validateCoordinate(url.searchParams.get("latitude"), -90, 90);
  const longitude = validateCoordinate(url.searchParams.get("longitude"), -180, 180);
  const units = url.searchParams.get("units") || "metric";
  if (!["metric", "imperial"].includes(units)) {
    throw new HttpError(400, "Units must be either 'metric' or 'imperial'.");
  }
  const [temperatureUnit, windSpeedUnit, precipitationUnit] = units === "metric"
    ? ["celsius", "kmh", "mm"]
    : ["fahrenheit", "mph", "inch"];

  const upstream = new URL(FORECAST_URL);
  upstream.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: CURRENT_FIELDS,
    hourly: HOURLY_FIELDS,
    daily: DAILY_FIELDS,
    timezone: "auto",
    forecast_days: "7",
    temperature_unit: temperatureUnit,
    wind_speed_unit: windSpeedUnit,
    precipitation_unit: precipitationUnit
  }).toString();
  return { payload: await providerJson(upstream), cache: "public, max-age=60" };
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (!["GET", "HEAD"].includes(request.method || "GET")) {
      response.setHeader("Allow", "GET, HEAD");
      sendJson(request, response, 405, { error: "Method not allowed." });
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(request, response, 200, {
        status: "ok",
        service: "Nimbus Weather",
        uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000)
      });
      return;
    }

    if (url.pathname === "/api/geocode" || url.pathname === "/api/weather") {
      const result = url.pathname === "/api/geocode"
        ? await handleGeocode(url)
        : await handleWeather(url);
      sendJson(request, response, 200, result.payload, result.cache);
      return;
    }

    const asset = STATIC_ROUTES.get(url.pathname);
    if (asset) {
      const headers = { "Content-Type": asset.type };
      if (asset.cache) headers["Cache-Control"] = asset.cache;
      send(request, response, 200, await readFile(join(ROOT, asset.file)), headers);
      return;
    }

    sendJson(request, response, 404, { error: "The requested resource was not found." });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(request, response, error.status, { error: error.message });
      return;
    }
    console.error(`Preview request failed: ${error instanceof Error ? error.message : "unknown error"}`);
    if (!response.headersSent) {
      sendJson(request, response, 500, { error: "The preview server could not complete the request." });
    } else {
      response.destroy();
    }
  }
}

function startNodePreview(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      void handleRequest(request, response);
    });
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : port;
      console.log(`Nimbus Weather preview is running at http://0.0.0.0:${activePort}`);
      console.log("Preview runtime: Node fallback with live Open-Meteo data. Production remains Rust/Axum.");
      resolve();
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
      });
    }
  });
}

const args = process.argv.slice(2);
const buildOnly = args.includes("--build");
const cargo = findCargo();

try {
  if (buildOnly) {
    await validatePreview();
    if (cargo) {
      await runCargo(cargo, "build");
    } else {
      console.log("Cargo is unavailable; the validated Node preview fallback will be used.");
    }
  } else if (cargo) {
    console.log("Starting the Rust/Axum server.");
    await runCargo(cargo, "run", parsePort(args));
  } else {
    console.warn("Cargo was not found. Starting the preview-only Node server; no Rust installation is required.");
    await startNodePreview(parsePort(args));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
