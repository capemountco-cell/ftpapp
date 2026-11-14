//! One error type for everything Captain does, shaped for the interface: each
//! kind is a situation the window handles differently (ask to trust a host,
//! ask for a password again, show a message), not a library's error code.

use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Error {
    /// First connection to an SSH server: the user decides whether to trust it.
    #[serde(rename_all = "camelCase")]
    UnknownHost {
        host: String,
        key_type: String,
        fingerprint: String,
    },
    /// The SSH server's key is not the one trusted before. Never bypassed.
    #[serde(rename_all = "camelCase")]
    HostKeyChanged {
        host: String,
        fingerprint: String,
        expected: String,
    },
    /// An FTPS certificate the system does not trust (often self-signed).
    #[serde(rename_all = "camelCase")]
    UntrustedCertificate {
        host: String,
        fingerprint: String,
        reason: String,
    },
    /// The server refused the username, password or key.
    Auth { message: String },
    /// The network: unreachable host, timeout, dropped connection.
    Connection { message: String },
    /// No such file or folder on the server.
    NotFound { path: String },
    /// The server said no (permissions, quota, already exists…).
    Remote { message: String },
    /// Reading or writing a file on this Mac failed.
    Local { message: String },
    /// Input that cannot work, caught before anything is sent.
    Invalid { message: String },
    /// The user stopped it.
    Cancelled,
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Error {
    pub fn invalid(message: impl Into<String>) -> Self {
        Error::Invalid {
            message: message.into(),
        }
    }
    pub fn remote(message: impl Into<String>) -> Self {
        Error::Remote {
            message: message.into(),
        }
    }
    pub fn connection(message: impl Into<String>) -> Self {
        Error::Connection {
            message: message.into(),
        }
    }
    pub fn local(message: impl Into<String>) -> Self {
        Error::Local {
            message: message.into(),
        }
    }

    /// Worth reconnecting and trying again: the link dropped, the server
    /// didn't refuse anything.
    pub fn is_connection(&self) -> bool {
        matches!(self, Error::Connection { .. })
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::UnknownHost { host, .. } => write!(f, "{host} is a server Captain hasn't seen before"),
            Error::HostKeyChanged { host, .. } => write!(
                f,
                "The identity of {host} has changed. It may have been reinstalled, or someone may be intercepting the connection"
            ),
            Error::UntrustedCertificate { host, reason, .. } => {
                write!(f, "The certificate for {host} isn't trusted: {reason}")
            }
            Error::Auth { message }
            | Error::Connection { message }
            | Error::Remote { message }
            | Error::Local { message }
            | Error::Invalid { message } => f.write_str(message),
            Error::NotFound { path } => write!(f, "{path} doesn't exist"),
            Error::Cancelled => f.write_str("Cancelled"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind::*;
        match e.kind() {
            ConnectionRefused | ConnectionReset | ConnectionAborted | NotConnected | BrokenPipe
            | TimedOut | UnexpectedEof | AddrNotAvailable => Error::connection(e.to_string()),
            _ => Error::local(e.to_string()),
        }
    }
}
