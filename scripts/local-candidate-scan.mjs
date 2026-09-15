import { LocalScanState } from "../server/local-scan-state.mjs";
import { NativeSnapshotReader } from "../server/native-candidate-snapshot.mjs";
import { LocalCandidateScanner } from "../server/local-candidate-scanner.mjs";

const [command, ...args] = process.argv.slice(2);
const options = Object.create(null);
try {
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!key.startsWith("--") || !args[i + 1] || Object.hasOwn(options, key)) throw new Error("Invalid arguments");
    options[key] = args[i + 1];
  }
  const allowed = {
    status: ["--state"],
    configure: ["--state", "--project", "--if-revision", "--armed", "--interval-ms", "--judge-policy-rev"],
    run: ["--state", "--database"],
  }[command];
  if (!allowed || Object.keys(options).length !== allowed.length || !allowed.every((key) => Object.hasOwn(options, key))) throw new Error("Invalid arguments");
  const state = new LocalScanState(options["--state"]);
  if (command === "status") {
    try { console.log(JSON.stringify(state.listProjects())); } finally { state.close(); }
  } else if (command === "configure") {
    try {
      if (!["true", "false"].includes(options["--armed"])) throw new Error("Invalid armed value");
      console.log(JSON.stringify(state.configure(options["--project"], Number(options["--if-revision"]), {
        armed: options["--armed"] === "true", intervalMs: Number(options["--interval-ms"]),
        judgePolicyRev: options["--judge-policy-rev"],
      }, Date.now())));
    } finally { state.close(); }
  } else {
    let reader;
    try { reader = new NativeSnapshotReader(options["--database"]); } catch (error) { state.close(); throw error; }
    const scanner = new LocalCandidateScanner({ reader, state, onError: (code) => console.error(code) });
    let stopping;
    const stop = () => (stopping ??= scanner.stop().finally(() => { reader.close(); state.close(); }));
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stop().catch(() => { process.exitCode = 1; }); });
    scanner.start();
    console.log(JSON.stringify({ event: "scan-started", authorizesDispatch: false }));
  }
} catch {
  // Keep database paths and task data out of terminal logs.
  console.error("Scan command failed. Check explicit arguments, private state and database availability.");
  process.exitCode = 1;
}
