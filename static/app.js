"use strict";

const STORAGE = {
  units: "nimbus:units",
  saved: "nimbus:saved-v1",
  lastLocation: "nimbus:last-location-v1"
};

const DEFAULT_LOCATION = {
  id: 2643743,
  name: "London",
  admin1: "England",
  country: "United Kingdom",
  country_code: "GB",
  latitude: 51.50853,
  longitude: -0.12574
};

const state = {
  units: readStorage(STORAGE.units) === "imperial" ? "imperial" : "metric",
  location: null,
  weather: null,
  saved: readSavedLocations(),
  searchResults: [],
  activeResult: -1,
  searchTimer: null,
  searchSequence: 0,
  weatherSequence: 0,
  searchController: null,
  weatherController: null,
  locating: false,
  toastTimer: null
};

const elements = {};

function init() {
  const ids = [
    "search-form", "city-search", "search-button", "search-results", "locate-button",
    "refresh-button", "unit-metric", "unit-imperial", "saved-section", "saved-list",
    "notice", "loading-line", "weather-content", "current-panel", "current-date",
    "location-name", "location-region", "save-button", "save-button-label", "save-icon-use",
    "current-icon-use", "current-temp", "current-temp-unit", "current-condition",
    "current-summary", "updated-time", "metric-feels", "metric-humidity", "metric-wind",
    "metric-gusts", "metric-precipitation", "metric-pressure", "metric-cloud", "metric-uv",
    "sunrise-time", "sunset-time", "hourly-caption", "hourly-list", "daily-list",
    "error-state", "error-message", "retry-button", "toast"
  ];
  ids.forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });
  elements.hourlyScroll = document.querySelector(".hourly-scroll");

  elements.searchForm.addEventListener("submit", handleSearchSubmit);
  elements.citySearch.addEventListener("input", handleSearchInput);
  elements.citySearch.addEventListener("keydown", handleSearchKeys);
  elements.locateButton.addEventListener("click", useCurrentLocation);
  elements.refreshButton.addEventListener("click", () => loadWeather(state.location, true));
  elements.retryButton.addEventListener("click", () => loadWeather(state.location));
  elements.saveButton.addEventListener("click", toggleSavedLocation);
  elements.unitMetric.addEventListener("click", () => changeUnits("metric"));
  elements.unitImperial.addEventListener("click", () => changeUnits("imperial"));
  document.addEventListener("click", (event) => {
    if (!elements.searchForm.contains(event.target)) closeSearchResults();
  });

  updateUnitButtons();
  renderSavedLocations();
  state.location = normalizeLocation(readJsonStorage(STORAGE.lastLocation)) || { ...DEFAULT_LOCATION };
  updateSaveButton();
  loadWeather(state.location);
  registerServiceWorker();
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function handleSearchInput() {
  window.clearTimeout(state.searchTimer);
  const query = elements.citySearch.value.trim();
  if (query.length < 2) {
    state.searchController?.abort();
    closeSearchResults();
    return;
  }
  state.searchTimer = window.setTimeout(() => searchPlaces(query, false), 300);
}

function handleSearchSubmit(event) {
  event.preventDefault();
  window.clearTimeout(state.searchTimer);
  if (state.activeResult >= 0 && state.searchResults[state.activeResult]) {
    selectLocation(state.searchResults[state.activeResult]);
    return;
  }
  const query = elements.citySearch.value.trim();
  if (query.length < 2) {
    showNotice("Enter at least two characters to search for a place.");
    elements.citySearch.focus();
    return;
  }
  searchPlaces(query, true);
}

function handleSearchKeys(event) {
  if (event.key === "Escape") {
    closeSearchResults();
    return;
  }
  if (event.key === "Enter" && state.activeResult >= 0) {
    event.preventDefault();
    selectLocation(state.searchResults[state.activeResult]);
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key) || state.searchResults.length === 0) return;

  event.preventDefault();
  if (elements.searchResults.hidden) renderSearchResults();
  const direction = event.key === "ArrowDown" ? 1 : -1;
  state.activeResult = (state.activeResult + direction + state.searchResults.length) % state.searchResults.length;
  updateActiveSearchResult();
}

async function searchPlaces(query, submitted) {
  const sequence = ++state.searchSequence;
  state.searchController?.abort();
  state.searchController = new AbortController();
  state.activeResult = -1;
  setSearchBusy(true);
  if (submitted) {
    showSearchMessage("Searching for matching places…");
  } else {
    closeSearchResults();
  }

  try {
    const payload = await fetchJson(`/api/geocode?q=${encodeURIComponent(query)}`, {
      signal: state.searchController.signal
    });
    if (sequence !== state.searchSequence) return;

    state.searchResults = (Array.isArray(payload.results) ? payload.results : [])
      .map(normalizeLocation)
      .filter(Boolean)
      .slice(0, 6);

    if (state.searchResults.length === 0) {
      showSearchMessage("No matching places found. Try a nearby city or add a country name.");
      if (submitted) showNotice("No places matched your search. Try a different spelling.");
      return;
    }
    if (submitted && state.searchResults.length === 1) {
      selectLocation(state.searchResults[0]);
      return;
    }
    renderSearchResults();
    hideNotice();
  } catch (error) {
    if (error.name === "AbortError" || sequence !== state.searchSequence) return;
    state.searchResults = [];
    showSearchMessage("Search is unavailable right now. Please try again.");
    if (submitted) showNotice(friendlyError(error));
  } finally {
    if (sequence === state.searchSequence) setSearchBusy(false);
  }
}

function renderSearchResults() {
  elements.searchResults.replaceChildren();
  state.searchResults.forEach((location, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `search-result-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === state.activeResult));

    const text = document.createElement("span");
    const name = document.createElement("span");
    const region = document.createElement("span");
    name.className = "result-name";
    name.textContent = location.name;
    region.className = "result-region";
    region.textContent = locationRegion(location) || formatCoordinates(location);
    text.append(name, region);

    const country = document.createElement("span");
    country.className = "result-country";
    country.textContent = location.country_code || "PLACE";
    button.append(text, country);
    button.addEventListener("click", () => selectLocation(location));
    elements.searchResults.append(button);
  });
  elements.searchResults.hidden = false;
  elements.citySearch.setAttribute("aria-expanded", "true");
  updateActiveSearchResult();
}

function updateActiveSearchResult() {
  const options = elements.searchResults.querySelectorAll("[role='option']");
  options.forEach((option, index) => {
    option.setAttribute("aria-selected", String(index === state.activeResult));
  });
  if (state.activeResult >= 0 && options[state.activeResult]) {
    const active = options[state.activeResult];
    elements.citySearch.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  } else {
    elements.citySearch.removeAttribute("aria-activedescendant");
  }
}

function showSearchMessage(message) {
  state.searchResults = [];
  state.activeResult = -1;
  const paragraph = document.createElement("p");
  paragraph.className = "search-message";
  paragraph.textContent = message;
  elements.searchResults.replaceChildren(paragraph);
  elements.searchResults.hidden = false;
  elements.citySearch.setAttribute("aria-expanded", "true");
  elements.citySearch.removeAttribute("aria-activedescendant");
}

function closeSearchResults() {
  elements.searchResults.hidden = true;
  elements.citySearch.setAttribute("aria-expanded", "false");
  elements.citySearch.removeAttribute("aria-activedescendant");
  state.activeResult = -1;
}

function setSearchBusy(busy) {
  elements.searchButton.disabled = busy;
  elements.searchButton.textContent = busy ? "Searching…" : "Search";
  elements.citySearch.setAttribute("aria-busy", String(busy));
}

function selectLocation(location) {
  const normalized = normalizeLocation(location);
  if (!normalized) return;
  closeSearchResults();
  elements.citySearch.value = "";
  hideNotice();
  state.location = normalized;
  writeJsonStorage(STORAGE.lastLocation, normalized);
  loadWeather(normalized);
}

async function loadWeather(location, announce = false) {
  if (!location) return;
  const sequence = ++state.weatherSequence;
  state.weatherController?.abort();
  state.weatherController = new AbortController();
  hideError();
  setLoading(true);

  try {
    const query = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      units: state.units
    });
    const payload = await fetchJson(`/api/weather?${query}`, {
      signal: state.weatherController.signal
    });
    if (sequence !== state.weatherSequence) return;
    if (!payload.current || !payload.hourly || !payload.daily) {
      throw new Error("The weather provider returned an incomplete forecast.");
    }
    state.weather = payload;
    state.location = normalizeLocation(location);
    writeJsonStorage(STORAGE.lastLocation, state.location);
    renderWeather(payload);
    hideNotice();
    if (announce) showToast("Forecast updated.");
  } catch (error) {
    if (error.name === "AbortError" || sequence !== state.weatherSequence) return;
    showError(friendlyError(error));
  } finally {
    if (sequence === state.weatherSequence) setLoading(false);
  }
}

function setLoading(loading) {
  elements.weatherContent.setAttribute("aria-busy", String(loading));
  elements.loadingLine.hidden = !loading;
  elements.refreshButton.disabled = loading;
  elements.locateButton.disabled = loading || state.locating;
  elements.saveButton.disabled = loading || !state.location;
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorState.hidden = false;
  elements.weatherContent.hidden = true;
  elements.loadingLine.hidden = true;
}

function hideError() {
  elements.errorState.hidden = true;
  elements.weatherContent.hidden = false;
}

function changeUnits(units) {
  if (units === state.units) return;
  state.units = units;
  writeStorage(STORAGE.units, units);
  updateUnitButtons();
  if (state.location) loadWeather(state.location);
}

function updateUnitButtons() {
  [["metric", elements.unitMetric], ["imperial", elements.unitImperial]].forEach(([units, button]) => {
    if (button) button.setAttribute("aria-pressed", String(state.units === units));
  });
}

function useCurrentLocation() {
  hideNotice();
  if (!navigator.geolocation) {
    showNotice("This browser does not support location lookup. Search for your city instead.");
    return;
  }
  state.locating = true;
  elements.locateButton.disabled = true;
  elements.locateButton.querySelector("span").textContent = "Locating…";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      resetLocationButton();
      selectLocation({
        id: `geo:${latitude.toFixed(4)},${longitude.toFixed(4)}`,
        name: "Current location",
        admin1: formatCoordinates({ latitude, longitude }),
        country: "",
        country_code: "YOU",
        latitude,
        longitude
      });
    },
    (error) => {
      resetLocationButton();
      const messages = {
        1: "Location permission was denied. Allow access in your browser or search for a city.",
        2: "Your location is unavailable right now. Search for a city instead.",
        3: "Location lookup timed out. Please try again or search for a city."
      };
      showNotice(messages[error.code] || "Could not determine your location. Search for a city instead.");
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
}

function resetLocationButton() {
  state.locating = false;
  elements.locateButton.disabled = false;
  elements.locateButton.querySelector("span").textContent = "Use my location";
}

function toggleSavedLocation() {
  if (!state.location) return;
  const key = locationKey(state.location);
  const existing = state.saved.findIndex((location) => locationKey(location) === key);
  if (existing >= 0) {
    state.saved.splice(existing, 1);
    showToast("Place removed from this browser.");
  } else {
    state.saved.unshift({ ...state.location });
    state.saved = state.saved.slice(0, 5);
    showToast("Place saved in this browser.");
  }
  writeJsonStorage(STORAGE.saved, state.saved);
  renderSavedLocations();
  updateSaveButton();
}

function removeSavedLocation(key) {
  state.saved = state.saved.filter((location) => locationKey(location) !== key);
  writeJsonStorage(STORAGE.saved, state.saved);
  renderSavedLocations();
  updateSaveButton();
  showToast("Saved place removed.");
}

function renderSavedLocations() {
  elements.savedList.replaceChildren();
  elements.savedSection.hidden = state.saved.length === 0;
  state.saved.forEach((location) => {
    const key = locationKey(location);
    const wrapper = document.createElement("div");
    wrapper.className = "saved-place";
    if (state.location && locationKey(state.location) === key) wrapper.classList.add("is-active");

    const load = document.createElement("button");
    load.type = "button";
    load.className = "saved-place-load";
    load.textContent = location.name;
    load.setAttribute("aria-label", `Load forecast for ${location.name}, ${locationRegion(location)}`);
    load.addEventListener("click", () => selectLocation(location));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "saved-place-remove";
    remove.setAttribute("aria-label", `Remove ${location.name} from saved places`);
    remove.innerHTML = '<svg aria-hidden="true"><use href="#icon-close"/></svg>';
    remove.addEventListener("click", () => removeSavedLocation(key));
    wrapper.append(load, remove);
    elements.savedList.append(wrapper);
  });
}

function updateSaveButton() {
  if (!elements.saveButton) return;
  const saved = state.location && state.saved.some((location) => locationKey(location) === locationKey(state.location));
  elements.saveButton.setAttribute("aria-pressed", String(Boolean(saved)));
  elements.saveButton.disabled = !state.location;
  elements.saveButtonLabel.textContent = saved ? "Saved" : "Save place";
  elements.saveIconUse.setAttribute("href", saved ? "#icon-bookmark-fill" : "#icon-bookmark");
}

function renderWeather(data) {
  const current = data.current;
  const units = data.current_units || {};
  const daily = data.daily;
  const condition = weatherDescription(current.weather_code);
  const temperatureUnit = units.temperature_2m || (state.units === "metric" ? "°C" : "°F");
  const speedUnit = units.wind_speed_10m || (state.units === "metric" ? "km/h" : "mph");

  text(elements.currentDate, formatLocalDate(current.time));
  text(elements.locationName, state.location.name);
  text(elements.locationRegion, locationRegion(state.location) || formatCoordinates(state.location));
  text(elements.currentTemp, rounded(current.temperature_2m));
  text(elements.currentTempUnit, temperatureUnit);
  text(elements.currentCondition, condition);
  elements.currentIconUse.setAttribute("href", `#${weatherIcon(current.weather_code, current.is_day)}`);
  elements.currentPanel.classList.toggle("is-night", Number(current.is_day) === 0);

  const high = rounded(daily.temperature_2m_max?.[0]);
  const low = rounded(daily.temperature_2m_min?.[0]);
  const direction = windDirection(current.wind_direction_10m);
  text(elements.currentSummary, `Today’s high ${high}° · Low ${low}° · ${direction} wind at ${rounded(current.wind_speed_10m)} ${speedUnit}.`);
  text(elements.updatedTime, `${formatTime(current.time)} local`);
  text(elements.metricFeels, `${rounded(current.apparent_temperature)}°`);
  text(elements.metricHumidity, percent(current.relative_humidity_2m));
  text(elements.metricWind, `${rounded(current.wind_speed_10m)} ${speedUnit} ${direction}`);
  text(elements.metricGusts, `${rounded(current.wind_gusts_10m)} ${speedUnit}`);
  text(elements.metricPrecipitation, `${decimal(current.precipitation)} ${units.precipitation || "mm"}`);
  text(elements.metricPressure, `${rounded(current.pressure_msl)} ${units.pressure_msl || "hPa"}`);
  text(elements.metricCloud, percent(current.cloud_cover));

  const uv = daily.uv_index_max?.[0];
  text(elements.metricUv, isNumber(uv) ? `${decimal(uv)} · ${uvDescription(uv)}` : "—");
  text(elements.sunriseTime, formatTime(daily.sunrise?.[0]));
  text(elements.sunsetTime, formatTime(daily.sunset?.[0]));
  text(elements.hourlyCaption, `Local time · ${String(data.timezone || "forecast location").replaceAll("_", " ")}`);

  renderHourlyForecast(data);
  renderDailyForecast(data);
  renderSavedLocations();
  updateSaveButton();
  document.title = `${rounded(current.temperature_2m)}${temperatureUnit} · ${condition} in ${state.location.name} | Nimbus`;
}

function renderHourlyForecast(data) {
  const hourly = data.hourly;
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  let start = times.findIndex((time) => time === data.current.time);
  if (start < 0) {
    start = times.reduce((latest, time, index) => time <= data.current.time ? index : latest, 0);
  }

  elements.hourlyList.replaceChildren();
  times.slice(start, start + 24).forEach((time, offset) => {
    const index = start + offset;
    const code = hourly.weather_code?.[index];
    const temperature = rounded(hourly.temperature_2m?.[index]);
    const precipitation = rounded(hourly.precipitation_probability?.[index]);
    const item = document.createElement("li");
    item.className = "hour-item";
    if (offset === 0) item.classList.add("is-now");
    item.setAttribute("aria-label", `${offset === 0 ? "Current hour" : formatHour(time)}, ${weatherDescription(code)}, ${temperature} degrees, ${precipitation} percent chance of precipitation`);

    const hour = document.createElement("span");
    hour.className = "hour-time";
    hour.textContent = offset === 0 ? "NOW" : formatHour(time);
    const icon = makeWeatherIcon(code, hourly.is_day?.[index], "hour-icon");
    const temp = document.createElement("span");
    temp.className = "hour-temp";
    temp.textContent = `${temperature}°`;
    const rain = document.createElement("span");
    rain.className = "hour-precipitation";
    rain.textContent = `${precipitation}% precip.`;
    item.append(hour, icon, temp, rain);
    elements.hourlyList.append(item);
  });
  if (elements.hourlyScroll) elements.hourlyScroll.scrollLeft = 0;
}

function renderDailyForecast(data) {
  const daily = data.daily;
  const days = Array.isArray(daily.time) ? daily.time.slice(0, 7) : [];
  const lows = (daily.temperature_2m_min || []).filter(isNumber);
  const highs = (daily.temperature_2m_max || []).filter(isNumber);
  const weekLow = lows.length ? Math.min(...lows) : 0;
  const weekHigh = highs.length ? Math.max(...highs) : 1;
  const span = weekHigh - weekLow || 1;

  elements.dailyList.replaceChildren();
  days.forEach((date, index) => {
    const code = daily.weather_code?.[index];
    const low = daily.temperature_2m_min?.[index];
    const high = daily.temperature_2m_max?.[index];
    const precipitation = rounded(daily.precipitation_probability_max?.[index]);
    const row = document.createElement("li");
    row.className = "daily-row";

    const day = document.createElement("div");
    day.className = "daily-day";
    const dayName = document.createElement("strong");
    dayName.textContent = index === 0 ? "Today" : formatWeekday(date);
    const fullDate = document.createElement("span");
    fullDate.textContent = formatShortDate(date);
    day.append(dayName, fullDate);

    const condition = document.createElement("div");
    condition.className = "daily-condition";
    const conditionText = document.createElement("span");
    conditionText.textContent = weatherDescription(code);
    condition.append(makeWeatherIcon(code, 1), conditionText);

    const rain = document.createElement("span");
    rain.className = "daily-precip";
    rain.textContent = `${precipitation}% precip.`;

    const range = document.createElement("span");
    range.className = "daily-range";
    range.setAttribute("aria-hidden", "true");
    const rangeFill = document.createElement("span");
    if (isNumber(low) && isNumber(high)) {
      rangeFill.style.setProperty("--range-start", `${((low - weekLow) / span) * 100}%`);
      rangeFill.style.setProperty("--range-width", `${Math.max(3, ((high - low) / span) * 100)}%`);
    } else {
      range.hidden = true;
    }
    range.append(rangeFill);

    const temperatures = document.createElement("div");
    temperatures.className = "daily-temperatures";
    const lowText = document.createElement("span");
    lowText.className = "daily-low";
    lowText.textContent = `${rounded(low)}°`;
    lowText.setAttribute("aria-label", `Low ${rounded(low)} degrees`);
    const highText = document.createElement("span");
    highText.className = "daily-high";
    highText.textContent = `${rounded(high)}°`;
    highText.setAttribute("aria-label", `High ${rounded(high)} degrees`);
    temperatures.append(lowText, highText);

    row.append(day, condition, rain, range, temperatures);
    elements.dailyList.append(row);
  });
}

function makeWeatherIcon(code, isDay, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${weatherIcon(code, isDay)}`);
  svg.append(use);
  return svg;
}

function weatherDescription(code) {
  const descriptions = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
    55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Dense freezing drizzle",
    61: "Light rain", 63: "Moderate rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Heavy freezing rain", 71: "Light snowfall",
    73: "Moderate snowfall", 75: "Heavy snowfall", 77: "Snow grains",
    80: "Light rain showers", 81: "Moderate rain showers", 82: "Heavy rain showers",
    85: "Light snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
    96: "Thunderstorm with light hail", 99: "Thunderstorm with heavy hail"
  };
  return descriptions[Number(code)] || "Conditions unavailable";
}

function weatherIcon(code, isDay) {
  const value = Number(code);
  const day = Number(isDay) === 1;
  if (value === 0 || value === 1) return day ? "weather-clear-day" : "weather-clear-night";
  if (value === 2) return day ? "weather-partly-day" : "weather-partly-night";
  if (value === 3) return "weather-cloudy";
  if ([45, 48].includes(value)) return "weather-fog";
  if ([51, 53, 55, 56, 57].includes(value)) return "weather-drizzle";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "weather-snow";
  if ([95, 96, 99].includes(value)) return "weather-storm";
  return "weather-rain";
}

function uvDescription(value) {
  if (value < 3) return "Low";
  if (value < 6) return "Moderate";
  if (value < 8) return "High";
  if (value < 11) return "Very high";
  return "Extreme";
}

function windDirection(degrees) {
  if (!isNumber(degrees)) return "Variable";
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(degrees / 22.5) % 16];
}

function formatLocalDate(iso) {
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "LOCAL CONDITIONS";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function formatWeekday(iso) {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

function formatShortDate(iso) {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

function formatTime(iso) {
  const value = String(iso || "");
  return value.includes("T") ? value.split("T")[1].slice(0, 5) : "--:--";
}

function formatHour(iso) {
  const time = formatTime(iso);
  if (time === "--:--") return "—";
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hour, minute));
}

function locationRegion(location) {
  return [...new Set([location.admin1, location.country].filter(Boolean))].join(", ");
}

function formatCoordinates(location) {
  return `${Number(location.latitude).toFixed(3)}°, ${Number(location.longitude).toFixed(3)}°`;
}

function locationKey(location) {
  return String(location.id ?? `${Number(location.latitude).toFixed(4)},${Number(location.longitude).toFixed(4)}`);
}

function normalizeLocation(raw) {
  if (!raw || raw.latitude === undefined || raw.longitude === undefined) return null;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    id: raw.id ?? `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    name: String(raw.name || "Selected place"),
    admin1: String(raw.admin1 || ""),
    country: String(raw.country || ""),
    country_code: String(raw.country_code || ""),
    latitude,
    longitude
  };
}

function rounded(value) {
  return isNumber(value) ? Math.round(value) : "—";
}

function decimal(value) {
  return isNumber(value) ? Number(value).toFixed(1) : "—";
}

function percent(value) {
  return isNumber(value) ? `${Math.round(value)}%` : "—";
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function text(element, value) {
  if (element) element.textContent = String(value);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) }
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok ? "The server returned an unreadable response." : `Request failed with HTTP ${response.status}.`);
  }
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
  return payload;
}

function friendlyError(error) {
  if (error instanceof TypeError) return "Could not connect to Nimbus. Check your connection and try again.";
  return error.message || "Something went wrong. Please try again.";
}

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.hidden = false;
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = "";
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  state.toastTimer = window.setTimeout(() => { elements.toast.textContent = ""; }, 3200);
}

function readSavedLocations() {
  const saved = readJsonStorage(STORAGE.saved);
  return Array.isArray(saved) ? saved.map(normalizeLocation).filter(Boolean).slice(0, 5) : [];
}

function readStorage(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
}

function readJsonStorage(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

function writeJsonStorage(key, value) {
  writeStorage(key, JSON.stringify(value));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app remains fully usable when installation is unavailable.
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
