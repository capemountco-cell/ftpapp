//! Work out what a server speaks from its greeting, so quick connect never
//! asks people to choose between SFTP, FTP and FTP with TLS.
//!
//! An SSH server opens with "SSH-2.0-…"; an FTP server with "220 …". An FTP
//! server that answers "AUTH TLS" with 234 can encrypt, so it is FTP with TLS.

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::remote;
use crate::site::Protocol;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub protocol: Protocol,
    pub port: u16,
}

/// Try `port`, or SFTP's 22 and then FTP's 21 when none is given.
pub fn detect(host: &str, port: Option<u16>) -> Result<Detected> {
    let host = host.trim();
    if host.is_empty() {
        return Err(Error::invalid("Enter a server"));
    }
    let ports = match port {
        Some(p) => vec![p],
        None => vec![22, 21],
    };
    let mut last = None;
    for port in ports {
        match greet(host, port) {
            Ok(protocol) => return Ok(Detected { protocol, port }),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| Error::connection(format!("{host} didn't answer"))))
}

fn greet(host: &str, port: u16) -> Result<Protocol> {
    let tcp = remote::tcp(host, port)?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(8)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(8)));
    let mut writer = tcp
        .try_clone()
        .map_err(|e| Error::connection(e.to_string()))?;
    let mut reader = BufReader::new(tcp);
    let silent = || {
        Error::connection(format!(
            "{host} answered on port {port}, but not as SFTP or FTP"
        ))
    };

    let first = read_line(&mut reader).map_err(|_| silent())?;
    match classify(&first) {
        Greeting::Ssh => return Ok(Protocol::Sftp),
        Greeting::Other => return Err(silent()),
        Greeting::Ftp => {}
    }
    // A multi-line greeting ("220-…") ends with a "220 " line.
    let mut line = first;
    for _ in 0..50 {
        if !line.starts_with("220-") {
            break;
        }
        line = read_line(&mut reader).map_err(|_| silent())?;
    }
    if writer.write_all(b"AUTH TLS\r\n").is_err() {
        return Ok(Protocol::Ftp);
    }
    let reply = read_line(&mut reader).unwrap_or_default();
    let _ = writer.write_all(b"QUIT\r\n");
    Ok(if reply.starts_with("234") {
        Protocol::Ftps
    } else {
        Protocol::Ftp
    })
}

fn read_line<R: BufRead>(reader: &mut R) -> std::io::Result<String> {
    let mut buf = Vec::new();
    // Bound the read: a greeting line is short.
    let n = std::io::Read::take(&mut *reader, 1024).read_until(b'\n', &mut buf)?;
    if n == 0 {
        return Err(std::io::ErrorKind::UnexpectedEof.into());
    }
    Ok(String::from_utf8_lossy(&buf).trim_end().to_string())
}

#[derive(Debug, PartialEq)]
enum Greeting {
    Ssh,
    Ftp,
    Other,
}

fn classify(line: &str) -> Greeting {
    if line.starts_with("SSH-") {
        Greeting::Ssh
    } else if line.starts_with("220") {
        Greeting::Ftp
    } else {
        Greeting::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn classifies_greetings() {
        assert_eq!(classify("SSH-2.0-OpenSSH_9.6"), Greeting::Ssh);
        assert_eq!(classify("220 (vsFTPd 3.0.5)"), Greeting::Ftp);
        assert_eq!(classify("220-Welcome"), Greeting::Ftp);
        assert_eq!(classify("HTTP/1.1 400"), Greeting::Other);
    }

    /// A fake server that greets with `lines` and answers AUTH TLS with `auth`.
    fn fake(lines: &'static [&'static str], auth: &'static str) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            for line in lines {
                s.write_all(format!("{line}\r\n").as_bytes()).unwrap();
            }
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut cmd = String::new();
            if r.read_line(&mut cmd).is_ok() && cmd.starts_with("AUTH") {
                let _ = s.write_all(format!("{auth}\r\n").as_bytes());
            }
            let _ = r.read_line(&mut cmd);
        });
        port
    }

    #[test]
    fn detects_each_protocol() {
        let sftp = fake(&["SSH-2.0-Test"], "");
        assert_eq!(
            detect("127.0.0.1", Some(sftp)).unwrap().protocol,
            Protocol::Sftp
        );
        let ftps = fake(&["220-Hello", "220 Ready"], "234 AUTH TLS OK");
        assert_eq!(
            detect("127.0.0.1", Some(ftps)).unwrap().protocol,
            Protocol::Ftps
        );
        let ftp = fake(&["220 Ready"], "500 Unknown command");
        assert_eq!(
            detect("127.0.0.1", Some(ftp)).unwrap().protocol,
            Protocol::Ftp
        );
    }
}
