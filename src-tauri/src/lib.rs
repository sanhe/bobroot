use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

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

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionData {
    left: PanelSession,
    right: PanelSession,
    active_panel: Option<String>,
    right_panel_visible: Option<bool>,
    show_hidden_files: Option<bool>,
    window: Option<WindowSession>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelSession {
    tabs: Vec<TabSession>,
    active_tab_id: Option<String>,
}

impl Default for PanelSession {
    fn default() -> Self {
        Self {
            tabs: Vec::new(),
            active_tab_id: None,
        }
    }
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
    if trimmed_name.is_empty() || trimmed_name.contains(std::path::MAIN_SEPARATOR) {
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
    if trimmed_name.is_empty() || trimmed_name.contains(std::path::MAIN_SEPARATOR) {
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

    if metadata.is_dir() {
        prevent_copy_into_self(&source, &target)?;
        copy_dir_recursive(&source, &target)?;
    } else {
        fs::copy(&source, &target)?;
    }

    Ok(OperationItemResult {
        source: path_to_string(source),
        destination: Some(path_to_string(target)),
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

    if metadata.is_dir() {
        prevent_copy_into_self(&source, &target)?;
    }

    match fs::rename(&source, &target) {
        Ok(()) => {}
        Err(rename_error) => {
            if metadata.is_dir() {
                copy_dir_recursive(&source, &target)?;
                fs::remove_dir_all(&source)?;
            } else {
                fs::copy(&source, &target)?;
                fs::remove_file(&source)?;
            }

            if target.exists() {
                let _ = rename_error;
            }
        }
    }

    Ok(OperationItemResult {
        source: path_to_string(source),
        destination: Some(path_to_string(target)),
        status: "moved".to_string(),
        message: None,
    })
}

fn resolve_target(
    source: &Path,
    destination_dir: &Path,
    conflict_strategy: ConflictStrategy,
) -> CommandResult<Option<PathBuf>> {
    let name = source.file_name().ok_or_else(|| {
        CommandError::new(
            "invalid_path",
            format!("Cannot determine the name of '{}'", source.display()),
        )
    })?;
    let target = destination_dir.join(name);

    if !path_exists(&target)? {
        return Ok(Some(target));
    }

    match conflict_strategy {
        ConflictStrategy::Skip => Ok(None),
        ConflictStrategy::Replace => {
            remove_existing(&target)?;
            Ok(Some(target))
        }
        ConflictStrategy::Rename => Ok(Some(next_available_copy_name(&target))),
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
        }
    }
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            home_dir,
            list_directory,
            copy_items,
            move_items,
            move_to_trash,
            permanently_delete,
            open_path,
            preview_path,
            reveal_path,
            rename_item,
            create_folder,
            load_session,
            save_session,
            append_action_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bobroot");
}
