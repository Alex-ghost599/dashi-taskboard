// The packaged Codex renderer uses app://-. A page title is not an identity.
export function isTrustedCodexUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "app:"
      && url.hostname === "-"
      && !url.port && !url.username && !url.password
      && !["/global-dictation", "/avatar-overlay"].includes(url.searchParams.get("initialRoute"));
  } catch {
    return false;
  }
}

export function isCodexTarget(target) {
  return target?.type === "page" && isTrustedCodexUrl(target.url);
}

// This guard runs inside the destination document, before any secret assignment.
// Discovery alone cannot prevent a navigation between CDP commands. Custom app:
// origins stringify as "null" in Node. In the page use native Location fields;
// its URL constructor can be replaced by an untrusted document.
export function guardCodexSource(source) {
  return `(() => {
    if (window !== window.top
      || window.location.protocol !== "app:"
      || window.location.hostname !== "-"
      || window.location.port !== "") return;
    ${source}
  })()`;
}

export async function requireTrustedCodexFrame(cdp) {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const frame = frameTree?.frame;
  if (!frame || frame.parentId || !isTrustedCodexUrl(frame.url)) {
    throw new Error("Refusing Taskboard injection into an untrusted Codex document");
  }
  return frame;
}
