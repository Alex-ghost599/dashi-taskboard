import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { personalServiceCredentials } from "../shared/personal-service.mjs";
const credentials = await personalServiceCredentials(path.join(os.homedir(), "Library/Application Support/Dashi Taskboard Personal"));
process.env.CODEX_TASKBOARD_URL = `http://127.0.0.1:47823/${credentials.token}`;
process.argv[1] = fileURLToPath(new URL("../cli/taskctl.mjs", import.meta.url));
await import("../cli/taskctl.mjs");
