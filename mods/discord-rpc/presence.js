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

export const DEFAULT_DETAILS = "{workspace} · {branch}";
export const DEFAULT_STATE = "{harness} · {agents.running}/{agents.total} agents active";
export const VARIABLES = {
  workspace: "Workspace",
  branch: "Branch",
  harness: "Harness",
  "agents.running": "Running agents",
  "agents.total": "Total agents",
};

export function validateTemplate(template) {
  if (typeof template !== "string" || template.length > 512)
    throw new Error("Presence templates must be text, up to 512 characters");
  const remainder = template.replace(/\{([^{}]+)\}/g, (_match, key) => {
    if (!Object.hasOwn(VARIABLES, key)) throw new Error(`Unknown variable: {${key}}`);
    return "";
  });
  if (/[{}]/.test(remainder)) throw new Error("Use complete variables, for example {workspace}");
}

export function renderTemplate(template, values) {
  validateTemplate(template);
  const parts = template.split(/(\{[^{}]+\})/g);
  for (let i = 1; i < parts.length; i += 2) {
    if (String(values[parts[i].slice(1, -1)] ?? "")) continue;
    // Remove only template punctuation, never punctuation inside a variable's value.
    if (/[·|,:;/–—-]\s*$/.test(parts[i - 1])) parts[i - 1] = parts[i - 1].replace(/[\s·|,:;/–—-]+$/, "");
    else parts[i + 1] = parts[i + 1].replace(/^[\s·|,:;/–—-]+/, "");
  }
  return text(parts.map((part, i) => i % 2 ? values[part.slice(1, -1)] ?? "" : part).join(""));
}

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
  for (const key of ["detailsTemplate", "stateTemplate"]) {
    if (config[key] !== undefined) validateTemplate(config[key]);
  }
  if (config.detailsTemplates !== undefined) {
    if (!Array.isArray(config.detailsTemplates)) throw new Error("config.json detailsTemplates must be an array of templates");
    for (const template of config.detailsTemplates) validateTemplate(template);
  }
  if (config.shuffleDetails !== undefined && typeof config.shuffleDetails !== "boolean")
    throw new Error("config.json shuffleDetails must be true or false");
  if (config.detailsIntervalMinutes !== undefined && (!Number.isInteger(config.detailsIntervalMinutes) || config.detailsIntervalMinutes < 1 || config.detailsIntervalMinutes > 1440))
    throw new Error("Details shuffle interval must be a whole number from 1 to 1440 minutes");
  if (config.statusDisplayType !== undefined && !["name", "state", "details"].includes(config.statusDisplayType))
    throw new Error("config.json statusDisplayType must be name, state, or details");
  return config;
}

export function isPrivate(name, patterns) {
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
  const values = {
    workspace: privateSpace ? "Private workspace" : text(space.name) || "Workspace",
    branch: branchLabel,
    harness: text(label),
    "agents.running": working,
    "agents.total": roots.length,
  };
  for (const [field, fallback] of [["details", DEFAULT_DETAILS], ["state", DEFAULT_STATE]]) {
    const template = config[field + "Template"];
    if (template === undefined || template === fallback) continue;
    const rendered = renderTemplate(template, values);
    if (!rendered) delete activity[field];
    else activity[field] = Array.from(rendered).length < 2 ? `In ${rendered}` : rendered;
  }
  if (config.statusDisplayType !== undefined) {
    const selected = config.statusDisplayType;
    activity.status_display_type = selected !== "name" && !activity[selected] ? 0 : ["name", "state", "details"].indexOf(selected);
  }
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
