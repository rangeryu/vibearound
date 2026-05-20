use std::fmt;

pub type Result<T> = std::result::Result<T, BridgeTransformError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeTransformError {
    ExpectedObject(&'static str),
    MissingField(&'static str),
    Unsupported(String),
}

impl fmt::Display for BridgeTransformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ExpectedObject(name) => write!(f, "expected {name} to be a JSON object"),
            Self::MissingField(name) => write!(f, "missing required field `{name}`"),
            Self::Unsupported(message) => {
                write!(f, "unsupported OpenAI bridge transform: {message}")
            }
        }
    }
}

impl std::error::Error for BridgeTransformError {}
