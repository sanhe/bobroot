use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Serialize)]
struct CommandError {
    message: String,
    kind: String,
}

impl CommandError {
    fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }
}

impl From<io::Error> for CommandError {
    fn from(value: io::Error) -> Self {
        Self::new(value.kind().to_string(), value.to_string())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("serialization", value.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_file: bool,
    is_symlink: bool,
    is_hidden: bool,
    size: Option<u64>,
    modified: Option<u64>,
    extension: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    path: String,
    parent: Option<String>,
    show_hidden_files: bool,
    entries: Vec<FileEntry>,
}

#[derive(Debug, Serialize)]
struct OperationItemResult {
    source: String,
    destination: Option<String>,
    status: String,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
struct OperationReport {
    results: Vec<OperationItemResult>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ConflictStrategy {
    Replace,
    Skip,
    Rename,
}

#[derive(Debug)]
struct ResolvedTarget {
    path: PathBuf,
    replace_existing: bool,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionData {
    left: PanelSession,
    right: PanelSession,
    active_panel: Option<String>,
    show_hidden_files: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    visibility: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_property_visibility: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_appearance: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_playback: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    right_panel_visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    panel_split: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_height: Option<u32>,
    window: Option<WindowSession>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelSession {
    tabs: Vec<TabSession>,
    active_tab_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabSession {
    id: String,
    path: String,
    selected_paths: Vec<String>,
    history: Vec<String>,
    history_index: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowSession {
    width: u32,
    height: u32,
    x: Option<i32>,
    y: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionLogLine {
    timestamp: u64,
    action: String,
    details: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCommandResult {
    cwd: String,
    command: String,
    stdout: String,
    stderr: String,
    status: Option<i32>,
    duration_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    session_id: String,
    data: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    session_id: String,
    status: Option<u32>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProcessStartRequest {
    provider_id: String,
    label: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCommandRequest {
    provider_id: String,
    label: String,
    command: String,
    args: Vec<String>,
    cwd: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentCommandResult {
    provider_id: String,
    label: String,
    stdout: String,
    stderr: String,
    status: Option<i32>,
    success: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentOutputPayload {
    session_id: String,
    provider_id: String,
    data: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentExitPayload {
    session_id: String,
    provider_id: String,
    status: Option<u32>,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentEventPayload {
    session_id: String,
    provider_id: String,
    level: String,
    message: String,
    timestamp: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryChangedPayload {
    path: String,
}

struct DirectoryWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_dirs: Arc<Mutex<HashSet<PathBuf>>>,
    initialization_error: Option<String>,
}

impl DirectoryWatcherState {
    fn new(app: AppHandle) -> Self {
        let watched_dirs = Arc::new(Mutex::new(HashSet::new()));
        let event_watched_dirs = Arc::clone(&watched_dirs);
        let watcher_result = RecommendedWatcher::new(
            move |result: notify::Result<Event>| {
                if let Ok(event) = result {
                    emit_directory_changed_events(&app, &event_watched_dirs, event.paths);
                }
            },
            Config::default(),
        );

        match watcher_result {
            Ok(watcher) => Self {
                watcher: Mutex::new(Some(watcher)),
                watched_dirs,
                initialization_error: None,
            },
            Err(error) => Self {
                watcher: Mutex::new(None),
                watched_dirs,
                initialization_error: Some(error.to_string()),
            },
        }
    }
}

#[derive(Clone)]
struct TerminalSessions {
    inner: Arc<TerminalSessionsInner>,
}

struct TerminalSessionsInner {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Default for TerminalSessions {
    fn default() -> Self {
        Self {
            inner: Arc::new(TerminalSessionsInner {
                next_id: AtomicU64::new(1),
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }
}

#[derive(Clone)]
struct AgentProcessSessions {
    inner: Arc<AgentProcessSessionsInner>,
}

struct AgentProcessSessionsInner {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, AgentProcessSession>>,
}

struct AgentProcessSession {
    provider_id: String,
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Default for AgentProcessSessions {
    fn default() -> Self {
        Self {
            inner: Arc::new(AgentProcessSessionsInner {
                next_id: AtomicU64::new(1),
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }
}

#[tauri::command]
fn home_dir() -> CommandResult<String> {
    dirs_next::home_dir()
        .map(path_to_string)
        .ok_or_else(|| CommandError::new("not_found", "Could not determine the home directory"))
}

#[tauri::command]
fn list_directory(path: String, show_hidden_files: bool) -> CommandResult<DirectoryListing> {
    let requested = normalize_input_path(&path)?;
    let canonical = requested.canonicalize().map_err(|error| {
        CommandError::new(
            error.kind().to_string(),
            format!("Cannot open '{}': {}", requested.display(), error),
        )
    })?;

    if !canonical.is_dir() {
        return Err(CommandError::new(
            "not_directory",
            format!("'{}' is not a folder", canonical.display()),
        ));
    }

    let mut entries = Vec::new();
    for entry_result in fs::read_dir(&canonical)? {
        let entry = entry_result?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let metadata = fs::symlink_metadata(&path)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_hidden = is_hidden_entry(&name, &metadata);

        if is_hidden && !show_hidden_files {
            continue;
        }

        entries.push(FileEntry {
            name,
            path: path_to_string(path.clone()),
            is_dir: file_type.is_dir(),
            is_file: file_type.is_file(),
            is_symlink: file_type.is_symlink(),
            is_hidden,
            size: if file_type.is_file() {
                Some(metadata.len())
            } else {
                None
            },
            modified: metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64),
            extension: path
                .extension()
                .and_then(OsStr::to_str)
                .map(|extension| extension.to_lowercase()),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirectoryListing {
        parent: canonical
            .parent()
            .map(|parent| path_to_string(parent.to_path_buf())),
        path: path_to_string(canonical),
        show_hidden_files,
        entries,
    })
}

#[tauri::command]
fn watch_directories(
    state: State<'_, DirectoryWatcherState>,
    paths: Vec<String>,
) -> CommandResult<Vec<String>> {
    if let Some(error) = &state.initialization_error {
        return Err(CommandError::new("watch_failed", error.clone()));
    }

    let next_dirs = canonical_directory_set(paths)?;
    let mut watcher_guard = state
        .watcher
        .lock()
        .map_err(|_| CommandError::new("watcher_state", "Directory watcher is unavailable"))?;
    let watcher = watcher_guard
        .as_mut()
        .ok_or_else(|| CommandError::new("watch_failed", "Directory watcher is unavailable"))?;
    let mut watched_dirs = state
        .watched_dirs
        .lock()
        .map_err(|_| CommandError::new("watcher_state", "Directory watcher is unavailable"))?;
    let current_dirs = watched_dirs.clone();

    for dir in current_dirs.difference(&next_dirs) {
        let _ = watcher.unwatch(dir);
    }

    for dir in next_dirs.difference(&current_dirs) {
        watcher
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(directory_watch_error)?;
    }

    *watched_dirs = next_dirs.clone();

    Ok(next_dirs.into_iter().map(path_to_string).collect())
}

#[tauri::command]
fn copy_items(
    items: Vec<String>,
    destination_dir: String,
    conflict_strategy: ConflictStrategy,
) -> CommandResult<OperationReport> {
    let destination_dir = normalize_input_path(&destination_dir)?;
    ensure_directory(&destination_dir)?;
    let mut results = Vec::new();

    for item in items {
        results.push(match copy_one(&item, &destination_dir, conflict_strategy) {
            Ok(result) => result,
            Err(error) => OperationItemResult {
                source: item,
                destination: None,
                status: "error".to_string(),
                message: Some(error.message),
            },
        });
    }

    Ok(OperationReport { results })
}

#[tauri::command]
fn move_items(
    items: Vec<String>,
    destination_dir: String,
    conflict_strategy: ConflictStrategy,
) -> CommandResult<OperationReport> {
    let destination_dir = normalize_input_path(&destination_dir)?;
    ensure_directory(&destination_dir)?;
    let mut results = Vec::new();

    for item in items {
        results.push(match move_one(&item, &destination_dir, conflict_strategy) {
            Ok(result) => result,
            Err(error) => OperationItemResult {
                source: item,
                destination: None,
                status: "error".to_string(),
                message: Some(error.message),
            },
        });
    }

    Ok(OperationReport { results })
}

#[tauri::command]
fn move_to_trash(items: Vec<String>) -> CommandResult<OperationReport> {
    let mut results = Vec::new();

    for item in items {
        let source = normalize_input_path(&item)?;
        let result = match trash::delete(&source) {
            Ok(()) => OperationItemResult {
                source: path_to_string(source),
                destination: None,
                status: "trashed".to_string(),
                message: None,
            },
            Err(error) => OperationItemResult {
                source: item,
                destination: None,
                status: "error".to_string(),
                message: Some(error.to_string()),
            },
        };
        results.push(result);
    }

    Ok(OperationReport { results })
}

#[tauri::command]
fn permanently_delete(items: Vec<String>) -> CommandResult<OperationReport> {
    let mut results = Vec::new();

    for item in items {
        let source = normalize_input_path(&item)?;
        let result = remove_existing(&source)
            .map(|_| OperationItemResult {
                source: path_to_string(source),
                destination: None,
                status: "deleted".to_string(),
                message: None,
            })
            .unwrap_or_else(|error| OperationItemResult {
                source: item,
                destination: None,
                status: "error".to_string(),
                message: Some(error.message),
            });
        results.push(result);
    }

    Ok(OperationReport { results })
}

#[tauri::command]
fn open_path(path: String) -> CommandResult<()> {
    let path = normalize_input_path(&path)?;
    open::that(&path).map_err(|error| {
        CommandError::new(
            "open_failed",
            format!("Could not open '{}': {}", path.display(), error),
        )
    })
}

#[tauri::command]
fn open_path_with_player(path: String, player: String) -> CommandResult<()> {
    let path = normalize_input_path(&path)?;
    if !path_exists(&path)? {
        return Err(CommandError::new(
            "not_found",
            format!("'{}' does not exist", path.display()),
        ));
    }

    let player = player.trim();
    if player.is_empty() {
        return Err(CommandError::new(
            "invalid_player",
            "Choose an audio player before opening this file",
        ));
    }
    if player.contains('\0') {
        return Err(CommandError::new(
            "invalid_player",
            "Audio player cannot contain null bytes",
        ));
    }

    open_path_with_player_platform(&path, player)
}

#[tauri::command]
fn open_external_url(url: String) -> CommandResult<()> {
    let url = url.trim();
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(CommandError::new(
            "invalid_url",
            "Only http and https URLs can be opened",
        ));
    }

    open::that(url).map_err(|error| {
        CommandError::new(
            "open_failed",
            format!("Could not open authorization URL: {}", error),
        )
    })
}

#[tauri::command]
fn preview_path(path: String) -> CommandResult<()> {
    let path = normalize_input_path(&path)?;
    if !path_exists(&path)? {
        return Err(CommandError::new(
            "not_found",
            format!("'{}' does not exist", path.display()),
        ));
    }

    preview_platform_path(&path)
}

#[tauri::command]
fn reveal_path(path: String) -> CommandResult<()> {
    let path = normalize_input_path(&path)?;
    if !path_exists(&path)? {
        return Err(CommandError::new(
            "not_found",
            format!("'{}' does not exist", path.display()),
        ));
    }

    reveal_platform_path(&path)
}

#[tauri::command]
fn rename_item(path: String, new_name: String) -> CommandResult<String> {
    let source = normalize_input_path(&path)?;
    let trimmed_name = new_name.trim();
    if !is_valid_entry_name(trimmed_name) {
        return Err(CommandError::new(
            "invalid_name",
            "Enter a valid file or folder name",
        ));
    }

    let parent = source.parent().ok_or_else(|| {
        CommandError::new(
            "invalid_path",
            format!("Cannot rename '{}'", source.display()),
        )
    })?;
    let destination = parent.join(trimmed_name);
    if destination.exists() {
        return Err(CommandError::new(
            "already_exists",
            format!("'{}' already exists", destination.display()),
        ));
    }

    fs::rename(&source, &destination)?;
    Ok(path_to_string(destination))
}

#[tauri::command]
fn create_folder(parent_dir: String, name: String) -> CommandResult<String> {
    let parent = normalize_input_path(&parent_dir)?;
    ensure_directory(&parent)?;

    let trimmed_name = name.trim();
    if !is_valid_entry_name(trimmed_name) {
        return Err(CommandError::new(
            "invalid_name",
            "Enter a valid folder name",
        ));
    }

    let destination = parent.join(trimmed_name);
    if destination.exists() {
        return Err(CommandError::new(
            "already_exists",
            format!("'{}' already exists", destination.display()),
        ));
    }

    fs::create_dir(&destination)?;
    Ok(path_to_string(destination))
}

#[tauri::command]
fn run_terminal_command(command: String, cwd: String) -> CommandResult<TerminalCommandResult> {
    let command = command.trim();
    if command.is_empty() {
        return Err(CommandError::new("invalid_command", "Command is required"));
    }

    let working_dir = resolve_existing_directory(&cwd)?;
    let started = Instant::now();
    let output = terminal_shell_command(command)
        .current_dir(&working_dir)
        .output()
        .map_err(|error| {
            CommandError::new(
                error.kind().to_string(),
                format!(
                    "Could not run command in '{}': {}",
                    working_dir.display(),
                    error
                ),
            )
        })?;

    Ok(TerminalCommandResult {
        cwd: path_to_string(working_dir),
        command: command.to_string(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        status: output.status.code(),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
fn start_terminal_session(
    app: AppHandle,
    state: State<'_, TerminalSessions>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> CommandResult<String> {
    let working_dir = resolve_existing_directory(&cwd)?;
    let size = terminal_size(cols, rows);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|error| terminal_pty_error("open_pty", error))?;

    let command = terminal_interactive_shell_command(&working_dir);
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| terminal_pty_error("spawn_shell", error))?;
    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| terminal_pty_error("clone_pty_reader", error))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| terminal_pty_error("open_pty_writer", error))?;

    let session_id = format!(
        "terminal-{}",
        state.inner.next_id.fetch_add(1, Ordering::Relaxed)
    );
    let session = TerminalSession {
        master: pair.master,
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
    };

    {
        let mut sessions = lock_terminal_sessions(&state.inner)?;
        sessions.insert(session_id.clone(), session);
    }

    let output_session_id = session_id.clone();
    let output_app = app.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let data = String::from_utf8_lossy(&buffer[..length]).into_owned();
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputPayload {
                            session_id: output_session_id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let exit_session_id = session_id.clone();
    let exit_app = app;
    let sessions = state.inner.clone();
    thread::spawn(move || {
        let wait_result = child.wait();
        if let Ok(mut sessions) = sessions.sessions.lock() {
            sessions.remove(&exit_session_id);
        }

        let payload = match wait_result {
            Ok(status) => TerminalExitPayload {
                session_id: exit_session_id,
                status: Some(status.exit_code()),
                message: status.signal().map(ToOwned::to_owned),
            },
            Err(error) => TerminalExitPayload {
                session_id: exit_session_id,
                status: None,
                message: Some(error.to_string()),
            },
        };
        let _ = exit_app.emit("terminal-exit", payload);
    });

    Ok(session_id)
}

#[tauri::command]
fn write_terminal_data(
    state: State<'_, TerminalSessions>,
    session_id: String,
    data: String,
) -> CommandResult<()> {
    let mut sessions = lock_terminal_sessions(&state.inner)?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| CommandError::new("not_found", "Terminal session is not running"))?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| CommandError::new("terminal_state", "Terminal writer is unavailable"))?;
    writer.write_all(data.as_bytes())?;
    writer.flush()?;
    Ok(())
}

#[tauri::command]
fn resize_terminal_session(
    state: State<'_, TerminalSessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    let sessions = lock_terminal_sessions(&state.inner)?;
    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(terminal_size(cols, rows))
            .map_err(|error| terminal_pty_error("resize_pty", error))?;
    }
    Ok(())
}

#[tauri::command]
fn stop_terminal_session(
    state: State<'_, TerminalSessions>,
    session_id: String,
) -> CommandResult<()> {
    let session = {
        let mut sessions = lock_terminal_sessions(&state.inner)?;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        if let Ok(mut killer) = session.killer.lock() {
            let _ = killer.kill();
        }
    }

    Ok(())
}

#[tauri::command]
fn resolve_terminal_directory(cwd: String, target: String) -> CommandResult<String> {
    let working_dir = resolve_existing_directory(&cwd)?;
    let target = target.trim();
    let next_dir = if target.is_empty() {
        dirs_next::home_dir()
            .ok_or_else(|| CommandError::new("not_found", "Could not determine home directory"))?
    } else {
        expand_terminal_path(target, &working_dir)?
    };

    Ok(path_to_string(resolve_existing_directory_path(&next_dir)?))
}

#[tauri::command]
fn run_agent_command(request: AgentCommandRequest) -> CommandResult<AgentCommandResult> {
    let command_name = request.command.trim();
    if command_name.is_empty() {
        return Err(CommandError::new(
            "invalid_provider",
            "Provider command is required",
        ));
    }

    let provider_id = request.provider_id.trim();
    if provider_id.is_empty() {
        return Err(CommandError::new(
            "invalid_provider",
            "Provider id is required",
        ));
    }

    let working_dir = resolve_existing_directory(&request.cwd)?;
    let output = Command::new(command_name)
        .args(&request.args)
        .current_dir(&working_dir)
        .output()
        .map_err(|error| {
            CommandError::new(
                error.kind().to_string(),
                format!(
                    "Could not run provider command in '{}': {}",
                    working_dir.display(),
                    error
                ),
            )
        })?;

    Ok(AgentCommandResult {
        provider_id: provider_id.to_string(),
        label: request.label,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        status: output.status.code(),
        success: output.status.success(),
    })
}

#[tauri::command]
fn start_agent_process(
    app: AppHandle,
    state: State<'_, AgentProcessSessions>,
    request: AgentProcessStartRequest,
) -> CommandResult<String> {
    let command_name = request.command.trim();
    if command_name.is_empty() {
        return Err(CommandError::new(
            "invalid_provider",
            "Provider command is required",
        ));
    }

    let provider_id = request.provider_id.trim();
    if provider_id.is_empty() {
        return Err(CommandError::new(
            "invalid_provider",
            "Provider id is required",
        ));
    }

    let working_dir = resolve_existing_directory(&request.cwd)?;
    let size = terminal_size(request.cols, request.rows);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|error| terminal_pty_error("open_agent_pty", error))?;

    let mut command = CommandBuilder::new(command_name);
    command.args(&request.args);
    command.cwd(working_dir.as_os_str());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("BOBROOT_AGENT_PROVIDER", provider_id);
    command.env("BOBROOT_ACTIVE_FOLDER", working_dir.as_os_str());

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| terminal_pty_error("spawn_agent", error))?;
    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| terminal_pty_error("clone_agent_reader", error))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| terminal_pty_error("open_agent_writer", error))?;

    let session_id = format!(
        "agent-{}",
        state.inner.next_id.fetch_add(1, Ordering::Relaxed)
    );
    let session = AgentProcessSession {
        provider_id: provider_id.to_string(),
        master: pair.master,
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
    };

    {
        let mut sessions = lock_agent_process_sessions(&state.inner)?;
        sessions.insert(session_id.clone(), session);
    }

    emit_agent_event(
        &app,
        &session_id,
        provider_id,
        "info",
        &format!("Started {}", request.label.trim()),
    );

    let output_session_id = session_id.clone();
    let output_provider_id = provider_id.to_string();
    let output_app = app.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let data = String::from_utf8_lossy(&buffer[..length]).into_owned();
                    let _ = output_app.emit(
                        "agent-output",
                        AgentOutputPayload {
                            session_id: output_session_id.clone(),
                            provider_id: output_provider_id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let exit_session_id = session_id.clone();
    let exit_provider_id = provider_id.to_string();
    let exit_app = app;
    let sessions = state.inner.clone();
    thread::spawn(move || {
        let wait_result = child.wait();
        if let Ok(mut sessions) = sessions.sessions.lock() {
            sessions.remove(&exit_session_id);
        }

        let payload = match wait_result {
            Ok(status) => AgentExitPayload {
                session_id: exit_session_id.clone(),
                provider_id: exit_provider_id.clone(),
                status: Some(status.exit_code()),
                message: status.signal().map(ToOwned::to_owned),
            },
            Err(error) => AgentExitPayload {
                session_id: exit_session_id.clone(),
                provider_id: exit_provider_id.clone(),
                status: None,
                message: Some(error.to_string()),
            },
        };
        let message = payload
            .message
            .clone()
            .unwrap_or_else(|| format!("Exited with {}", payload.status.unwrap_or_default()));
        emit_agent_event(
            &exit_app,
            &exit_session_id,
            &exit_provider_id,
            "info",
            &message,
        );
        let _ = exit_app.emit("agent-exit", payload);
    });

    Ok(session_id)
}

#[tauri::command]
fn write_agent_process_data(
    state: State<'_, AgentProcessSessions>,
    session_id: String,
    data: String,
) -> CommandResult<()> {
    let mut sessions = lock_agent_process_sessions(&state.inner)?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| CommandError::new("not_found", "Agent process is not running"))?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| CommandError::new("agent_state", "Agent writer is unavailable"))?;
    writer.write_all(data.as_bytes())?;
    writer.flush()?;
    Ok(())
}

#[tauri::command]
fn resize_agent_process(
    state: State<'_, AgentProcessSessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    let sessions = lock_agent_process_sessions(&state.inner)?;
    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(terminal_size(cols, rows))
            .map_err(|error| terminal_pty_error("resize_agent_pty", error))?;
    }
    Ok(())
}

#[tauri::command]
fn stop_agent_process(
    app: AppHandle,
    state: State<'_, AgentProcessSessions>,
    session_id: String,
) -> CommandResult<()> {
    let session = {
        let mut sessions = lock_agent_process_sessions(&state.inner)?;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        emit_agent_event(
            &app,
            &session_id,
            &session.provider_id,
            "info",
            "Stopped agent process",
        );
        if let Ok(mut killer) = session.killer.lock() {
            let _ = killer.kill();
        }
    }

    Ok(())
}

#[tauri::command]
fn load_session() -> CommandResult<Option<SessionData>> {
    let path = session_file_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&path)?;
    let session = serde_json::from_slice(&bytes)?;
    Ok(Some(session))
}

#[tauri::command]
fn save_session(session: SessionData) -> CommandResult<()> {
    let path = session_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let bytes = serde_json::to_vec_pretty(&session)?;
    fs::write(path, bytes)?;
    Ok(())
}

const ACTION_LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;

#[tauri::command]
fn append_action_log(action: String, details: serde_json::Value) -> CommandResult<()> {
    let action = action.trim();
    if action.is_empty() {
        return Err(CommandError::new(
            "invalid_action",
            "Action name is required",
        ));
    }

    let path = action_log_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    rotate_action_log_if_needed(&path)?;

    let line = ActionLogLine {
        timestamp: current_timestamp_millis(),
        action: action.to_string(),
        details,
    };
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    serde_json::to_writer(&mut file, &line)?;
    file.write_all(b"\n")?;
    Ok(())
}

fn rotate_action_log_if_needed(path: &Path) -> CommandResult<()> {
    let size = match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    if size < ACTION_LOG_MAX_BYTES {
        return Ok(());
    }

    let rotated = path.with_file_name(format!(
        "{}.1",
        path.file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("actions.jsonl"),
    ));
    if rotated.exists() {
        let _ = fs::remove_file(&rotated);
    }
    fs::rename(path, &rotated)?;
    Ok(())
}

fn copy_one(
    item: &str,
    destination_dir: &Path,
    conflict_strategy: ConflictStrategy,
) -> CommandResult<OperationItemResult> {
    let source = normalize_input_path(item)?;
    let metadata = fs::symlink_metadata(&source)?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(CommandError::new(
            "unsupported",
            format!("Unsupported filesystem item '{}'", source.display()),
        ));
    }

    let Some(target) = resolve_target(&source, destination_dir, conflict_strategy)? else {
        return Ok(OperationItemResult {
            source: path_to_string(source),
            destination: None,
            status: "skipped".to_string(),
            message: None,
        });
    };

    if target.replace_existing {
        prevent_replace_source(&source, &target.path)?;
    }

    if metadata.is_dir() {
        prevent_copy_into_self(&source, &target.path)?;
    }

    if target.replace_existing {
        remove_existing(&target.path)?;
    }

    if metadata.is_dir() {
        copy_dir_recursive(&source, &target.path)?;
    } else {
        fs::copy(&source, &target.path)?;
    }

    Ok(OperationItemResult {
        source: path_to_string(source),
        destination: Some(path_to_string(target.path)),
        status: "copied".to_string(),
        message: None,
    })
}

fn move_one(
    item: &str,
    destination_dir: &Path,
    conflict_strategy: ConflictStrategy,
) -> CommandResult<OperationItemResult> {
    let source = normalize_input_path(item)?;
    let metadata = fs::symlink_metadata(&source)?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(CommandError::new(
            "unsupported",
            format!("Unsupported filesystem item '{}'", source.display()),
        ));
    }

    let Some(target) = resolve_target(&source, destination_dir, conflict_strategy)? else {
        return Ok(OperationItemResult {
            source: path_to_string(source),
            destination: None,
            status: "skipped".to_string(),
            message: None,
        });
    };

    if target.replace_existing {
        prevent_replace_source(&source, &target.path)?;
    }

    if metadata.is_dir() {
        prevent_copy_into_self(&source, &target.path)?;
    }

    if target.replace_existing {
        remove_existing(&target.path)?;
    }

    if fs::rename(&source, &target.path).is_err() {
        if metadata.is_dir() {
            copy_dir_recursive(&source, &target.path)?;
            fs::remove_dir_all(&source)?;
        } else {
            fs::copy(&source, &target.path)?;
            fs::remove_file(&source)?;
        }
    }

    Ok(OperationItemResult {
        source: path_to_string(source),
        destination: Some(path_to_string(target.path)),
        status: "moved".to_string(),
        message: None,
    })
}

fn resolve_target(
    source: &Path,
    destination_dir: &Path,
    conflict_strategy: ConflictStrategy,
) -> CommandResult<Option<ResolvedTarget>> {
    let name = source.file_name().ok_or_else(|| {
        CommandError::new(
            "invalid_path",
            format!("Cannot determine the name of '{}'", source.display()),
        )
    })?;
    let target = destination_dir.join(name);

    if !path_exists(&target)? {
        return Ok(Some(ResolvedTarget {
            path: target,
            replace_existing: false,
        }));
    }

    match conflict_strategy {
        ConflictStrategy::Skip => Ok(None),
        ConflictStrategy::Replace => Ok(Some(ResolvedTarget {
            path: target,
            replace_existing: true,
        })),
        ConflictStrategy::Rename => Ok(Some(ResolvedTarget {
            path: next_available_copy_name(&target),
            replace_existing: false,
        })),
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> CommandResult<()> {
    fs::create_dir_all(target)?;
    for entry_result in fs::read_dir(source)? {
        let entry = entry_result?;
        let source_child = entry.path();
        let target_child = target.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_child, &target_child)?;
        } else if file_type.is_file() {
            fs::copy(&source_child, &target_child)?;
        } else if file_type.is_symlink() {
            copy_symlink(&source_child, &target_child)?;
        } else {
            return Err(CommandError::new(
                "unsupported",
                format!("Unsupported filesystem item '{}'", source_child.display()),
            ));
        }
    }
    Ok(())
}

fn copy_symlink(source: &Path, target: &Path) -> CommandResult<()> {
    let link_target = fs::read_link(source)?;
    copy_symlink_platform(source, target, &link_target)
}

#[cfg(unix)]
fn copy_symlink_platform(_source: &Path, target: &Path, link_target: &Path) -> CommandResult<()> {
    std::os::unix::fs::symlink(link_target, target)?;
    Ok(())
}

#[cfg(windows)]
fn copy_symlink_platform(source: &Path, target: &Path, link_target: &Path) -> CommandResult<()> {
    let is_dir = fs::metadata(source)
        .map(|meta| meta.is_dir())
        .unwrap_or(false);

    if is_dir {
        std::os::windows::fs::symlink_dir(link_target, target)?;
    } else {
        std::os::windows::fs::symlink_file(link_target, target)?;
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn copy_symlink_platform(source: &Path, _target: &Path, _link_target: &Path) -> CommandResult<()> {
    Err(CommandError::new(
        "unsupported",
        format!("Unsupported filesystem item '{}'", source.display()),
    ))
}

fn next_available_copy_name(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path.file_stem().and_then(OsStr::to_str).unwrap_or("copy");
    let extension = path.extension().and_then(OsStr::to_str);

    for index in 1.. {
        let suffix = if index == 1 {
            " copy".to_string()
        } else {
            format!(" copy {}", index)
        };
        let candidate_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem}{suffix}.{extension}"),
            _ => format!("{stem}{suffix}"),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("copy name loop is unbounded")
}

fn remove_existing(path: &Path) -> CommandResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn path_exists(path: &Path) -> CommandResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn is_hidden_entry(name: &str, metadata: &fs::Metadata) -> bool {
    platform_hidden(metadata) || unix_dotfile_hidden(name)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn unix_dotfile_hidden(name: &str) -> bool {
    name.starts_with('.') && name != "." && name != ".."
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn unix_dotfile_hidden(_name: &str) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn platform_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;

    const UF_HIDDEN: u32 = 0x0000_8000;
    metadata.st_flags() & UF_HIDDEN != 0
}

#[cfg(windows)]
fn platform_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_hidden(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn preview_platform_path(path: &Path) -> CommandResult<()> {
    Command::new("qlmanage")
        .arg("-p")
        .arg(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            CommandError::new(
                "preview_failed",
                format!("Could not preview '{}': {}", path.display(), error),
            )
        })
}

#[cfg(not(target_os = "macos"))]
fn preview_platform_path(path: &Path) -> CommandResult<()> {
    open::that(path).map_err(|error| {
        CommandError::new(
            "preview_failed",
            format!("Could not preview '{}': {}", path.display(), error),
        )
    })
}

#[cfg(target_os = "macos")]
fn open_path_with_player_platform(path: &Path, player: &str) -> CommandResult<()> {
    if should_open_macos_application(player) {
        let mut command = Command::new("open");
        command.arg("-a").arg(player);
        return spawn_player_command(command, path, player);
    }

    spawn_player_command(Command::new(player), path, player)
}

#[cfg(target_os = "macos")]
fn should_open_macos_application(player: &str) -> bool {
    let extension_is_app = Path::new(player)
        .extension()
        .and_then(OsStr::to_str)
        .map(|extension| extension.eq_ignore_ascii_case("app"))
        .unwrap_or(false);

    extension_is_app || (!player.contains('/') && !player.contains('\\'))
}

#[cfg(not(target_os = "macos"))]
fn open_path_with_player_platform(path: &Path, player: &str) -> CommandResult<()> {
    spawn_player_command(Command::new(player), path, player)
}

fn spawn_player_command(mut command: Command, path: &Path, player: &str) -> CommandResult<()> {
    command
        .arg(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            CommandError::new(
                "open_failed",
                format!(
                    "Could not open '{}' with '{}': {}",
                    path.display(),
                    player,
                    error
                ),
            )
        })
}

#[cfg(target_os = "macos")]
fn reveal_platform_path(path: &Path) -> CommandResult<()> {
    let status = Command::new("open").arg("-R").arg(path).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(CommandError::new(
            "reveal_failed",
            format!("Could not reveal '{}'", path.display()),
        ))
    }
}

#[cfg(windows)]
fn reveal_platform_path(path: &Path) -> CommandResult<()> {
    Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn()?;
    Ok(())
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn reveal_platform_path(path: &Path) -> CommandResult<()> {
    let target = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or_else(|| Path::new("/"))
    };

    open::that(target).map_err(|error| {
        CommandError::new(
            "reveal_failed",
            format!("Could not reveal '{}': {}", path.display(), error),
        )
    })
}

fn ensure_directory(path: &Path) -> CommandResult<()> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(CommandError::new(
            "not_directory",
            format!("'{}' is not a folder", path.display()),
        ))
    }
}

fn is_valid_entry_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
}

fn resolve_existing_directory(path: &str) -> CommandResult<PathBuf> {
    if path.trim().is_empty() {
        let home = dirs_next::home_dir()
            .ok_or_else(|| CommandError::new("not_found", "Could not determine home directory"))?;
        return resolve_existing_directory_path(&home);
    }

    resolve_existing_directory_path(&PathBuf::from(path))
}

fn resolve_existing_directory_path(path: &Path) -> CommandResult<PathBuf> {
    let canonical = path.canonicalize().map_err(|error| {
        CommandError::new(
            error.kind().to_string(),
            format!("Cannot open '{}': {}", path.display(), error),
        )
    })?;
    ensure_directory(&canonical)?;
    Ok(canonical)
}

fn canonical_directory_set(paths: Vec<String>) -> CommandResult<HashSet<PathBuf>> {
    let mut dirs = HashSet::new();
    for path in paths {
        if path.trim().is_empty() {
            continue;
        }

        dirs.insert(resolve_existing_directory(&path)?);
    }
    Ok(dirs)
}

fn emit_directory_changed_events(
    app: &AppHandle,
    watched_dirs: &Arc<Mutex<HashSet<PathBuf>>>,
    event_paths: Vec<PathBuf>,
) {
    let watched_dirs = match watched_dirs.lock() {
        Ok(paths) => paths.clone(),
        Err(_) => return,
    };
    let mut changed_dirs = HashSet::new();

    for event_path in event_paths {
        let event_parent = event_path.parent();
        let canonical_parent = event_parent.and_then(|parent| parent.canonicalize().ok());

        for watched_dir in &watched_dirs {
            if event_path == *watched_dir
                || event_parent == Some(watched_dir.as_path())
                || canonical_parent.as_deref() == Some(watched_dir.as_path())
            {
                changed_dirs.insert(watched_dir.clone());
            }
        }
    }

    for path in changed_dirs {
        let _ = app.emit(
            "directory-changed",
            DirectoryChangedPayload {
                path: path_to_string(path),
            },
        );
    }
}

fn directory_watch_error(error: notify::Error) -> CommandError {
    CommandError::new("watch_failed", error.to_string())
}

fn expand_terminal_path(target: &str, cwd: &Path) -> CommandResult<PathBuf> {
    if target == "~" {
        return dirs_next::home_dir()
            .ok_or_else(|| CommandError::new("not_found", "Could not determine home directory"));
    }

    if let Some(rest) = target
        .strip_prefix("~/")
        .or_else(|| target.strip_prefix("~\\"))
    {
        let home = dirs_next::home_dir()
            .ok_or_else(|| CommandError::new("not_found", "Could not determine home directory"))?;
        return Ok(home.join(rest));
    }

    let path = PathBuf::from(target);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(cwd.join(path))
    }
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(20, 500),
        rows: rows.clamp(4, 200),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn lock_terminal_sessions(
    sessions: &Arc<TerminalSessionsInner>,
) -> CommandResult<std::sync::MutexGuard<'_, HashMap<String, TerminalSession>>> {
    sessions
        .sessions
        .lock()
        .map_err(|_| CommandError::new("terminal_state", "Terminal state is unavailable"))
}

fn lock_agent_process_sessions(
    sessions: &Arc<AgentProcessSessionsInner>,
) -> CommandResult<std::sync::MutexGuard<'_, HashMap<String, AgentProcessSession>>> {
    sessions
        .sessions
        .lock()
        .map_err(|_| CommandError::new("agent_state", "Agent state is unavailable"))
}

fn emit_agent_event(
    app: &AppHandle,
    session_id: &str,
    provider_id: &str,
    level: &str,
    message: &str,
) {
    let _ = app.emit(
        "agent-event",
        AgentEventPayload {
            session_id: session_id.to_string(),
            provider_id: provider_id.to_string(),
            level: level.to_string(),
            message: message.to_string(),
            timestamp: current_timestamp_millis(),
        },
    );
}

fn terminal_pty_error(kind: &str, error: impl std::fmt::Display) -> CommandError {
    CommandError::new(kind, error.to_string())
}

#[cfg(windows)]
fn terminal_interactive_shell_command(cwd: &Path) -> CommandBuilder {
    let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
    let mut command = CommandBuilder::new(shell);
    command.cwd(cwd.as_os_str());
    command
}

#[cfg(not(windows))]
fn terminal_interactive_shell_command(cwd: &Path) -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut command = CommandBuilder::new(shell);
    command.cwd(cwd.as_os_str());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command
}

#[cfg(windows)]
fn terminal_shell_command(command: &str) -> Command {
    let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
    let mut process = Command::new(shell);
    process.arg("/C").arg(command);
    process
}

#[cfg(not(windows))]
fn terminal_shell_command(command: &str) -> Command {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    let mut process = Command::new(&shell);
    if matches!(shell_name, "bash" | "zsh" | "ksh") {
        process.arg("-lc");
    } else {
        process.arg("-c");
    }
    process.arg(command);
    process
}

fn prevent_copy_into_self(source: &Path, target: &Path) -> CommandResult<()> {
    let source = source.canonicalize()?;
    let target_parent = target
        .parent()
        .ok_or_else(|| CommandError::new("invalid_path", "Invalid destination"))?
        .canonicalize()?;

    if target_parent.starts_with(&source) {
        return Err(CommandError::new(
            "invalid_destination",
            "Cannot copy or move a folder into itself",
        ));
    }

    Ok(())
}

fn prevent_replace_source(source: &Path, target: &Path) -> CommandResult<()> {
    let source = source.canonicalize()?;
    let target = match target.canonicalize() {
        Ok(target) => target,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    if source == target {
        return Err(CommandError::new(
            "invalid_destination",
            "Cannot replace an item with itself",
        ));
    }

    Ok(())
}

fn normalize_input_path(path: &str) -> CommandResult<PathBuf> {
    if path.trim().is_empty() {
        return dirs_next::home_dir()
            .ok_or_else(|| CommandError::new("not_found", "Could not determine home directory"));
    }
    Ok(PathBuf::from(path))
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn app_config_dir() -> CommandResult<PathBuf> {
    let config_dir = dirs_next::config_dir()
        .ok_or_else(|| CommandError::new("not_found", "Could not determine config directory"))?;
    Ok(config_dir.join("Bobroot"))
}

fn session_file_path() -> CommandResult<PathBuf> {
    Ok(app_config_dir()?.join("session.json"))
}

fn action_log_file_path() -> CommandResult<PathBuf> {
    Ok(app_config_dir()?.join("actions.jsonl"))
}

fn current_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalSessions::default())
        .manage(AgentProcessSessions::default())
        .setup(|app| {
            let directory_watcher = DirectoryWatcherState::new(app.handle().clone());
            app.manage(directory_watcher);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            home_dir,
            list_directory,
            watch_directories,
            copy_items,
            move_items,
            move_to_trash,
            permanently_delete,
            open_path,
            open_path_with_player,
            open_external_url,
            preview_path,
            reveal_path,
            rename_item,
            create_folder,
            run_terminal_command,
            start_terminal_session,
            write_terminal_data,
            resize_terminal_session,
            stop_terminal_session,
            resolve_terminal_directory,
            run_agent_command,
            start_agent_process,
            write_agent_process_data,
            resize_agent_process,
            stop_agent_process,
            load_session,
            save_session,
            append_action_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bobroot");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs as unix_fs;

    fn path_str(path: &Path) -> &str {
        path.to_str().expect("temporary test path should be UTF-8")
    }

    fn write_file(path: &Path, contents: &str) {
        fs::write(path, contents).expect("test file should be writable");
    }

    fn read_file(path: &Path) -> String {
        fs::read_to_string(path).expect("test file should be readable")
    }

    #[test]
    fn next_available_copy_name_adds_copy_suffixes() {
        let temp = tempdir().unwrap();
        let original = temp.path().join("report.txt");
        let first_copy = temp.path().join("report copy.txt");

        write_file(&original, "original");
        assert_eq!(next_available_copy_name(&original), first_copy);

        write_file(&first_copy, "copy");
        assert_eq!(
            next_available_copy_name(&original),
            temp.path().join("report copy 2.txt")
        );
    }

    #[test]
    fn copy_one_renames_conflicting_file_without_overwriting() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("note.txt");
        let destination_dir = temp.path().join("destination");
        let existing = destination_dir.join("note.txt");
        let renamed = destination_dir.join("note copy.txt");

        fs::create_dir(&destination_dir).unwrap();
        write_file(&source, "source");
        write_file(&existing, "existing");

        let result = copy_one(
            path_str(&source),
            &destination_dir,
            ConflictStrategy::Rename,
        )
        .expect("copy should succeed");

        assert_eq!(result.status, "copied");
        assert_eq!(result.destination, Some(path_to_string(renamed.clone())));
        assert_eq!(read_file(&source), "source");
        assert_eq!(read_file(&existing), "existing");
        assert_eq!(read_file(&renamed), "source");
    }

    #[test]
    fn copy_one_copies_directory_recursively() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("project");
        let nested_file = source.join("src").join("main.rs");
        let destination_dir = temp.path().join("destination");
        let copied_file = destination_dir.join("project").join("src").join("main.rs");

        fs::create_dir_all(nested_file.parent().unwrap()).unwrap();
        fs::create_dir(&destination_dir).unwrap();
        write_file(&nested_file, "fn main() {}");

        let result = copy_one(
            path_str(&source),
            &destination_dir,
            ConflictStrategy::Rename,
        )
        .expect("directory copy should succeed");

        assert_eq!(result.status, "copied");
        assert_eq!(
            result.destination,
            Some(path_to_string(destination_dir.join("project")))
        );
        assert_eq!(read_file(&copied_file), "fn main() {}");
    }

    #[test]
    fn copy_one_replace_rejects_self_without_deleting_source() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("note.txt");

        write_file(&source, "source");

        let error = copy_one(path_str(&source), temp.path(), ConflictStrategy::Replace)
            .expect_err("copying over itself should fail");

        assert_eq!(error.kind, "invalid_destination");
        assert_eq!(read_file(&source), "source");
    }

    #[test]
    fn copy_one_replace_rejects_nested_destination_without_deleting_target() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("project");
        let destination_dir = source.join("nested");
        let existing_target = destination_dir.join("project");
        let nested_file = existing_target.join("keep.txt");

        fs::create_dir_all(&destination_dir).unwrap();
        fs::create_dir_all(&existing_target).unwrap();
        write_file(&nested_file, "keep");

        let error = copy_one(
            path_str(&source),
            &destination_dir,
            ConflictStrategy::Replace,
        )
        .expect_err("copying a folder into itself should fail");

        assert_eq!(error.kind, "invalid_destination");
        assert_eq!(read_file(&nested_file), "keep");
    }

    #[cfg(unix)]
    #[test]
    fn copy_one_copies_directory_symlink_recursively() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("project");
        let linked_target = temp.path().join("target.txt");
        let link = source.join("target-link.txt");
        let destination_dir = temp.path().join("destination");
        let copied_link = destination_dir.join("project").join("target-link.txt");

        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination_dir).unwrap();
        write_file(&linked_target, "target");
        unix_fs::symlink(&linked_target, &link).expect("symlink should be created");

        let result = copy_one(
            path_str(&source),
            &destination_dir,
            ConflictStrategy::Rename,
        )
        .expect("directory copy should succeed");

        assert_eq!(result.status, "copied");
        assert!(fs::symlink_metadata(&copied_link)
            .expect("copied link should exist")
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_link(&copied_link).unwrap(), linked_target);
    }

    #[test]
    fn move_one_skips_conflicting_file_when_requested() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("todo.txt");
        let destination_dir = temp.path().join("destination");
        let existing = destination_dir.join("todo.txt");

        fs::create_dir(&destination_dir).unwrap();
        write_file(&source, "source");
        write_file(&existing, "existing");

        let result = move_one(path_str(&source), &destination_dir, ConflictStrategy::Skip)
            .expect("move skip should succeed");

        assert_eq!(result.status, "skipped");
        assert_eq!(result.destination, None);
        assert_eq!(read_file(&source), "source");
        assert_eq!(read_file(&existing), "existing");
    }

    #[test]
    fn move_one_replaces_conflicting_file_when_requested() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("todo.txt");
        let destination_dir = temp.path().join("destination");
        let target = destination_dir.join("todo.txt");

        fs::create_dir(&destination_dir).unwrap();
        write_file(&source, "source");
        write_file(&target, "existing");

        let result = move_one(
            path_str(&source),
            &destination_dir,
            ConflictStrategy::Replace,
        )
        .expect("move replace should succeed");

        assert_eq!(result.status, "moved");
        assert_eq!(result.destination, Some(path_to_string(target.clone())));
        assert!(!source.exists());
        assert_eq!(read_file(&target), "source");
    }

    #[test]
    fn move_one_replace_rejects_self_without_deleting_source() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("todo.txt");

        write_file(&source, "source");

        let error = move_one(path_str(&source), temp.path(), ConflictStrategy::Replace)
            .expect_err("moving over itself should fail");

        assert_eq!(error.kind, "invalid_destination");
        assert_eq!(read_file(&source), "source");
    }

    #[test]
    fn remove_existing_removes_file_and_nested_directory() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("file.txt");
        let directory = temp.path().join("directory");
        let nested_file = directory.join("nested").join("file.txt");

        write_file(&file, "file");
        fs::create_dir_all(nested_file.parent().unwrap()).unwrap();
        write_file(&nested_file, "nested");

        remove_existing(&file).expect("file removal should succeed");
        remove_existing(&directory).expect("directory removal should succeed");

        assert!(!file.exists());
        assert!(!directory.exists());
    }

    #[cfg(unix)]
    #[test]
    fn remove_existing_removes_symlink_without_touching_target() {
        let temp = tempdir().unwrap();
        let target = temp.path().join("target.txt");
        let link = temp.path().join("target-link.txt");

        write_file(&target, "target");
        unix_fs::symlink(&target, &link).expect("symlink should be created");

        remove_existing(&link).expect("symlink removal should succeed");

        assert!(fs::symlink_metadata(&link).is_err());
        assert_eq!(read_file(&target), "target");
    }

    #[test]
    fn prevent_copy_into_self_rejects_nested_destination() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("folder");
        let nested_destination = source.join("child").join("folder");

        fs::create_dir_all(nested_destination.parent().unwrap()).unwrap();

        let error = prevent_copy_into_self(&source, &nested_destination)
            .expect_err("copying into self should fail");

        assert_eq!(error.kind, "invalid_destination");
    }

    #[test]
    fn entry_name_validation_rejects_path_separators() {
        assert!(is_valid_entry_name("folder"));
        assert!(!is_valid_entry_name(""));
        assert!(!is_valid_entry_name("nested/name"));
        assert!(!is_valid_entry_name("nested\\name"));
        assert!(!is_valid_entry_name("."));
        assert!(!is_valid_entry_name(".."));
        assert!(!is_valid_entry_name("name\0withnull"));
    }
}
