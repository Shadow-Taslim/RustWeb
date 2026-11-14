# 🦀 RustWeb - High-Performance Web Application

A full-stack, high-performance web application built with **Rust**, **Axum 0.8**, and **Tokio**. It includes a modern, responsive single-page web UI, thread-safe in-memory state management, and an interactive REST API playground.

![Rust Edition](https://img.shields.io/badge/Rust-2024%20Edition-orange?logo=rust)
![Axum](https://img.shields.io/badge/Axum-0.8.x-blue)
![Tokio](https://img.shields.io/badge/Tokio-1.54-purple)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 🌟 Key Features

- **Blazing Fast Backend**: Powered by Axum 0.8 and Tokio asynchronous multi-threaded runtime.
- **Self-Contained Executable**: Frontend assets (`HTML`, `CSS`, `JS`) are compiled directly into the binary with `include_str!`—zero runtime asset dependencies.
- **Concurrent State Management**: Safe in-memory data store using `Arc<tokio::sync::RwLock>` and atomic counters for thread-safe operations with zero data races.
- **Interactive Full-Stack Task App**: Add, toggle status, and delete tasks in real-time with priority tags.
- **Live Server Telemetry**: Real-time server latency measurement, uptime tracker, and request volume monitoring.
- **Built-in API Playground**: Execute and inspect real HTTP responses directly from the browser UI.

---

## 🚀 Quick Start

### Prerequisites
- [Rust toolchain](https://www.rust-lang.org/tools/install) (2024 edition supported)

### Running the Server

```bash
# Clone the repository
git clone https://github.com/Shadow-Taslim/RustWeb.git
cd RustWeb

# Run the web server
cargo run
```

Once running, open your browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the single-page web application |
| `GET` | `/api/health` | Returns server health, uptime, and stats |
| `GET` | `/api/ping` | Fast ping endpoint for latency measurement |
| `GET` | `/api/tasks` | Returns all tasks |
| `POST` | `/api/tasks` | Creates a new task (`{ "title": "...", "priority": "High" }`) |
| `PATCH` | `/api/tasks/{id}` | Toggles task completion state |
| `DELETE` | `/api/tasks/{id}` | Removes a task by ID |

---

## 🛠️ Project Structure

```
rust-web-api/
├── Cargo.toml          # Rust package configuration & dependencies
├── Cargo.lock          # Locked dependency graph
├── README.md           # Documentation
├── src/
│   └── main.rs         # Axum server, routing, handlers, state
└── static/
    └── index.html      # Responsive glassmorphism frontend & client JS
```

---

## 📜 License

This project is licensed under the MIT License.

