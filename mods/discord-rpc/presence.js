const HARNESSES = {
  pi: ["Pi", "pi"],
  claude: ["Claude Code", "claude"],
  "claude-code": ["Claude Code", "claude"],
  codex: ["Codex", "codex"],
  gemini: ["Gemini", "gemini"],
  "gemini-cli": ["Gemini", "gemini"],
  opencode: ["OpenCode", "opencode"],
  cursor: ["Cursor", "cursor"],
  "cursor-agent": ["Cursor", "cursor"],
  copilot: ["GitHub Copilot", "copilot"],
};

const text = (value, limit = 128) => Array.from(String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, limit).join("");

export function parseConfig(source) {
  const config = JSON.parse(source);
  if (!config || !/^\d{17,20}$/.test(config.clientId) || typeof config.clientId !== "string")
    throw new Error("config.json needs a Discord clientId (17–20 digits)");
  if (config.enabled !== undefined && typeof config.enabled !== "boolean")
    throw new Error("config.json enabled must be true or false");
  if (config.privatePatterns !== undefined && (!Array.isArray(config.privatePatterns) || !config.privatePatterns.every(p => typeof p === "string")))
    throw new Error("config.json privatePatterns must be an array of strings");
  if (config.largeImageKey !== undefined && (typeof config.largeImageKey !== "string" || !config.largeImageKey.trim() || config.largeImageKey.length > 128))
    throw new Error("config.json largeImageKey must be a nonempty asset key (up to 128 characters)");
  if (config.showHarnessIcon !== undefined && typeof config.showHarnessIcon !== "boolean")
    throw new Error("config.json showHarnessIcon must be true or false");
  return config;
}

function isPrivate(name, patterns) {
  return patterns.some(pattern => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(name);
  });
}

function harness(agent) {
  const known = HARNESSES[agent.app || agent.program?.key];
  return { name: known?.[0] ?? text(agent.app || agent.program?.name || "Agent"), icon: known?.[1] };
}

export function buildActivity(data, config, branchFallback) {
  if (config.enabled === false) return null;
  const space = data.spaces.find(s => s.id === data.focus?.space) ?? data.spaces.find(s => s.active);
  if (!space) return null;

  const terminals = new Map(data.terminals.map(t => [t.address, t]));
  const roots = data.agents.filter(a => {
    const terminal = terminals.get(a.address);
    return terminal?.state === "live" && !terminal.parent;
  });
  const working = roots.filter(a => a.status === "working").length;
  const address = data.focus?.shown ?? data.focus?.terminal;
  const focusedAgent = data.agents.find(a => a.address === address);
  const harnesses = focusedAgent ? [harness(focusedAgent)] : roots.filter(a => a.space === space.id).map(harness);
  const names = [...new Set(harnesses.map(h => h.name))];
  const label = names.join(" + ");
  const pane = address ? data.panes.find(p => p.terminal === address) : undefined;
  const ownerLabel = terminals.get(address)?.labels?.["herdr.space"];
  const ownerId = ownerLabel && address.includes("/") ? `${address.split("/")[0]}/${ownerLabel}` : ownerLabel;
  const owner = data.spaces.find(s => s.id === focusedAgent?.space)
    ?? data.spaces.find(s => s.tabs?.some(t => t.id === pane?.tab))
    ?? data.spaces.find(s => s.id === ownerId);
  const branch = address ? pane?.branch || branchFallback : null;
  const privateSpace = [space, owner].some(s => s && isPrivate(s.name, config.privatePatterns ?? []));
  const branchLabel = privateSpace ? "" : text(branch, 48);
  const workspace = privateSpace ? "Private workspace" : text(space.name, branchLabel ? 125 - Array.from(branchLabel).length : 128) || "Workspace";
  let details = branchLabel ? `${workspace} · ${branchLabel}` : workspace;
  if (details.length < 2) details = `In ${details}`;
  const count = `${working}/${roots.length} agents active`;

  const activity = {
    name: "Herdr",
    type: 0,
    details,
    state: label ? `${text(label, 125 - count.length)} · ${count}` : count,
  };
  if (config.largeImageKey) {
    activity.assets = { large_image: config.largeImageKey, large_text: "Herdr" };
    const icons = [...new Set(harnesses.map(h => h.icon))];
    if (config.showHarnessIcon !== false && names.length === 1 && icons.length === 1 && icons[0]) {
      activity.assets.small_image = icons[0];
      activity.assets.small_text = text(label);
    }
  }
  return activity;
}
