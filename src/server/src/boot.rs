//! Standalone server boot configuration.

use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
    Token,
}

impl AuthMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Token => "token",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "token" => Ok(Self::Token),
            other => Err(format!(
                "unsupported auth mode '{other}'; currently only 'token' is supported"
            )),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ServerBootConfig {
    pub port: u16,
    pub data_dir: Option<PathBuf>,
    pub web_dist_path: PathBuf,
    pub auth_mode: AuthMode,
}

impl ServerBootConfig {
    pub fn from_env_and_args<I, S>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut port = std::env::var("VIBEAROUND_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(common::config::DEFAULT_PORT);
        let mut data_dir = std::env::var("VIBEAROUND_DATA_DIR")
            .ok()
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty());
        let mut web_dist_path = std::env::var("VIBEAROUND_WEB_DIST")
            .ok()
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(default_web_dist_path);
        let mut auth_mode = std::env::var("VIBEAROUND_AUTH_MODE")
            .ok()
            .as_deref()
            .map(AuthMode::parse)
            .transpose()?
            .unwrap_or(AuthMode::Token);

        let mut args = args.into_iter().map(Into::into).peekable();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--port" => {
                    let value = next_value(&mut args, "--port")?;
                    port = value
                        .parse::<u16>()
                        .map_err(|_| format!("invalid --port value: {value}"))?;
                }
                "--data-dir" => {
                    data_dir = Some(PathBuf::from(next_value(&mut args, "--data-dir")?));
                }
                "--web-dist" => {
                    web_dist_path = PathBuf::from(next_value(&mut args, "--web-dist")?);
                }
                "--auth-mode" => {
                    auth_mode = AuthMode::parse(&next_value(&mut args, "--auth-mode")?)?;
                }
                "--help" | "-h" => return Err(Self::usage()),
                other if other.starts_with("--port=") => {
                    let value = other.trim_start_matches("--port=");
                    port = value
                        .parse::<u16>()
                        .map_err(|_| format!("invalid --port value: {value}"))?;
                }
                other if other.starts_with("--data-dir=") => {
                    data_dir = Some(PathBuf::from(other.trim_start_matches("--data-dir=")));
                }
                other if other.starts_with("--web-dist=") => {
                    web_dist_path = PathBuf::from(other.trim_start_matches("--web-dist="));
                }
                other if other.starts_with("--auth-mode=") => {
                    auth_mode = AuthMode::parse(other.trim_start_matches("--auth-mode="))?;
                }
                other => {
                    return Err(format!(
                        "unknown server argument: {other}\n\n{}",
                        Self::usage()
                    ))
                }
            }
        }

        Ok(Self {
            port,
            data_dir,
            web_dist_path,
            auth_mode,
        })
    }

    pub fn apply_process_env(&self) {
        if let Some(data_dir) = &self.data_dir {
            std::env::set_var("VIBEAROUND_DATA_DIR", data_dir);
        }
        std::env::set_var("VIBEAROUND_AUTH_MODE", self.auth_mode.as_str());
    }

    pub fn usage() -> String {
        [
            "Usage: vibearound-server [--port <port>] [--data-dir <path>] [--web-dist <path>] [--auth-mode token]",
            "",
            "Environment:",
            "  VIBEAROUND_PORT       server listen port",
            "  VIBEAROUND_DATA_DIR   settings/state directory",
            "  VIBEAROUND_WEB_DIST   built web dashboard dist directory",
            "  VIBEAROUND_AUTH_MODE  token",
        ]
        .join("\n")
    }
}

fn next_value<I>(args: &mut std::iter::Peekable<I>, flag: &str) -> Result<String, String>
where
    I: Iterator<Item = String>,
{
    args.next()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn default_web_dist_path() -> PathBuf {
    let candidates = [
        PathBuf::from("web").join("dist"),
        PathBuf::from("src").join("web").join("dist"),
    ];
    candidates
        .iter()
        .find(|path| path.join("index.html").exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flag_values() {
        let cfg = ServerBootConfig::from_env_and_args([
            "--port",
            "12345",
            "--data-dir",
            "/tmp/va-data",
            "--web-dist=/tmp/va-web",
            "--auth-mode",
            "token",
        ])
        .unwrap();

        assert_eq!(cfg.port, 12345);
        assert_eq!(
            cfg.data_dir.as_deref(),
            Some(std::path::Path::new("/tmp/va-data"))
        );
        assert_eq!(cfg.web_dist_path, std::path::Path::new("/tmp/va-web"));
        assert_eq!(cfg.auth_mode, AuthMode::Token);
    }

    #[test]
    fn rejects_unknown_auth_mode() {
        let err = ServerBootConfig::from_env_and_args(["--auth-mode", "none"]).unwrap_err();
        assert!(err.contains("unsupported auth mode"));
    }
}
