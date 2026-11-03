import { View, div, svg } from "gpui-kit";
import { Button } from "gpui-base";
import { agents, appHome, exec, focused, openOverlay, panes, props, readTextFile, spaces, terminals, theme, writeTextFile } from "herdr";
import { buildActivity, DEFAULT_DETAILS, parseConfig } from "./presence.js";
import Settings from "./settings.js";

export default class DiscordRpc extends View {
  init(_props, cx) {
    if (props()?.launcher && !props()?.overlay) {
      this.launcher = true;
      return;
    }
    if (props()?.overlay) {
      this.settings = new Settings();
      this.settings.init(_props, cx, data => this.branch(data));
      return;
    }
    // Only the explicitly installed tab pane owns presence; old layout blocks stay inert.
    if (props()?.presenceHost !== true) return;
    this.host = true;
    // shortcut: one host pane per app home; add owner leases before supporting multiple windows.
    this.directory = appHome() + "/mods/discord-rpc";
    this.runtimeDirectory = appHome() + "/data/discord-rpc";
    this.revision = 0;
    this.writtenRevision = -1;
    this.lastWrite = 0;
    this.busy = false;
    this.closing = false;
    this.lastError = "";
    cx.timer.every(1000, cx => this.flush(cx));
    this.flush(cx);
  }

  report(error) {
    const message = String(error);
    if (message !== this.lastError) console.log("discord-rpc: " + message);
    this.lastError = message;
  }

  async branch(data) {
    const address = data.focus?.shown ?? data.focus?.terminal;
    const pane = data.panes.find(p => p.terminal === address);
    const cwd = pane?.cwd ?? data.focus?.cwd;
    if (!address || pane?.branch || !cwd) return pane?.branch;
    const on = address.includes("/") ? address.split("/")[0] : null;
    const key = JSON.stringify([on, cwd]);
    if (this.branchLookup?.key === key && Date.now() - this.branchLookup.at < 10000) return this.branchLookup.value;
    let value = null;
    try {
      const result = await exec("git", ["branch", "--show-current"], { cwd, on });
      if (result.code === 0) value = result.stdout.trim() || null;
    } catch (error) {
      this.report(error);
    }
    this.branchLookup = { key, value, at: Date.now() };
    return value;
  }

  detailsConfig(config) {
    if (!config.shuffleDetails || config.enabled === false) {
      this.detailsShuffle = null;
      return config;
    }
    const templates = [...new Set([config.detailsTemplate ?? DEFAULT_DETAILS, ...(config.detailsTemplates ?? [])])];
    const interval = (config.detailsIntervalMinutes ?? 3) * 60000;
    const key = JSON.stringify([templates, interval]);
    const now = Date.now();
    if (this.detailsShuffle?.key !== key || now - this.detailsShuffle.at >= interval) {
      const choices = templates.filter(template => template !== this.detailsShuffle?.template);
      const template = choices.length ? choices[Math.floor(Math.random() * choices.length)] : templates[0];
      this.detailsShuffle = { key, template, at: now };
    }
    return { ...config, detailsTemplate: this.detailsShuffle.template };
  }

  flush(cx) {
    if (!this.host || this.busy || this.closing || (this.revision === this.writtenRevision && Date.now() - this.lastWrite < 10000)) return;
    this.busy = true;
    const revision = this.revision;
    cx.spawn(async cx => {
      try {
        let activity = null;
        let failure = null;
        try {
          const config = parseConfig(await readTextFile(this.directory + "/config.json"));
          const data = { agents: agents(), spaces: spaces(), terminals: terminals(), panes: panes(), focus: focused() };
          const branch = config.enabled === false ? null : await this.branch(data);
          activity = buildActivity(data, this.detailsConfig(config), branch);
        } catch (error) {
          failure = String(error);
          this.report(error);
        }
        const path = this.runtimeDirectory + "/.presence.json";
        const previous = await readTextFile(path);
        if (this.closing) return;
        await writeTextFile(path, JSON.stringify({ version: 1, updatedAt: Date.now(), activity, error: failure }), previous);
        if (this.closing) return;
        const result = await exec("node", [this.directory + "/bridge.mjs", "--start", this.directory]);
        if (result.code !== 0) throw new Error(result.stderr || "Could not start Discord helper");
        if (!failure) this.lastError = "";
        this.writtenRevision = revision;
        this.lastWrite = Date.now();
      } catch (error) {
        this.report(error);
      } finally {
        this.busy = false;
      }
    });
  }

  async close() {
    if (!this.host) return;
    this.closing = true;
    const path = this.runtimeDirectory + "/.presence.json";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const previous = await readTextFile(path);
        await writeTextFile(path, JSON.stringify({ version: 1, updatedAt: Date.now(), activity: null }), previous);
        return;
      } catch (error) {
        if (attempt === 2) this.report(error);
      }
    }
  }

  render() {
    if (this.settings) return this.settings.render();
    if (this.launcher) {
      const t = theme();
      return Button.new("discord-presence-settings").tab_index(0).accessibility_label("Discord presence settings")
        .tooltip("Discord presence").size_full().px(8).flex().items_center().justify_center()
        .bg(t.chrome).border_t(1).border_color(t.border).text_color(t.muted)
        .cursor_pointer().hover(el => el.bg(t.hover).text_color(t.foreground)).focus(el => el.border_color(t.accent))
        .on_click(() => openOverlay({ mod: "discord-rpc", kind: "dialog", width: 560, height: 760 }))
        .child(svg("mods/discord-rpc/discord.svg").size(18));
    }
    if (!this.host) return div().w(0).h(0);
    this.revision++;
    const t = theme();
    return div().size_full().flex().flex_col().gap(12).p(18).bg(t.background).text_color(t.foreground).text_size(13)
      .child(div().text_size(16).font_semibold().child("Discord presence"))
      .child("Keep this pane open. Presence continues when you change tabs or layouts.")
      .child("After reopening Herdr, visit this tab once to start presence.")
      .when(Boolean(this.collapseError), el => el.child(div().text_color(t.blocked).child(this.collapseError)))
      .child(Button.new("discord-pane-collapse").tab_index(0).accessibility_label("Collapse RPC pane to 0px")
        .px(12).h(30).rounded(6).bg(t.raised).text_color(t.foreground).cursor_pointer()
        .hover(el => el.bg(t.hover)).focus(el => el.border_1().border_color(t.accent))
        .on_click((_event, cx) => {
          const pane = panes().find(pane => pane.mod === "discord-rpc")?.pane;
          cx.spawn(async cx => {
            try {
              if (!pane) throw new Error("RPC pane not found");
              const result = await exec("herdr-app", ["do", "layout.resize", JSON.stringify({ id: pane, px: 0 })]);
              if (result.code !== 0) throw new Error(result.stderr || "Herdr could not resize the pane");
              this.collapseError = "";
            } catch (error) {
              this.collapseError = `Could not collapse RPC pane: ${String(error)}`;
            }
            cx.notify();
          });
        })
        .child("Collapse to 0px"))
      .when(Boolean(this.lastError), el => el.child(div().text_color(t.blocked).child(this.lastError)))
      .child(Button.new("discord-pane-settings").tab_index(0).accessibility_label("Discord presence settings")
        .px(12).h(30).rounded(6).bg(t.raised).text_color(t.foreground).cursor_pointer()
        .hover(el => el.bg(t.hover)).focus(el => el.border_1().border_color(t.accent))
        .on_click(() => openOverlay({ mod: "discord-rpc", kind: "dialog", width: 560, height: 760 }))
        .child("Presence settings"));
  }
}
