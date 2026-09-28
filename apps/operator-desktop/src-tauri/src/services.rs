use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use thiserror::Error;

const RELAY_UNIT: &str = "ossr-relay.service";
const DASHBOARD_UNIT: &str = "ossr-operator-dashboard.service";
const SYSTEM_UNIT_DIRECTORY: &str = "/etc/systemd/system";

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("Could not determine the user configuration directory")]
    NoConfigDirectory,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{program} failed: {detail}")]
    Command { program: String, detail: String },
    #[error("The relay working directory has no package.json: {0}")]
    InvalidRelayDirectory(PathBuf),
    #[error("Administrator authentication was cancelled or denied")]
    AuthenticationDenied,
    #[error("Invalid privileged helper request")]
    InvalidHelperRequest,
    #[error("The privileged helper must run as root")]
    HelperNotRoot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub installed: bool,
    pub enabled: bool,
    pub active: bool,
    pub state: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartState {
    pub relay: ServiceState,
    pub dashboard: ServiceState,
}

pub fn status() -> AutostartState {
    AutostartState {
        relay: unit_status(RELAY_UNIT, Scope::System),
        dashboard: unit_status(DASHBOARD_UNIT, Scope::User),
    }
}

/// Installs the system relay through Polkit. `pkexec` owns the password UI, so
/// credentials never enter the dashboard process.
pub fn install(relay_directory: &Path) -> Result<AutostartState, ServiceError> {
    let relay_directory = relay_directory.canonicalize()?;
    if !relay_directory.join("package.json").is_file() {
        return Err(ServiceError::InvalidRelayDirectory(relay_directory));
    }
    let executable = std::env::current_exe()?;
    privileged(&[
        "--system-service-helper",
        "install",
        relay_directory.to_string_lossy().as_ref(),
    ])?;

    let unit_dir = user_unit_directory()?;
    fs::create_dir_all(&unit_dir)?;
    write_unit(
        &unit_dir.join(DASHBOARD_UNIT),
        &format!(
            "[Unit]\nDescription=OSSR Operator Dashboard\nAfter=graphical-session.target\n\n[Service]\nType=simple\nExecStart={}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n",
            systemd_escape(&executable),
        ),
        0o600,
    )?;
    systemctl(Scope::User, &["daemon-reload"])?;
    Ok(status())
}

pub fn set_autostart(enabled: bool) -> Result<AutostartState, ServiceError> {
    ensure_system_unit_installed()?;
    let action = if enabled { "enable" } else { "disable" };
    privileged(&["--system-service-helper", action])?;
    systemctl(Scope::User, &[action, DASHBOARD_UNIT])?;
    Ok(status())
}

pub fn set_relay_running(running: bool) -> Result<AutostartState, ServiceError> {
    ensure_system_unit_installed()?;
    privileged(&[
        "--system-service-helper",
        if running { "start" } else { "stop" },
    ])?;
    Ok(status())
}

/// Runs only after this executable has been re-launched by `pkexec`.
pub fn privileged_helper(args: &[String]) -> Result<(), ServiceError> {
    if effective_uid()? != "0" {
        return Err(ServiceError::HelperNotRoot);
    }
    match args {
        [action, relay_directory] if action == "install" => {
            let uid =
                std::env::var("PKEXEC_UID").map_err(|_| ServiceError::InvalidHelperRequest)?;
            if !uid.chars().all(|character| character.is_ascii_digit()) {
                return Err(ServiceError::InvalidHelperRequest);
            }
            let relay_directory = Path::new(relay_directory).canonicalize()?;
            if fs::metadata(&relay_directory)?.uid().to_string() != uid {
                return Err(ServiceError::InvalidHelperRequest);
            }
            let user = identity_name("-nu", &uid)?;
            let group = identity_name("-ng", &uid)?;
            validate_identity(&user)?;
            validate_identity(&group)?;
            install_system_unit(&relay_directory, &user, &group)
        }
        [action] if matches!(action.as_str(), "enable" | "disable" | "start" | "stop") => {
            systemctl(Scope::System, &[action, RELAY_UNIT])
        }
        _ => Err(ServiceError::InvalidHelperRequest),
    }
}

fn install_system_unit(
    relay_directory: &Path,
    user: &str,
    group: &str,
) -> Result<(), ServiceError> {
    let relay_directory = relay_directory.canonicalize()?;
    if !relay_directory.join("package.json").is_file() {
        return Err(ServiceError::InvalidRelayDirectory(relay_directory));
    }
    let npm = find_executable("npm").unwrap_or_else(|| PathBuf::from("/usr/bin/npm"));
    let state_directory = relay_directory.join(".ossr");
    let unit = format!(
        "[Unit]\nDescription=OSSR testnet relay\nAfter=network-online.target docker.service\nWants=network-online.target\n\n[Service]\nType=simple\nUser={user}\nGroup={group}\nWorkingDirectory={}\nExecStart={} run operator:serve\nRestart=on-failure\nRestartSec=5\nEnvironment=NODE_ENV=production\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths={}\n\n[Install]\nWantedBy=multi-user.target\n",
        systemd_escape(&relay_directory),
        systemd_escape(&npm),
        systemd_escape(&state_directory),
    );
    write_unit(
        &Path::new(SYSTEM_UNIT_DIRECTORY).join(RELAY_UNIT),
        &unit,
        0o644,
    )?;
    systemctl(Scope::System, &["daemon-reload"])?;
    systemctl(Scope::System, &["enable", RELAY_UNIT])
}

#[derive(Clone, Copy)]
enum Scope {
    User,
    System,
}

fn unit_status(name: &str, scope: Scope) -> ServiceState {
    let installed = match scope {
        Scope::User => user_unit_directory()
            .map(|dir| dir.join(name).is_file())
            .unwrap_or(false),
        Scope::System => Path::new(SYSTEM_UNIT_DIRECTORY).join(name).is_file(),
    };
    let enabled = systemctl_success(scope, &["is-enabled", "--quiet", name]);
    let active = systemctl_success(scope, &["is-active", "--quiet", name]);
    ServiceState {
        installed,
        enabled,
        active,
        state: if active {
            "running"
        } else if enabled {
            "enabled"
        } else if installed {
            "stopped"
        } else {
            "not installed"
        }
        .into(),
        scope: match scope {
            Scope::User => "user",
            Scope::System => "system",
        }
        .into(),
    }
}

fn user_unit_directory() -> Result<PathBuf, ServiceError> {
    dirs::config_dir()
        .map(|path| path.join("systemd/user"))
        .ok_or(ServiceError::NoConfigDirectory)
}

fn ensure_system_unit_installed() -> Result<(), ServiceError> {
    if Path::new(SYSTEM_UNIT_DIRECTORY).join(RELAY_UNIT).is_file() {
        Ok(())
    } else {
        Err(ServiceError::InvalidHelperRequest)
    }
}

fn privileged(args: &[&str]) -> Result<(), ServiceError> {
    let status = Command::new("pkexec")
        .arg(std::env::current_exe()?)
        .args(args)
        .status()?;
    if status.success() {
        Ok(())
    } else if matches!(status.code(), Some(126 | 127)) {
        Err(ServiceError::AuthenticationDenied)
    } else {
        Err(ServiceError::Command {
            program: "privileged service helper".into(),
            detail: format!("exited with {status}"),
        })
    }
}

fn systemctl(scope: Scope, args: &[&str]) -> Result<(), ServiceError> {
    let mut command = Command::new("systemctl");
    if matches!(scope, Scope::User) {
        command.arg("--user");
    }
    let output = command.args(args).output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(ServiceError::Command {
            program: "systemctl".into(),
            detail: command_error(&output),
        })
    }
}

fn systemctl_success(scope: Scope, args: &[&str]) -> bool {
    let mut command = Command::new("systemctl");
    if matches!(scope, Scope::User) {
        command.arg("--user");
    }
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn identity_name(flag: &str, uid: &str) -> Result<String, ServiceError> {
    let output = Command::new("id").args([flag, uid]).output()?;
    if !output.status.success() {
        return Err(ServiceError::Command {
            program: "id".into(),
            detail: command_error(&output),
        });
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    validate_identity(&name)?;
    Ok(name)
}

fn effective_uid() -> Result<String, ServiceError> {
    let output = Command::new("id").arg("-u").output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        Err(ServiceError::Command {
            program: "id".into(),
            detail: command_error(&output),
        })
    }
}

fn validate_identity(value: &str) -> Result<(), ServiceError> {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        Ok(())
    } else {
        Err(ServiceError::InvalidHelperRequest)
    }
}

fn command_error(output: &std::process::Output) -> String {
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if detail.is_empty() {
        format!("exited with {}", output.status)
    } else {
        detail
    }
}

fn write_unit(path: &Path, contents: &str, mode: u32) -> Result<(), std::io::Error> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(mode)
        .open(path)?;
    file.write_all(contents.as_bytes())
}

fn find_executable(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")?
        .to_string_lossy()
        .split(':')
        .map(Path::new)
        .map(|dir| dir.join(name))
        .find(|path| path.is_file())
}

fn systemd_escape(path: &Path) -> String {
    format!(
        "\"{}\"",
        path.to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_systemd_paths() {
        assert_eq!(systemd_escape(Path::new("/tmp/a b")), "\"/tmp/a b\"");
    }

    #[test]
    fn validates_safe_system_identities() {
        assert!(validate_identity("relay-user_1").is_ok());
        assert!(validate_identity("relay user").is_err());
        assert!(validate_identity("root\nExecStart=bad").is_err());
    }
}
