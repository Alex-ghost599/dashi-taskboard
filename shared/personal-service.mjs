import { constants } from "node:fs";
import { open, mkdir, link, unlink } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

export async function personalServiceCredentials(dataDirectory, { create = false } = {}) {
  const file = path.join(dataDirectory, "personal-service.json");
  if (create) {
    await mkdir(dataDirectory, { recursive: true });
    const temporary = path.join(dataDirectory, `.personal-service-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ token: randomUUID(), secret: randomBytes(32).toString("hex") }));
      await handle.sync();
      try { await link(temporary, file); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    } finally {
      await handle.close();
      await unlink(temporary);
    }
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 || (process.platform !== "win32"
      && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) {
      throw new Error("Personal service credentials must be a private file owned by the current user");
    }
    const value = JSON.parse(await handle.readFile("utf8"));
    if (!/^[a-z0-9-]{16,128}$/i.test(value.token ?? "") || !/^[a-f0-9]{64}$/i.test(value.secret ?? "")) {
      throw new Error("Invalid personal service credentials");
    }
    return value;
  } finally { await handle.close(); }
}
