//! Bounded readiness protocol for the App's owned server stdout.
use std::io::{self, BufRead, BufReader, Read, Write};
use std::time::Duration;

pub fn wait_for_ready<R: Read + Send + 'static, W: Write + Send + 'static>(
    stdout: R, mut log: W, timeout: Duration,
) -> io::Result<()> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        let result = reader.by_ref().take(4097).read_until(b'\n', &mut line)
            .and_then(|_| {
                if line != b"{\"event\":\"personal-ready\",\"port\":47823}\n" {
                    return Err(io::Error::new(io::ErrorKind::InvalidData,
                        "Personal server returned an invalid readiness message"));
                }
                log.write_all(&line)
            });
        let ready = result.is_ok();
        if tx.send(result).is_ok() && ready {
            // Keep draining stdout after readiness. On timeout the caller drops
            // the owned Child guard, which kills/reaps it and releases this reader.
            let _ = io::copy(&mut reader, &mut log);
        }
    });
    rx.recv_timeout(timeout).map_err(|error| match error {
        std::sync::mpsc::RecvTimeoutError::Timeout => io::Error::new(
            io::ErrorKind::TimedOut, "Personal server startup timed out"),
        _ => io::Error::new(io::ErrorKind::BrokenPipe, "Personal server stdout reader stopped"),
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn silent_or_partial_server_cannot_block_startup() {
        for partial in [b"".as_slice(), b"{\"event\":"] {
            let (reader, mut writer) = UnixStream::pair().unwrap();
            writer.write_all(partial).unwrap();
            let (tx, rx) = mpsc::channel();
            thread::spawn(move || { let _ = tx.send(wait_for_ready(reader, io::sink(), Duration::from_millis(50))); });
            let result = rx.recv_timeout(Duration::from_millis(500));
            drop(writer);
            assert!(result.is_ok(), "startup hung on silent/partial stdout");
            assert_eq!(result.unwrap().unwrap_err().kind(), io::ErrorKind::TimedOut);
        }
    }

    #[test]
    fn exact_ready_is_accepted_and_wrong_or_oversized_messages_rejected() {
        for bytes in [b"{\"event\":\"personal-ready\",\"port\":47823}\n".to_vec()] {
            assert!(wait_for_ready(io::Cursor::new(bytes), io::sink(), Duration::from_secs(1)).is_ok());
        }
        for bytes in [Vec::new(), b"Codex Taskboard listening on http://127.0.0.1:47823 evil\n".to_vec(),
            b"{\"event\":\"personal-ready\",\"port\":47824}\n".to_vec(), vec![b'x'; 5000]] {
            assert!(wait_for_ready(io::Cursor::new(bytes), io::sink(), Duration::from_secs(1)).is_err());
        }
    }
}
