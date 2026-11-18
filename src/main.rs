use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{Query, State},
    http::{Request, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{env, net::SocketAddr, time::Instant};

const INDEX_HTML: &str = include_str!("../static/index.html");
const STYLES_CSS: &str = include_str!("../static/styles.css");
const APP_JS: &str = include_str!("../static/app.js");
const MANIFEST: &str = include_str!("../static/manifest.webmanifest");
const SERVICE_WORKER: &str = include_str!("../static/sw.js");
const ICON_SVG: &[u8] = include_bytes!("../static/icons/icon.svg");
const GEOCODING_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
const CURRENT_FIELDS: &str = "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m";
const HOURLY_FIELDS: &str = "temperature_2m,precipitation_probability,weather_code,is_day";
const DAILY_FIELDS: &str = "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max";

#[derive(Clone)]
struct AppState {
    client: Client,
    started: Instant,
}

#[derive(Debug, Deserialize)]
struct GeocodeQuery {
    q: String,
}

#[derive(Debug, Deserialize)]
struct WeatherQuery {
    latitude: f64,
    longitude: f64,
    units: Option<String>,
}

#[derive(Clone, Copy)]
enum Units {
    Metric,
    Imperial,
}

impl Units {
    fn parse(value: Option<&str>) -> Result<Self, ApiError> {
        match value.unwrap_or("metric") {
            "metric" => Ok(Self::Metric),
            "imperial" => Ok(Self::Imperial),
            _ => Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Units must be either 'metric' or 'imperial'.",
            )),
        }
    }

    fn parameters(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Metric => ("celsius", "kmh", "mm"),
            Self::Imperial => ("fahrenheit", "mph", "inch"),
        }
    }
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: &'static str,
}

impl ApiError {
    fn new(status: StatusCode, message: &'static str) -> Self {
        Self { status, message }
    }

    fn upstream() -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "The weather service is unavailable right now. Please try again shortly.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({ "error": self.message })),
        )
            .into_response()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3000);
    let address: SocketAddr = format!("{host}:{port}").parse()?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("NimbusWeather/1.0 (+https://github.com/Shadow-Taslim/RustWeb)")
        .build()?;
    let state = AppState {
        client,
        started: Instant::now(),
    };
    let listener = tokio::net::TcpListener::bind(address).await?;

    println!("Nimbus Weather is running at http://{address}");
    axum::serve(listener, build_app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn build_app(state: AppState) -> Router {
    Router::new()
        .route("/", get(serve_index))
        .route("/static/styles.css", get(serve_styles))
        .route("/static/app.js", get(serve_javascript))
        .route("/static/manifest.webmanifest", get(serve_manifest))
        .route("/sw.js", get(serve_service_worker))
        .route("/static/sw.js", get(serve_service_worker))
        .route("/static/icons/icon.svg", get(serve_icon))
        .route("/api/health", get(health))
        .route("/api/geocode", get(geocode))
        .route("/api/weather", get(weather))
        .fallback(not_found)
        .with_state(state)
        .layer(middleware::from_fn(security_headers))
}

async fn serve_index() -> Html<&'static str> {
    Html(INDEX_HTML)
}

async fn serve_styles() -> Response {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        STYLES_CSS,
    )
        .into_response()
}

async fn serve_javascript() -> Response {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        APP_JS,
    )
        .into_response()
}

async fn serve_manifest() -> Response {
    (
        [(
            header::CONTENT_TYPE,
            "application/manifest+json; charset=utf-8",
        )],
        MANIFEST,
    )
        .into_response()
}

async fn serve_service_worker() -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        SERVICE_WORKER,
    )
        .into_response()
}

async fn serve_icon() -> Response {
    (
        [(header::CONTENT_TYPE, "image/svg+xml")],
        Bytes::from_static(ICON_SVG),
    )
        .into_response()
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": "Nimbus Weather",
        "uptime_seconds": state.started.elapsed().as_secs()
    }))
}

async fn geocode(
    State(state): State<AppState>,
    Query(query): Query<GeocodeQuery>,
) -> Result<Response, ApiError> {
    let search = validate_search(&query.q)?;
    let response = state
        .client
        .get(GEOCODING_URL)
        .query(&[
            ("name", search.as_str()),
            ("count", "6"),
            ("language", "en"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|error| {
            eprintln!("Geocoding request failed: {}", error.without_url());
            ApiError::upstream()
        })?;

    let payload = upstream_json(response).await?;
    Ok((
        [(header::CACHE_CONTROL, "public, max-age=86400")],
        Json(payload),
    )
        .into_response())
}

async fn weather(
    State(state): State<AppState>,
    Query(query): Query<WeatherQuery>,
) -> Result<Response, ApiError> {
    validate_coordinates(query.latitude, query.longitude)?;
    let units = Units::parse(query.units.as_deref())?;
    let (temperature_unit, wind_speed_unit, precipitation_unit) = units.parameters();
    let latitude = query.latitude.to_string();
    let longitude = query.longitude.to_string();
    let response = state
        .client
        .get(FORECAST_URL)
        .query(&[
            ("latitude", latitude.as_str()),
            ("longitude", longitude.as_str()),
            ("current", CURRENT_FIELDS),
            ("hourly", HOURLY_FIELDS),
            ("daily", DAILY_FIELDS),
            ("timezone", "auto"),
            ("forecast_days", "7"),
            ("temperature_unit", temperature_unit),
            ("wind_speed_unit", wind_speed_unit),
            ("precipitation_unit", precipitation_unit),
        ])
        .send()
        .await
        .map_err(|error| {
            eprintln!("Forecast request failed: {}", error.without_url());
            ApiError::upstream()
        })?;

    let payload = upstream_json(response).await?;
    Ok((
        [(header::CACHE_CONTROL, "public, max-age=60")],
        Json(payload),
    )
        .into_response())
}

async fn upstream_json(response: reqwest::Response) -> Result<Value, ApiError> {
    if !response.status().is_success() {
        eprintln!("Weather provider returned HTTP {}", response.status());
        return Err(ApiError::upstream());
    }

    response.json::<Value>().await.map_err(|error| {
        eprintln!("Invalid weather provider response: {}", error.without_url());
        ApiError::upstream()
    })
}

fn validate_search(value: &str) -> Result<String, ApiError> {
    let search = value.trim();
    let length = search.chars().count();
    if !(2..=80).contains(&length) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Enter between 2 and 80 characters to search for a place.",
        ));
    }
    if search.chars().any(char::is_control) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "The search contains unsupported characters.",
        ));
    }
    Ok(search.to_owned())
}

fn validate_coordinates(latitude: f64, longitude: f64) -> Result<(), ApiError> {
    if !latitude.is_finite()
        || !longitude.is_finite()
        || !(-90.0..=90.0).contains(&latitude)
        || !(-180.0..=180.0).contains(&longitude)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "A valid latitude and longitude are required.",
        ));
    }
    Ok(())
}

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "The requested resource was not found." })),
    )
}

async fn security_headers(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(
        header::REFERRER_POLICY,
        "strict-origin-when-cross-origin".parse().unwrap(),
    );
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
            .parse()
            .unwrap(),
    );
    response
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state() -> AppState {
        AppState {
            client: Client::new(),
            started: Instant::now(),
        }
    }

    #[test]
    fn search_validation_trims_and_checks_length() {
        assert_eq!(validate_search("  London  ").unwrap(), "London");
        assert!(validate_search("L").is_err());
        assert!(validate_search(&"x".repeat(81)).is_err());
        assert!(validate_search("bad\nquery").is_err());
    }

    #[test]
    fn coordinate_validation_rejects_invalid_values() {
        assert!(validate_coordinates(51.5, -0.12).is_ok());
        assert!(validate_coordinates(91.0, 0.0).is_err());
        assert!(validate_coordinates(0.0, -181.0).is_err());
        assert!(validate_coordinates(f64::NAN, 0.0).is_err());
    }

    #[test]
    fn units_map_to_provider_parameters() {
        assert_eq!(
            Units::parse(Some("metric")).unwrap().parameters(),
            ("celsius", "kmh", "mm")
        );
        assert_eq!(
            Units::parse(Some("imperial")).unwrap().parameters(),
            ("fahrenheit", "mph", "inch")
        );
        assert!(Units::parse(Some("kelvin")).is_err());
    }

    #[tokio::test]
    async fn health_and_static_shell_are_served() {
        let app = build_app(test_state());
        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        let body = health.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "ok");

        let index = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(index.status(), StatusCode::OK);
        let body = index.into_body().collect().await.unwrap().to_bytes();
        assert!(String::from_utf8_lossy(&body).contains("Nimbus"));
    }

    #[tokio::test]
    async fn invalid_requests_fail_before_calling_provider() {
        let app = build_app(test_state());
        for uri in [
            "/api/geocode?q=L",
            "/api/weather?latitude=91&longitude=0",
            "/api/weather?latitude=0&longitude=0&units=kelvin",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "URI: {uri}");
        }
    }
}
