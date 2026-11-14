use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, patch},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use tokio::sync::RwLock;

// Embedded index.html at compile time
const INDEX_HTML: &str = include_str!("../static/index.html");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: u64,
    pub title: String,
    pub priority: String,
    pub completed: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateTask {
    pub title: String,
    #[serde(default = "default_priority")]
    pub priority: String,
}

fn default_priority() -> String {
    "Normal".to_string()
}

#[derive(Clone)]
pub struct AppState {
    pub tasks: Arc<RwLock<Vec<Task>>>,
    pub request_count: Arc<AtomicU64>,
    pub next_id: Arc<AtomicU64>,
    pub start_time: Instant,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub uptime_secs: u64,
    pub total_requests: u64,
    pub active_tasks: usize,
}

#[tokio::main]
async fn main() {
    let state = AppState {
        tasks: Arc::new(RwLock::new(vec![
            Task {
                id: 1,
                title: "Initialize Axum web server".to_string(),
                priority: "High".to_string(),
                completed: true,
            },
            Task {
                id: 2,
                title: "Build responsive dark-mode frontend".to_string(),
                priority: "Medium".to_string(),
                completed: true,
            },
            Task {
                id: 3,
                title: "Connect REST API endpoints to frontend".to_string(),
                priority: "High".to_string(),
                completed: false,
            },
        ])),
        request_count: Arc::new(AtomicU64::new(0)),
        next_id: Arc::new(AtomicU64::new(4)),
        start_time: Instant::now(),
    };

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/api/ping", get(ping))
        .route("/api/health", get(health_check))
        .route("/api/tasks", get(get_tasks).post(create_task))
        .route("/api/tasks/{id}", patch(toggle_task).delete(delete_task))
        .with_state(state);

    let addr = "127.0.0.1:3000";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener to port 3000");

    println!("🦀 Rust Web Server running at: http://{}", addr);
    println!("👉 Serving static frontend and REST API...");

    axum::serve(listener, app)
        .await
        .expect("Server encountered a fatal error");
}

async fn serve_index(State(state): State<AppState>) -> impl IntoResponse {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    Html(INDEX_HTML)
}

async fn ping(State(state): State<AppState>) -> impl IntoResponse {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    Json(serde_json::json!({
        "status": "pong",
        "timestamp_ms": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }))
}

async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let uptime = state.start_time.elapsed().as_secs();
    let requests = state.request_count.load(Ordering::Relaxed);
    let tasks_guard = state.tasks.read().await;

    Json(HealthResponse {
        status: "healthy",
        uptime_secs: uptime,
        total_requests: requests,
        active_tasks: tasks_guard.iter().filter(|t| !t.completed).count(),
    })
}

async fn get_tasks(State(state): State<AppState>) -> impl IntoResponse {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let tasks = state.tasks.read().await;
    Json((*tasks).clone())
}

async fn create_task(
    State(state): State<AppState>,
    Json(payload): Json<CreateTask>,
) -> impl IntoResponse {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let new_task = Task {
        id,
        title: payload.title,
        priority: payload.priority,
        completed: false,
    };

    let mut tasks = state.tasks.write().await;
    tasks.push(new_task.clone());
    (StatusCode::CREATED, Json(new_task))
}

async fn toggle_task(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Task>, StatusCode> {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let mut tasks = state.tasks.write().await;
    if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
        task.completed = !task.completed;
        Ok(Json(task.clone()))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn delete_task(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<StatusCode, StatusCode> {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let mut tasks = state.tasks.write().await;
    let initial_len = tasks.len();
    tasks.retain(|t| t.id != id);

    if tasks.len() < initial_len {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
