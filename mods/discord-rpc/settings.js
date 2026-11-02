import { View, div, image } from "gpui-kit";
import { Button, Checkbox, Input, InputState, h_flex, v_flex } from "gpui-base";
import { agents, appHome, closeOverlay, exec, focused, panes, props, readTextFile, run, spaces, terminals, theme, writeTextFile } from "herdr";
import { buildActivity, DEFAULT_DETAILS, DEFAULT_STATE, isPrivate, parseConfig, VARIABLES } from "./presence.js";

const DEFAULT_CONFIG = { clientId: "1529832902387302510", enabled: true, privatePatterns: [], largeImageKey: "herdr", showHarnessIcon: true };

export default class Settings extends View {
  init(_props, cx, lookupBranch) {
    this.lookupBranch = lookupBranch;
    this.path = appHome() + "/mods/discord-rpc/config.json";
    this.runtimeDirectory = appHome() + "/data/discord-rpc";
    this.handle = cx.focus_handle();
    this.toggleFocus = Object.fromEntries(["enabled", "artwork", "harness-icon"].map(id => [id, cx.focus_handle()]));
    this.focus = focused();
    this.inputs = {};
    this.patterns = [];
    this.nextPattern = 0;
    this.activeField = "detailsTemplate";
    this.status = null;
    this.advanced = false;
    this.loading = true;
    this.load(cx);
    cx.timer.every(2000, cx => this.refreshStatus(cx));
    this.handle.focus();
  }

  input(value, cx, field) {
    const state = InputState.new({ value });
    state.on("change", (_e, cx) => { this.error = ""; cx.notify(); });
    state.on("focus", (_e, cx) => {
      this.focusedInput = state;
      if (field) this.activeField = field;
      cx.notify();
    });
    state.on("blur", (_e, cx) => { this.focusedInput = null; cx.notify(); });
    return state;
  }

  load(cx) {
    if (this.saving) return;
    this.loading = true;
    this.error = "";
    cx.spawn(async cx => {
      try {
        const source = await readTextFile(this.path);
        const config = source === null ? { ...DEFAULT_CONFIG } : parseConfig(source);
        for (const input of Object.values(this.inputs)) input.release();
        for (const row of this.patterns) row.input.release();
        this.source = source;
        this.config = config;
        this.enabled = config.enabled !== false;
        this.artwork = Boolean(config.largeImageKey);
        this.harnessIcon = config.showHarnessIcon !== false;
        this.displayType = config.statusDisplayType ?? "name";
        this.inputs = {
          detailsTemplate: this.input(config.detailsTemplate ?? DEFAULT_DETAILS, cx, "detailsTemplate"),
          stateTemplate: this.input(config.stateTemplate ?? DEFAULT_STATE, cx, "stateTemplate"),
          clientId: this.input(config.clientId, cx),
          largeImageKey: this.input(config.largeImageKey ?? "herdr", cx),
          pattern: this.input("", cx),
        };
        this.patterns = (config.privatePatterns ?? []).map(value => ({ id: this.nextPattern++, input: this.input(value, cx) }));
        this.inputs.pattern.on("submit", (_e, cx) => this.addPattern(cx));
        this.loaded = true;
        this.notice = "";
      } catch (error) {
        this.loaded = false;
        this.error = `Could not load config.json: ${String(error)}. Fix the file, then Reload.`;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
    this.refreshStatus(cx);
  }

  refreshStatus(cx) {
    if (this.readingStatus) return;
    this.readingStatus = true;
    cx.spawn(async cx => {
      try {
        const source = await readTextFile(this.runtimeDirectory + "/.status.json");
        this.status = source ? JSON.parse(source) : null;
        const heartbeat = await readTextFile(this.runtimeDirectory + "/.presence.json");
        const at = heartbeat ? JSON.parse(heartbeat).updatedAt : 0;
        this.hostLive = Number.isSafeInteger(at) && Date.now() - at < 45000 && Date.now() >= at;
      } catch {
        this.status = null;
        this.hostLive = false;
      } finally {
        this.previewData = { agents: agents(), spaces: spaces(), terminals: terminals(), panes: panes(), focus: this.focus };
        this.branchFallback = this.lookupBranch ? await this.lookupBranch(this.previewData).catch(() => null) : null;
        this.readingStatus = false;
        cx.notify();
      }
    });
  }

  createPane(cx) {
    if (this.creatingPane || this.saving || this.loading) return;
    const existing = panes().find(pane => pane.mod === "discord-rpc");
    if (existing) {
      run("pane.focus", { pane: existing.pane });
      this.error = "";
      this.notice = "Existing RPC pane selected. No new pane was created.";
      cx.notify();
      return;
    }
    const anchor = focused()?.pane;
    if (!anchor) {
      this.error = "Select a pane in a workspace tab, then create the RPC pane.";
      cx.notify();
      return;
    }
    this.creatingPane = true;
    this.error = "";
    this.notice = "";
    cx.notify();
    cx.spawn(async cx => {
      let created = false;
      try {
        const result = await exec("herdr-app", ["do", "pane.split", JSON.stringify({ direction: "right", pane: anchor, mod: "discord-rpc", props: { presenceHost: true } })]);
        if (result.code !== 0) throw new Error(result.stderr || "Herdr could not create the pane");
        const { pane } = JSON.parse(result.stdout);
        if (typeof pane !== "string" || !pane) throw new Error("Herdr did not return the new pane ID");
        created = true;
        const resized = await exec("herdr-app", ["do", "layout.resize", JSON.stringify({ id: pane, px: 0 })]);
        if (resized.code !== 0) throw new Error(resized.stderr || "Herdr could not resize the pane");
        this.notice = "Invisible RPC pane created. Keep its tab; visit it once after reopening Herdr.";
      } catch (error) {
        this.error = `${created ? "RPC pane created, but could not make it invisible" : "Could not create RPC pane"}: ${String(error)}`;
      } finally {
        if (created) run("pane.focus", { pane: anchor });
        this.creatingPane = false;
        this.refreshStatus(cx);
        cx.notify();
      }
    });
  }

  draft() {
    const config = {
      ...this.config,
      enabled: this.enabled,
      privatePatterns: [...this.patterns.map(row => row.input.value().trim()), this.inputs.pattern.value().trim()].filter(Boolean),
      clientId: this.inputs.clientId.value().trim(),
      showHarnessIcon: this.harnessIcon,
      detailsTemplate: this.inputs.detailsTemplate.value(),
      stateTemplate: this.inputs.stateTemplate.value(),
      statusDisplayType: this.displayType,
    };
    if (this.artwork) config.largeImageKey = this.inputs.largeImageKey.value().trim();
    else delete config.largeImageKey;
    return parseConfig(JSON.stringify(config));
  }

  save(cx) {
    if (this.saving) return;
    let config;
    try { config = this.draft(); }
    catch (error) { this.error = String(error); cx.notify(); return; }
    this.persist(config, cx, true);
  }

  persist(config, cx, close) {
    this.saving = true;
    this.error = "";
    const source = JSON.stringify(config, null, 2) + "\n";
    cx.spawn(async cx => {
      try {
        await writeTextFile(this.path, source, this.source);
        this.source = source;
        this.config = config;
        this.notice = close ? "Settings saved." : "Sharing paused. Other edits are not saved yet.";
        if (close && props()?.overlay) closeOverlay(props().overlay);
      } catch (error) {
        if (!close) this.enabled = this.config.enabled !== false;
        this.error = `Could not save: ${String(error)}. If config.json changed elsewhere, Reload before editing again.`;
      } finally {
        this.saving = false;
        cx.notify();
      }
    });
  }

  sharing(enabled, cx) {
    if (this.saving) return;
    this.enabled = enabled;
    // Pausing persists only the last saved config; it must not publish other draft edits.
    if (!enabled && this.config.enabled !== false) this.persist({ ...this.config, enabled: false }, cx, false);
    cx.notify();
  }

  addPattern(cx) {
    const value = this.inputs.pattern.value().trim();
    if (!value || this.saving) return;
    this.patterns.push({ id: this.nextPattern++, input: this.input(value, cx) });
    this.inputs.pattern.set_value("");
    cx.notify();
  }

  button(t, id, label, action, primary = false, disabled = false) {
    return Button.new(id).tab_index(0).accessibility_label(label).disabled(disabled)
      .h(30).px(10).flex().items_center().justify_center().rounded(6)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .border_1().border_color(primary ? t.solid : t.input).text_size(12.5)
      .cursor_pointer().hover(s => s.bg(primary ? t.accent : t.hover))
      .focus(s => s.border_color(t.accent)).when(disabled, el => el.opacity(0.45))
      .on_click((_e, cx) => action(cx)).child(label);
  }

  field(t, label, state) {
    return v_flex().gap(5).child(div().text_size(12.5).child(label))
      .child(Input.new(state).accessibility_label(label).w_full().min_w(0).h(32).px(10)
        .rounded(6).border_1().border_color(this.focusedInput === state ? t.accent : t.input)
        .bg(t.background).text_color(t.foreground).text_size(13).disabled(Boolean(this.saving)));
  }

  toggle(t, id, label, checked, action) {
    return h_flex().gap(12).items_center().justify_between()
      .child(div().flex_1().text_size(13).child(label))
      .child(div().id(id + "-focus").track_focus(this.toggleFocus[id]).rounded(12).p(2)
        .border_1().border_color(t.popover).focus(s => s.border_color(t.accent))
        .child(Checkbox.new(id).role("switch").track_focus(this.toggleFocus[id]).tab_index(0).accessibility_label(label).checked(checked).disabled(Boolean(this.saving))
          .w(36).h(22).p(3).rounded(11).flex().items_center().when(checked, el => el.justify_end())
          .bg(checked ? t.accent : t.input).cursor_pointer()
          .on_change((value, cx) => action(value, cx))
          .child(div().size(14).rounded(7).bg(checked ? t.accent_foreground : t.muted))));
  }

  heading(label) { return div().pt(18).pb(8).text_size(13).font_semibold().child(label); }
  note(t, label) { return div().text_size(12).line_height("18px").text_color(t.muted).child(label); }

  preview(t, activity, title) {
    const selected = activity?.status_display_type ?? 0;
    const compact = activity ? [activity.name, activity.state, activity.details][selected] || activity.name : "No activity";
    const lines = v_flex().flex_1().min_w(0).gap(4)
      .child(div().text_size(13).font_semibold().child(activity?.name ?? "Nothing will be shared"))
      .when(Boolean(activity?.details), el => el.child(div().text_size(13).child(activity.details)))
      .when(Boolean(activity?.state), el => el.child(div().text_size(13).child(activity.state)));
    return v_flex().gap(6).child(div().text_size(12).font_medium().child(title))
      .child(this.note(t, "Member list: " + (activity ? "Playing " : "") + compact))
      .child(h_flex().p(12).gap(12).rounded(8).bg(t.background)
        .when(activity?.assets?.large_image === "herdr" && this.inputs.clientId.value() === DEFAULT_CONFIG.clientId, el => el.child(image("frame/welcome/herdr.png").size(48).flex_none().rounded(8)))
        .child(lines))
      .when(Boolean(activity?.assets), el => el.child(this.note(t, "Image keys: " + [activity.assets.large_image, activity.assets.small_image].filter(Boolean).join(" / "))));
  }

  render() {
    const t = theme();
    const busy = Boolean(this.saving || this.loading || this.creatingPane);
    const paneExists = panes().some(pane => pane.mod === "discord-rpc");
    let config, error, preview;
    if (this.loaded) {
      try {
        config = this.draft();
        preview = buildActivity(this.previewData ?? { agents: agents(), spaces: spaces(), terminals: terminals(), panes: panes(), focus: this.focus }, { ...config, enabled: true }, this.branchFallback);
      } catch (e) { error = String(e); }
    }
    const status = !this.hostLive ? "RPC pane is not running. Visit its tab to start presence; keep the pane open when changing layouts."
      : this.config?.enabled === false ? "Sharing paused"
      : ({ published: "Discord acknowledged the last activity", pending: "Waiting to publish", disconnected: "Discord is not connected. Retrying automatically.", starting: "Connecting to Discord", error: "Discord connection error", idle: "Waiting for a workspace" }[this.status?.state] ?? "Waiting for the Discord helper");
    const root = v_flex().id("discord-settings").track_focus(this.handle).w_full().h_full().max_h(760).min_h(0)
      .p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().gap(10).items_center()
        .child(div().flex_1().text_size(16).font_semibold().child("Discord presence"))
        .child(this.button(t, "close", "Close", () => { if (props()?.overlay) closeOverlay(props().overlay); }, false, busy)))
      .child(this.note(t, status))
      .child(div().pt(8).child(this.button(t, "create-rpc-pane", this.creatingPane ? "Creating pane…" : paneExists ? "Go to RPC pane" : "Create RPC pane", cx => this.createPane(cx), false, busy)));
    if (this.loading) return root.child(this.note(t, "Loading configuration…"));
    if (!this.loaded) return root.child(this.note(t, this.error)).child(this.button(t, "reload", "Reload", cx => this.load(cx)));
    const content = v_flex().id("discord-settings-scroll").min_h(0).flex_1().overflow_y_scrollbar().gap(8)
      .child(div().pt(12).child(this.toggle(t, "enabled", "Share activity on Discord", this.enabled, (value, cx) => this.sharing(value, cx))))
      .child(this.note(t, "Turning off pauses immediately. Other changes apply when you Save."))
      .when(Boolean(this.status?.error && this.hostLive), el => el.child(this.note(t, this.status.error)))
      .child(this.heading("Preview"))
      .when(Boolean(error), el => el.child(div().text_size(12).text_color(t.blocked).child(error ?? "")))
      .when(!error, el => el.child(this.preview(t, preview, this.enabled ? "Draft · current workspace" : "Draft · sharing is off")))
      .when(!preview && !error, el => el.child(this.note(t, "Select a workspace to preview its activity.")))
      .when(Boolean(this.status?.lastAckAt && this.hostLive), el => el.child(this.note(t,
        `Last acknowledged: ${new Date(this.status.lastAckAt).toLocaleTimeString()} · ${this.status.activity ? [this.status.activity.details, this.status.activity.state].filter(Boolean).join(" / ") : "Presence cleared"}`)))
      .child(this.heading("Presence text"))
      .child(this.note(t, "Show in Discord’s member list"))
      .child(h_flex().gap(6).children(["name", "state", "details"].map((value, index) =>
        this.button(t, "display-" + value, ["App name", "State", "Details"][index], cx => { this.displayType = value; cx.notify(); }, this.displayType === value, busy).selected(this.displayType === value))))
      .child(this.field(t, "Details", this.inputs.detailsTemplate))
      .child(this.field(t, "State", this.inputs.stateTemplate))
      .child(this.note(t, `Insert into ${this.activeField === "detailsTemplate" ? "Details" : "State"} (focus either field to choose)`))
      .child(h_flex().flex_wrap().gap(6).children(Object.entries(VARIABLES).map(([key, label]) =>
        this.button(t, "variable-" + key, label, cx => {
          const input = this.inputs[this.activeField];
          input.replace("{" + key + "}");
          input.focus();
          cx.notify();
        }, false, busy))))
      .child(h_flex().items_center().gap(10)
        .child(this.note(t, "Text is limited to 128 characters per line."))
        .child(this.button(t, "reset", "Reset text", cx => {
          this.inputs.detailsTemplate.set_value(DEFAULT_DETAILS);
          this.inputs.stateTemplate.set_value(DEFAULT_STATE);
          cx.notify();
        }, false, busy)))
      .child(this.heading("Privacy"))
      .child(this.note(t, "Private workspaces · case-insensitive names or patterns (* and ?)"))
      .children(this.patterns.map(row => h_flex().gap(6).items_end()
        .child(div().flex_1().min_w(0).child(this.field(t, "Workspace pattern", row.input)))
        .child(this.button(t, "remove-" + row.id, "Remove", cx => {
          this.patterns = this.patterns.filter(item => item !== row);
          row.input.release();
          cx.notify();
        }, false, busy))))
      .child(h_flex().gap(6).items_end()
        .child(div().flex_1().min_w(0).child(this.field(t, "Add workspace name or pattern", this.inputs.pattern)))
        .child(this.button(t, "add-pattern", "Add", cx => this.addPattern(cx), false, busy || !this.inputs.pattern.value().trim())))
      .child(this.note(t, "Matching workspaces show “Private workspace” and hide the branch in every template. Harness and counts stay visible."))
      .when(Boolean(config?.privatePatterns.length), el => {
        const matches = spaces().filter(space => isPrivate(space.name, config.privatePatterns));
        return el.child(this.note(t, matches.length ? `Matches ${matches.length} current workspace${matches.length === 1 ? "" : "s"}.` : "No current workspaces match."));
      })
      .child(this.heading("Appearance"))
      .child(this.toggle(t, "artwork", "Show Herdr artwork", this.artwork, (value, cx) => { this.artwork = value; cx.notify(); }))
      .child(this.toggle(t, "harness-icon", "Show harness icon", this.harnessIcon, (value, cx) => { this.harnessIcon = value; cx.notify(); }))
      .child(this.note(t, "The harness icon appears with artwork when a single supported harness is selected."))
      .child(div().pt(12).child(this.button(t, "advanced", this.advanced ? "Hide advanced" : "Advanced", cx => { this.advanced = !this.advanced; cx.notify(); }, false, busy)))
      .when(this.advanced, el => el
        .child(this.field(t, "Discord application ID", this.inputs.clientId))
        .child(this.note(t, "Leave unchanged unless using your own Discord application. This is public, not a token."))
        .child(this.field(t, "Large image asset key", this.inputs.largeImageKey))
        .child(this.note(t, "Image keys must exist in that Discord application. Default: herdr.")));
    return root.child(content)
      .when(Boolean(this.error || this.notice), el => el.child(div().pt(8).text_size(12).text_color(this.error ? t.blocked : t.muted).child(this.error || this.notice)))
      .child(h_flex().pt(14).gap(8).items_center()
        .child(this.button(t, "reload", "Reload", cx => this.load(cx), false, busy))
        .child(div().flex_1())
        .child(this.button(t, "cancel", "Cancel", () => { if (props()?.overlay) closeOverlay(props().overlay); }, false, busy))
        .child(this.button(t, "save", this.saving ? "Saving…" : "Save", cx => this.save(cx), true, busy || Boolean(error))));
  }
}
