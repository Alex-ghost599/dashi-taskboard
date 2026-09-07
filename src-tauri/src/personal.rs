//! Personal desktop: owns only its loopback server; no Codex/updater/Skill lifecycle.
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    os::{fd::AsRawFd, unix::process::CommandExt},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::Manager;

struct Server(Mutex<Option<Child>>);
impl Server {
    fn stop(&self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            // Signal only the exact child spawned by this App, then reap it.
            unsafe { libc::kill(child.id() as i32, libc::SIGTERM); }
            let _ = child.wait();
        }
    }
}
impl Drop for Server { fn drop(&mut self) { self.stop(); } }

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let home = app.path().home_dir()?;
            let data = home.join("Library/Application Support/Dashi Taskboard Personal");
            let logs = home.join("Library/Logs/Dashi Taskboard Personal");
            fs::create_dir_all(&data)?;
            fs::create_dir_all(&logs)?;
            let log = OpenOptions::new().create(true).append(true)
                .open(logs.join("server.log"))?;
            // Reserve the fixed endpoint before starting Node. A second instance fails
            // without touching the existing process or opening a different service.
            let listener = TcpListener::bind("127.0.0.1:47823")?;
            let fd = listener.as_raw_fd();
            let resources = app.path().resource_dir()?;
            let root = resources.join("app");
            let node = std::env::current_exe()?.parent().unwrap().join("node");
            let mut command = Command::new(node);
            command.arg(root.join("server/index.mjs"))
                .current_dir(&root)
                .env("CODEX_TASKBOARD_DATA_DIR", &data)
                .env("CODEX_TASKBOARD_HOST", "127.0.0.1")
                .env("CODEX_TASKBOARD_PORT", "47823")
                .env("CODEX_TASKBOARD_LISTEN_FD", "3")
                .env("CODEX_TASKBOARD_VERSION", concat!(env!("CARGO_PKG_VERSION"), "-personal"))
                .env_remove("CODEX_TASKBOARD_INSTANCE_TOKEN")
                .env_remove("CODEX_TASKBOARD_INSTANCE_SECRET")
                .stdout(Stdio::piped()).stderr(log.try_clone()?);
            unsafe {
                command.pre_exec(move || {
                    if libc::dup2(fd, 3) < 0 || libc::fcntl(3, libc::F_SETFD, 0) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
            let mut child = command.spawn()?;
            drop(listener);
            let stdout = child.stdout.take().unwrap();
            let server = Server(Mutex::new(Some(child)));
            let mut reader = BufReader::new(stdout);
            let mut ready = String::new();
            reader.read_line(&mut ready)?;
            if !ready.contains("Codex Taskboard listening on http://127.0.0.1:47823") {
                return Err("Personal server failed; see ~/Library/Logs/Dashi Taskboard Personal/server.log".into());
            }
            app.manage(server);
            let mut output = log;
            writeln!(output, "{}", ready.trim())?;
            std::thread::spawn(move || {
                for line in reader.lines().map_while(Result::ok) { let _ = writeln!(output, "{line}"); }
            });
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(
                "http://127.0.0.1:47823".parse()?
            )).title("Dashi Taskboard Personal").inner_size(1280.0, 850.0).build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Personal Taskboard startup failed");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            if let Some(server) = handle.try_state::<Server>() { server.stop(); }
        }
    });
}
